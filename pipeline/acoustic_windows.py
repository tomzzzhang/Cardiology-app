"""
Probe poses placed on a real chest wall, through an acoustic window that is
measured open rather than assumed open.

## Why this module exists

Every probe pose in this repository so far was authored against a heart alone.
`pipeline/views.py` builds a plane out of cardiac landmarks and then puts the
transducer on it by backing away from the geometry — `stand_off()` — because on
a heart-only mesh there is nothing else to put it on. `view_candidates_v2.py`
improved that to a 30 mm "adult visual-layout proxy", and `migrate_apertures.py`
later slid five of the six Rodero apertures onto the reference chest wall once
one existed, which found that five of them had been sitting INSIDE the body.

That fixed where the transducer sat. It did not check the thing that decides
whether a window exists at all.

## The skill this encodes

A transthoracic window is not a direction, it is a GAP. Ultrasound does not
cross bone and does not cross air, so a real study is a search: the sonographer
slides and angles the probe until the beam finds a path between two ribs, past
the sternum, and through the cardiac notch where the lung does not cover the
heart. A pose that images a beautiful plane through the fourth rib is not a
view. It is a picture of a rib.

So this module does what the operator does. For each window it takes a REGION of
skin named by anatomy — the left sternal border between the costal cartilages,
the palpated apex, below the xiphoid, the suprasternal notch — samples candidate
apertures across it, and casts the fan from each one against the ribs, the
costal cartilages, the sternum, the clavicles and the lungs. The aperture that
survives is the window. The ones that did not are reported with what blocked
them, because "there is no window here" is a finding about the substrate and not
a failure of the search.

Three things follow that could not be done before:

* **The subcostal family becomes derivable.** `docs/view_canon.md` records that
  A3 and A4 were not authored on `normal-rodero` because the subcostal family is
  defined by the beam entering from BELOW THE DIAPHRAGM, "below" is a body axis,
  and a heart-only mesh has no diaphragm to be below. Both packs now carry a
  `body-context/v0` registration with a diaphragm, a xiphoid process and a
  costal margin, so the window can be placed where it actually is.
* **Intercostal spaces are addressable by name.** BodyParts3D ships every rib
  1-12 and every costal cartilage 1-7 per side as separate concepts, so an
  aperture can report the interspace it landed in instead of asserting one.
* **The lung is a blocker, not scenery.** The cardiac notch is why the
  parasternal window exists at all, and it is measurable here.

## What this does NOT fix, on either pack

The chest is BodyParts3D's adult male thorax. On `normal-rodero` it is at native
size; on `normal-vhl-heart0102-chambers` it is the same thorax scaled uniformly
by that context's factor, so its rib obliquity, its intercostal spacing and its
costal cartilage are the ADULT source's at every scale. An interspace named here
is the adult source's interspace. It is measured, it is reproducible, and it is
not age-correct — every view this module writes carries that sentence in its own
provenance, and the fitted-chest context carries it too.

Nor does it fix where the heart sits. `placement_verification` in
`body_context.py` measures that the chamber-labelled heart clears its own
diaphragm dome where a real heart rests on it, and sits further off the chest
wall than the native pair does. A window measured against that heart inherits
it: the stand-off distances below are real distances to THAT composite.

Nothing here is vetted. Every pose is `draft`.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np
import fast_simplification
import trimesh
from scipy.spatial import cKDTree

import body_context as bc
import views as legacy
from meshlib import read_gltf_surfaces, read_obj

REPO = bc.REPO

# --------------------------------------------------------------------------- #
# the chest: what blocks a beam, and where a window is looked for              #
# --------------------------------------------------------------------------- #

#: Ribs 1-12 per side, each its own concept, so an aperture can NAME its
#: interspace instead of asserting one.
RIB_CONCEPTS = {
    ("left", 1): "FMA7987", ("left", 2): "FMA8012", ("left", 3): "FMA8039",
    ("left", 4): "FMA8148", ("left", 5): "FMA8093", ("left", 6): "FMA8202",
    ("left", 7): "FMA8256", ("left", 8): "FMA8310", ("left", 9): "FMA8391",
    ("left", 10): "FMA8472", ("left", 11): "FMA8532", ("left", 12): "FMA8534",
    ("right", 1): "FMA7857", ("right", 2): "FMA7882", ("right", 3): "FMA7909",
    ("right", 4): "FMA7957", ("right", 5): "FMA8066", ("right", 6): "FMA8175",
    ("right", 7): "FMA8229", ("right", 8): "FMA8283", ("right", 9): "FMA8364",
    ("right", 10): "FMA8445", ("right", 11): "FMA8531", ("right", 12): "FMA8533",
}

#: Costal cartilages 1-7 per side. Held SEPARATELY from bone on purpose: a
#: parasternal window at the sternal border is a gap between CARTILAGES, and
#: cartilage is not the same acoustic obstacle as rib. In a child it transmits
#: well enough to image through; calcified in an adult it does not. It is
#: reported as a soft blocker and never silently treated as bone.
CARTILAGE_CONCEPTS = {
    ("left", 1): "FMA8005", ("left", 2): "FMA8031", ("left", 3): "FMA8058",
    ("left", 4): "FMA8167", ("left", 5): "FMA8112", ("left", 6): "FMA8221",
    ("left", 7): "FMA8275",
    ("right", 1): "FMA7875", ("right", 2): "FMA7886", ("right", 3): "FMA7913",
    ("right", 4): "FMA7976", ("right", 5): "FMA8070", ("right", 6): "FMA8194",
    ("right", 7): "FMA8248",
}

MANUBRIUM = "FMA7486"
STERNAL_BODY = "FMA7487"
XIPHOID = "FMA7488"
LEFT_CLAVICLE = "FMA13323"
RIGHT_CLAVICLE = "FMA13322"
LEFT_LUNG = "FMA7310"
RIGHT_LUNG = "FMA7309"
SKIN = "FMA7163"
DIAPHRAGM = "FMA13295"

#: How far along the beam the blocker search starts, in millimetres.
#:
#: The transducer sits ON the skin, so the first fraction of a millimetre of
#: every ray is inside the skin surface by construction. Starting the search a
#: little way in stops the window the probe is standing in from counting as the
#: thing blocking it.
RAY_START_MM = 3.0

#: Rays cast across the fan when a candidate aperture is scored: this many
#: within the imaging plane, spread over the full sector angle.
FAN_RAYS = 21

#: A candidate aperture is rejected outright if this fraction of its fan rays
#: are blocked by BONE. Not zero: the edge of a 70 degree sector clipping a rib
#: is ordinary in a real study and is what the operator trades against sector
#: width. The central rays are what must be clear, and they are scored
#: separately.
FAN_BONE_BUDGET = 0.34

#: The central portion of the fan, as a fraction of the half angle, that must be
#: completely clear of bone AND lung for a window to count as open. This is the
#: part of the sector the named structures are read from.
CORE_FRACTION = 0.45

#: Retained sector angle, matching the rest of the repository's poses.
#:
#: This is the DEFAULT head's default setting and nothing more. It stays the
#: number every pose in this repository was placed with, so that adding the
#: ladder below changes no view that already built.
FAN_ANGLE_DEG = 70.0


@dataclass(frozen=True)
class ProbeHead:
    """
    A transducer an operator could actually pick up, and the sector it is run at.

    ## Why the sector is a setting and the footprint is a head

    Sector width is a control on the machine: the same phased array runs 45 and
    90 degrees, and narrowing it is what a sonographer does when the beam keeps
    catching a rib. Footprint is not a control — it is the physical face, and it
    is what decides whether the head fits in the interspace at all. So a head
    carries a footprint and a list of the sector settings it is worth trying at,
    and the ladder below is (head, sector) pairs rather than heads.

    ## What is enforced here and what is only measured

    The sector is ENFORCED: it is the angle the fan is cast at, the angle the
    containment tests use, and the angle written into the pose.

    The footprint is MEASURED AND REPORTED, not enforced, and the reason is that
    an aperture in this module is a POINT. A real 20 mm face centred five
    millimetres from a rib is half on the rib and does not couple; modelling
    that needs the face as a chord on the skin rather than a point, which is a
    change to the search and not a change to this table. So every built pose
    reports its aperture's clearance to the nearest bone, and which heads that
    clearance would admit, and a later round can turn that into a rule with the
    measurements already in hand.
    """

    key: str
    name: str
    #: Face width in millimetres. Reported against measured bone clearance.
    footprint_mm: float
    #: Widest sector this head can form.
    max_sector_deg: float
    #: Sector settings worth trying on it, in the order an operator would.
    sectors_deg: tuple[float, ...]
    note: str


#: The heads, and the order the ladder tries them in.
#:
#: The first entry at its first sector is what every pose in this repository was
#: already placed with, so a view that built before builds identically now. The
#: rest are only reached when the default fails, which keeps "this view needed a
#: different probe" a finding rather than an accident.
#:
#: The two directions are both real manoeuvres and they fix opposite failures.
#: WIDENING the sector reaches a landmark that fell outside it, at the cost of
#: more rib at the sector edges. NARROWING it is what gets a beam through a tight
#: interspace: fewer edge rays land on bone, so more apertures score open, and
#: one of those may be the one that lies on the view's own plane.
PROBE_HEADS: tuple[ProbeHead, ...] = (
    ProbeHead(
        key="adult-phased-array",
        name="Adult cardiac phased array (S5-1 class)",
        footprint_mm=20.0, max_sector_deg=90.0, sectors_deg=(70.0,),
        note="The default. A 20 mm face is the largest of these and the least "
             "able to sit inside a narrow interspace, which is why the "
             "paediatric heads exist.",
    ),
    ProbeHead(
        key="paediatric-phased-array",
        name="Paediatric phased array (S8-3 class)",
        footprint_mm=12.0, max_sector_deg=90.0, sectors_deg=(90.0, 60.0),
        note="Wide first, because a landmark outside a 70 degree sector is the "
             "commoner failure on these substrates; then narrow, for an "
             "interspace the wide sector cannot clear.",
    ),
    ProbeHead(
        key="neonatal-phased-array",
        name="Neonatal phased array (S12-4 class)",
        footprint_mm=9.0, max_sector_deg=90.0, sectors_deg=(45.0,),
        note="The narrowest sector on the smallest face: the deep-and-narrow "
             "setting, for a window that nothing wider gets through.",
    ),
)

#: Flattened, in order, and de-duplicated by SECTOR.
#:
#: Two heads at the same sector compute the same window in this module, because
#: the aperture is a point and only the footprint tells them apart. Running both
#: would report a probe change that did no work. The head kept for a sector is
#: the first one in the table that offers it, and the smaller heads that also
#: offer it are named in the pose's own report through the footprint clearance.
PROBE_LADDER: tuple[tuple[ProbeHead, float], ...] = tuple(
    (head, sector)
    for index, (head, sector) in enumerate(
        (h, s) for h in PROBE_HEADS for s in h.sectors_deg
    )
    if sector not in [
        s2 for h2 in PROBE_HEADS for s2 in h2.sectors_deg
    ][:index]
)

DEFAULT_HEAD, DEFAULT_SECTOR_DEG = PROBE_LADDER[0]


def heads_that_fit(clearance_mm: float) -> list[str]:
    """
    Which heads' faces would sit clear of bone at an aperture with this clearance.

    Half the face either side of the centre, so a head fits when the nearest bone
    is at least `footprint_mm / 2` away. Reported rather than enforced — see
    `ProbeHead`.
    """
    return [h.key for h in PROBE_HEADS if clearance_mm >= h.footprint_mm / 2.0]

#: How far from an aperture a rib may be and still be said to bound its
#: interspace, in millimetres.
INTERSPACE_SEARCH_MM = 60.0

#: Distal guard between the deepest imaged tissue and the bottom of the sector.
DISTAL_GUARD_MM = 5.0

#: Triangle budget for the heart mesh used as a RAY TARGET.
#:
#: Only ever asked one question — how far along this ray does cardiac tissue
#: first appear — and answering it to a tenth of a millimetre on a three-million
#: vertex surface costs minutes per pack for no gain. The landmarks, the
#: containment tests and the structure list all still run against the full
#: geometry; this is the ray index alone, and the simplification error it
#: introduces is measured and reported with the poses.
RAY_TARGET_TRIANGLE_BUDGET = 120_000

#: Tolerance for calling two lumen labels the same orifice, in millimetres.
#:
#: `normal-vhl-heart0102-chambers` has no valve-ring geometry — its source
#: carries none and its provenance records that none was invented. But two
#: chamber lumens are separated by myocardium EVERYWHERE except at the valve
#: they share, so the surface where two lumen labels come within a voxel of each
#: other IS that orifice. 2.0 mm is the smallest tolerance at which all four
#: orifices are recovered; at 1.0 mm the aortic one comes back empty because the
#: authored 384^3 partition leaves a one-voxel gap there.
ORIFICE_TOLERANCE_MM = 2.0


def _mesh(cache: Path, by_concept: dict[str, set[str]], concept: str,
          to_body: np.ndarray) -> trimesh.Trimesh:
    """One source concept as a triangle mesh in body millimetres."""
    parts = []
    for element in sorted(by_concept.get(concept, ())):
        path = cache / bc.ARCHIVE_DIR / f"{element}.obj"
        if not path.exists():
            continue
        surface = read_obj(path)
        parts.append(trimesh.Trimesh(
            vertices=np.asarray(surface.vertices, dtype=np.float64) @ to_body.T,
            faces=np.asarray(surface.faces, dtype=np.int64),
            process=False,
        ))
    if not parts:
        raise SystemExit(f"{concept}: no element geometry found")
    return trimesh.util.concatenate(parts) if len(parts) > 1 else parts[0]


@dataclass
class Chest:
    """Everything about the thorax a probe placement has to respect."""

    scale: float
    bone: trimesh.Trimesh
    cartilage: trimesh.Trimesh
    lung: trimesh.Trimesh
    skin: np.ndarray
    ribs: dict[tuple[str, int], np.ndarray]
    cartilages: dict[tuple[str, int], np.ndarray]
    xiphoid: np.ndarray
    manubrium: np.ndarray
    sternum: np.ndarray
    diaphragm: np.ndarray
    midline_x: float
    mid_clavicular_x: dict[str, float]
    _bone_ray: object = field(default=None, repr=False)
    _cartilage_ray: object = field(default=None, repr=False)
    _lung_ray: object = field(default=None, repr=False)

    def blocked(self, origins: np.ndarray, directions: np.ndarray,
                lengths: np.ndarray) -> dict[str, np.ndarray]:
        """
        Which rays are stopped by each blocker class BEFORE their length runs out.

        `lengths` is per ray and is the distance at which that ray first reaches
        the heart. An obstacle beyond it is behind the target and is not an
        obstacle.
        """
        starts = origins + directions * RAY_START_MM
        out: dict[str, np.ndarray] = {}
        for name, mesh in (("bone", self.bone), ("cartilage", self.cartilage),
                           ("lung", self.lung)):
            hit = np.zeros(len(starts), dtype=bool)
            locations, index_ray, _ = mesh.ray.intersects_location(
                ray_origins=starts, ray_directions=directions, multiple_hits=False
            )
            if len(index_ray):
                travel = np.linalg.norm(locations - starts[index_ray], axis=1)
                inside = travel <= (lengths[index_ray] - RAY_START_MM)
                hit[index_ray[inside]] = True
            out[name] = hit
        return out


def load_chest(cache: Path, by_concept: dict[str, set[str]], scale: float) -> Chest:
    """The thorax at the scale its own body context built it at."""
    to_body = bc.bodyparts_to_body(bc.measure_body_axes(cache, by_concept)) * scale

    def cloud(concept: str) -> np.ndarray:
        return bc.concept_vertices(cache, by_concept, concept) @ to_body.T

    ribs = {key: cloud(c) for key, c in RIB_CONCEPTS.items()}
    cartilages = {key: cloud(c) for key, c in CARTILAGE_CONCEPTS.items()}
    sternum = cloud("FMA7485")

    bone = trimesh.util.concatenate(
        [_mesh(cache, by_concept, c, to_body) for c in
         (*RIB_CONCEPTS.values(), MANUBRIUM, STERNAL_BODY, XIPHOID,
          LEFT_CLAVICLE, RIGHT_CLAVICLE)]
    )
    cartilage = trimesh.util.concatenate(
        [_mesh(cache, by_concept, c, to_body) for c in CARTILAGE_CONCEPTS.values()]
    )
    lung = trimesh.util.concatenate(
        [_mesh(cache, by_concept, c, to_body) for c in (LEFT_LUNG, RIGHT_LUNG)]
    )

    left_clav, right_clav = cloud(LEFT_CLAVICLE), cloud(RIGHT_CLAVICLE)
    return Chest(
        scale=scale, bone=bone, cartilage=cartilage, lung=lung,
        skin=cloud(SKIN), ribs=ribs, cartilages=cartilages,
        xiphoid=cloud(XIPHOID), manubrium=cloud(MANUBRIUM), sternum=sternum,
        diaphragm=cloud(DIAPHRAGM),
        midline_x=float((sternum[:, 0].min() + sternum[:, 0].max()) / 2),
        mid_clavicular_x={
            "left": float((left_clav[:, 0].min() + left_clav[:, 0].max()) / 2),
            "right": float((right_clav[:, 0].min() + right_clav[:, 0].max()) / 2),
        },
    )


def name_the_interspace(chest: Chest, point: np.ndarray, side: str) -> str:
    """
    Which intercostal space an aperture landed in, from the ribs themselves.

    By 3D proximity rather than by a slab in z. A rib is oblique, so a vertical
    slab through one crosses it at many heights and the nearest-above and
    nearest-below ribs come out non-consecutive; the honest question is which
    rib surface is closest to this point from above and which from below.
    Reported, never asserted — if the two nearest are not consecutive the answer
    says so instead of rounding to a plausible number.
    """
    above: tuple[float, int] | None = None
    below: tuple[float, int] | None = None
    for (rib_side, number), cloud in chest.ribs.items():
        if rib_side != side:
            continue
        distance = np.linalg.norm(cloud - point, axis=1)
        near = distance < INTERSPACE_SEARCH_MM
        if near.sum() < 5:
            continue
        candidates = cloud[near]
        upper = candidates[candidates[:, 2] > point[2]]
        lower = candidates[candidates[:, 2] < point[2]]
        if len(upper):
            gap = float(np.linalg.norm(upper - point, axis=1).min())
            if above is None or gap < above[0]:
                above = (gap, number)
        if len(lower):
            gap = float(np.linalg.norm(lower - point, axis=1).min())
            if below is None or gap < below[0]:
                below = (gap, number)
    if above is None or below is None:
        return "not bracketed by two ribs within the search radius"
    if above[1] == below[1]:
        return (f"lateral to the curve of the {side} rib {above[1]}, which lies both above and "
                "below this point; not an interspace")
    if below[1] - above[1] != 1:
        return (f"between the {side} rib {above[1]} above and rib {below[1]} below, which are "
                "not consecutive at this position")
    return (f"{side} {above[1]}{_ordinal_suffix(above[1])} intercostal space "
            f"(rib {above[1]} {above[0]:.0f} mm above, rib {below[1]} {below[0]:.0f} mm below)")


def _ordinal_suffix(n: int) -> str:
    return {1: "st", 2: "nd", 3: "rd"}.get(n if n < 20 else n % 10, "th")


# --------------------------------------------------------------------------- #
# the heart: landmarks, however the pack happens to carry them                 #
# --------------------------------------------------------------------------- #


@dataclass
class Heart:
    """Cardiac landmarks in BODY millimetres, plus the geometry behind them."""

    pack_id: str
    nodes: dict[str, np.ndarray]
    body: dict[str, np.ndarray]
    landmarks: dict[str, np.ndarray]
    landmark_source: dict[str, str]
    vertices: np.ndarray
    mesh: trimesh.Trimesh
    full_triangles: int = 0
    ray_mesh_error_mm: float = 0.0

    def entry_distance(self, origins: np.ndarray, directions: np.ndarray) -> np.ndarray:
        """
        How far each ray travels before it first reaches cardiac tissue.

        This is what makes the blocker test physical. A beam is obstructed by
        what lies BETWEEN the transducer and the heart; the pericardium's worth
        of lung behind the left atrium, and the vertebral body behind that, are
        not obstructions to a structure the beam has already imaged. Rays that
        never reach the heart come back as infinity and are scored as sector
        edge rather than as blocked.
        """
        out = np.full(len(origins), np.inf)
        locations, index_ray, _ = self.mesh.ray.intersects_location(
            ray_origins=origins, ray_directions=directions, multiple_hits=False
        )
        if len(index_ray):
            out[index_ray] = np.linalg.norm(locations - origins[index_ray], axis=1)
        return out


def _simplify_for_rays(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, float]:
    """A cheap ray target, and how far its surface moved to get there."""
    if len(mesh.faces) <= RAY_TARGET_TRIANGLE_BUDGET:
        return mesh, 0.0
    reduction = min(max(1.0 - RAY_TARGET_TRIANGLE_BUDGET / len(mesh.faces), 0.0), 0.98)
    points, faces = fast_simplification.simplify(
        mesh.vertices.astype(np.float32), mesh.faces.astype(np.int32), reduction
    )
    reduced = trimesh.Trimesh(vertices=np.asarray(points, dtype=np.float64),
                             faces=np.asarray(faces, dtype=np.int64), process=False)
    distance, _ = cKDTree(mesh.vertices).query(reduced.vertices, k=1)
    return reduced, round(float(distance.max()), 3)


def _orifice(a: np.ndarray, b: np.ndarray, tolerance: float) -> np.ndarray | None:
    """
    The centroid of the surface where two lumen labels touch.

    Two chamber lumens are separated by myocardium everywhere except at the
    valve they share, so this IS that valve's orifice. Measured off the shipped
    geometry rather than taken from metadata.
    """
    distance, _ = cKDTree(b).query(a, k=1)
    contact = a[distance <= tolerance]
    if len(contact) < 50:
        return None
    return contact.mean(axis=0)


def load_heart(pack_id: str, rotation: np.ndarray, translation: np.ndarray) -> Heart:
    """
    Cardiac landmarks for either kind of pack, measured the same way afterwards.

    `normal-rodero` ships four named valve-ring nodes and publishes its apex.
    `normal-vhl-heart0102-chambers` ships neither and never will — its source has
    no valve-ring geometry — so its orifices are recovered from where its lumen
    labels touch. Which route each landmark came from is recorded per landmark,
    because a ring node and a label interface are not the same measurement and a
    reader should not have to guess which one they are looking at.
    """
    pack_dir = REPO / "public" / "packs" / pack_id
    nodes = bc.pack_node_vertices(pack_dir / "assets" / "model.gltf")
    to_body = lambda p: p @ rotation.T + translation  # noqa: E731
    body = {name: to_body(v) for name, v in nodes.items()}

    landmarks: dict[str, np.ndarray] = {}
    source: dict[str, str] = {}

    rings = {
        "mitral": "mitral-valve-ring", "tricuspid": "tricuspid-valve-ring",
        "aortic": "aortic-valve-ring", "pulmonary": "pulmonary-valve-ring",
    }
    lumens = {
        "mitral": ("lv-lumen", "la-lumen"), "tricuspid": ("rv-lumen", "ra-lumen"),
        "aortic": ("lv-lumen", "aorta-lumen"),
        "pulmonary": ("rv-lumen", "pulmonary-artery-lumen"),
    }
    for name in rings:
        if rings[name] in body:
            landmarks[name] = body[rings[name]].mean(axis=0)
            source[name] = f"centroid of the pack's own {rings[name]} node"
            continue
        a, b = lumens[name]
        if a in body and b in body:
            point = _orifice(body[a], body[b], ORIFICE_TOLERANCE_MM)
            if point is not None:
                landmarks[name] = point
                source[name] = (
                    f"centroid of the surface where the {a} and {b} labels come within "
                    f"{ORIFICE_TOLERANCE_MM} mm of each other — the orifice they share. The "
                    "pack has no valve-ring geometry and none was invented."
                )

    for name, candidates in (("lv", ("lv-lumen", "lv-myocardium")),
                             ("rv", ("rv-lumen", "rv-myocardium")),
                             ("la", ("la-lumen", "la-myocardium")),
                             ("ra", ("ra-lumen", "ra-myocardium"))):
        for node in candidates:
            if node in body:
                landmarks[name] = body[node].mean(axis=0)
                source[name] = f"centroid of the {node} node"
                break

    base = np.mean([landmarks[k] for k in ("mitral", "tricuspid") if k in landmarks], axis=0)
    cavity = body.get("lv-lumen")
    if cavity is None:
        cavity = body.get("lv-myocardium")
    apex, _ = bc.cavity_apex(cavity, base)
    landmarks["apex"] = apex
    source["apex"] = (
        "mean of the most apical percentile of the left ventricular cavity along that "
        "cavity's own principal axis, measured away from the atrioventricular base"
    )
    landmarks["av_base"] = base
    source["av_base"] = "midpoint of the mitral and tricuspid orifice centroids"

    # The venae cavae, by STRUCTURE ID rather than by glTF node name.
    #
    # `normal-rodero`'s caval inlets are tags 16 and 17 of its source, named on
    # 2026-08-22 from the source's own element label list by
    # `pipeline/name_rodero_inlets.py`. Their glTF nodes still carry the names
    # the asset was built with, so the pack's own id-to-node map is what is
    # followed here — an anatomical id resolved through the pack, rather than a
    # tag number written into this module where a re-ingest could quietly move
    # it. A pack without them simply has no caval landmarks, which is the whole
    # reason A4 and F1 are unbuildable on the chamber-labelled pack.
    pack = json.loads((pack_dir / "pack.json").read_text())
    node_for = {s["id"]: s.get("mesh_node") or s["id"] for s in pack["meshes"]["structures"]}
    for name, structure_id in (("svc", "superior-vena-cava-inlet"),
                               ("ivc", "inferior-vena-cava-inlet")):
        node = node_for.get(structure_id)
        if node is not None and node in body:
            landmarks[name] = body[node].mean(axis=0)
            source[name] = (
                f"centroid of the pack's own {structure_id} node. Named from the source's own "
                "element label list (Zenodo 4593738) and checked against the mesh by "
                "pipeline/name_rodero_inlets.py before the name was written."
            )

    parts = []
    for surface, _material, _node in read_gltf_surfaces(pack_dir / "assets" / "model.gltf"):
        parts.append(trimesh.Trimesh(
            vertices=to_body(np.asarray(surface.vertices, dtype=np.float64)),
            faces=np.asarray(surface.faces, dtype=np.int64), process=False,
        ))
    mesh = trimesh.util.concatenate(parts) if len(parts) > 1 else parts[0]
    ray_mesh, ray_error = _simplify_for_rays(mesh)

    return Heart(
        pack_id=pack_id, nodes=nodes, body=body, landmarks=landmarks,
        landmark_source=source, vertices=np.vstack(list(body.values())), mesh=ray_mesh,
        full_triangles=int(len(mesh.faces)), ray_mesh_error_mm=ray_error,
    )


# --------------------------------------------------------------------------- #
# finding the window                                                           #
# --------------------------------------------------------------------------- #

#: Named skin regions, as an operator would describe them before touching the
#: patient. Each is resolved against the measured chest, never hardcoded in
#: millimetres: "left sternal border" is the sternum's own left edge on this
#: body, "below the xiphoid" is that xiphoid's own tip.
WINDOW_REGIONS = ("left_parasternal", "apex", "subxiphoid", "suprasternal",
                  "right_parasternal")

#: Half-thickness of the skin shell used as the aperture surface, in mm.
SKIN_CELL_MM = 6.0

#: How far lateral of the sternal border the parasternal strip runs, in mm.
#: Beyond this the operator has stopped being parasternal.
PARASTERNAL_STRIP_MM = 35.0

#: Radius of the apical search, about where this heart's own apex reaches the
#: chest wall. The apex beat is palpated, not counted off the ribs, so the
#: window follows the heart rather than a fixed interspace.
APICAL_SEARCH_RADIUS_MM = 45.0

#: How far an aperture may sit off the view's anatomical plane.
#:
#: The sector's plane passes through the TRANSDUCER, so an aperture sitting off
#: the landmark plane produces a plane parallel to it and displaced by exactly
#: that much — and then the view misses every landmark that defines it by the
#: same distance. So this is the elevation slab, not a looser number: an
#: aperture the pose can be built from is one the pose's own plane contains.
APERTURE_PLANE_TOLERANCE_MM = legacy.SLAB_MM

#: Percentile band of in-plane tissue the sector is centred on.
#:
#: Not the extremes: one stray vertex from a decimation artefact or a
#: great-vessel stub at the edge of the slab would drag the aim by degrees. The
#: 1st and 99th percentiles of the angular spread are what an operator is
#: actually centring by eye.
CENTRING_PERCENTILES = (1.0, 99.0)

#: How far the imaging plane may be ROCKED off the strict landmark plane while
#: hunting for a window, in degrees, and in what order it is tried.
#:
#: This is the freedom a real operator has and a fixed three-point plane does
#: not. Two landmarks define a line; the plane through them can rotate about it
#: and still be the same view, with the third landmark drifting out of plane by
#: an amount that is measured rather than waved through. Smallest rock first, so
#: a pose only departs from the strict plane as far as it must to find a window.
PLANE_ROCK_STEPS_DEG = (0.0, 3.0, -3.0, 6.0, -6.0, 9.0, -9.0,
                        12.0, -12.0, 15.0, -15.0, 18.0, -18.0)

#: Levels along the left ventricular long axis tried for a short-axis view, as a
#: fraction from the atrioventricular base toward the apex. The canon's own
#: protocol for this view is a multi-level sweep, so the level is a free
#: parameter of the view rather than a property of the substrate.
SHORT_AXIS_LEVELS = tuple(round(0.10 + 0.05 * i, 2) for i in range(15))


def anterior_skin(chest: Chest) -> np.ndarray:
    """
    The front surface of the chest, one point per transverse cell.

    The skin concept is a closed shell around the whole torso, so a naive
    nearest-point search finds the BACK as readily as the front. Taking the
    most anterior point per cell keeps only the surface a transducer could
    actually be placed on.
    """
    skin = chest.skin
    cells = np.floor_divide(skin[:, [0, 2]], SKIN_CELL_MM).astype(np.int64)
    _, inverse = np.unique(cells, axis=0, return_inverse=True)
    inverse = np.asarray(inverse).reshape(-1)
    best = np.full(int(inverse.max()) + 1, np.inf)
    np.minimum.at(best, inverse, skin[:, 1])
    keep = skin[:, 1] <= best[inverse] + 1e-9
    return skin[keep]


def window_candidates(chest: Chest, region: str, heart: Heart) -> np.ndarray:
    """Skin points inside one named acoustic window, from measured landmarks."""
    skin = anterior_skin(chest)
    x, z = skin[:, 0], skin[:, 2]
    midline = chest.midline_x
    left_border = float(chest.sternum[:, 0].max())
    right_border = float(chest.sternum[:, 0].min())
    xiphoid_tip = float(chest.xiphoid[:, 2].min())
    notch = float(chest.manubrium[:, 2].max())

    if region == "left_parasternal":
        top = float(chest.cartilages[("left", 2)][:, 2].max())
        bottom = float(chest.cartilages[("left", 6)][:, 2].min())
        # Beside the sternum, and only beside it. The strip stops well medial to
        # the apical window so the two cannot converge on one aperture and
        # report themselves as two different views.
        mask = (x > left_border) & (x < left_border + PARASTERNAL_STRIP_MM) \
            & (z > bottom) & (z < top)
    elif region == "right_parasternal":
        top = float(chest.cartilages[("right", 2)][:, 2].max())
        bottom = float(chest.cartilages[("right", 6)][:, 2].min())
        mask = (x < right_border) & (x > right_border - PARASTERNAL_STRIP_MM) \
            & (z > bottom) & (z < top)
    elif region == "apex":
        # Lateral to the parasternal strip, around where this heart's own apex
        # reaches the chest wall — the palpated apex beat, not a fixed rib space.
        apex = heart.landmarks["apex"]
        mask = (x > left_border + PARASTERNAL_STRIP_MM) \
            & (np.hypot(x - apex[0], z - apex[2]) < APICAL_SEARCH_RADIUS_MM)
    elif region == "subxiphoid":
        # Strictly BELOW the xiphoid tip: the whole point of the subcostal window
        # is that the beam enters under the costal margin rather than through it.
        mask = (np.abs(x - midline) < 45.0) & (z < xiphoid_tip) & (z > xiphoid_tip - 75.0)
    elif region == "suprasternal":
        mask = (np.abs(x - midline) < 22.0) & (z > notch) & (z < notch + 45.0)
    else:
        raise SystemExit(f"unknown acoustic window region {region!r}")
    return skin[mask]


def fan_rays(origin: np.ndarray, beam: np.ndarray, lateral: np.ndarray,
             half_angle_rad: float, count: int = FAN_RAYS) -> np.ndarray:
    """Unit directions across the sector, in the imaging plane."""
    angles = np.linspace(-half_angle_rad, half_angle_rad, count)
    return (np.cos(angles)[:, None] * beam) + (np.sin(angles)[:, None] * lateral)


@dataclass
class WindowScore:
    aperture: np.ndarray
    beam: np.ndarray
    lateral: np.ndarray
    bone_fraction: float
    lung_fraction: float
    cartilage_fraction: float
    core_bone: int
    core_lung: int
    core_on_target: int
    plane_offset_mm: float

    @property
    def open(self) -> bool:
        """
        A window is open when the part of the sector that reaches the heart is
        clear of bone and air, and the sector as a whole is not mostly rib.
        """
        return (self.core_bone == 0 and self.core_lung == 0
                and self.core_on_target > 0
                and self.bone_fraction <= FAN_BONE_BUDGET)

    def rank(self) -> tuple:
        """Best first: an open core, then least obstruction, then closest to plane."""
        return (self.core_bone + self.core_lung, round(self.bone_fraction, 3),
                round(self.lung_fraction, 3), round(self.plane_offset_mm, 1))


def score_apertures(chest: Chest, heart: "Heart", apertures: np.ndarray, aim: np.ndarray,
                    normal: np.ndarray, reach_mm: float,
                    plane_offsets: np.ndarray,
                    sector_deg: float = FAN_ANGLE_DEG) -> list[WindowScore]:
    """
    Cast every candidate's whole fan in one batch and report what stops each.

    One call per blocker class rather than one per aperture: the ray engine is
    vectorised, and sliding across a window is hundreds of apertures times
    twenty-one rays.
    """
    beams = aim - apertures
    beams = beams - (beams @ normal)[:, None] * normal
    beams /= np.linalg.norm(beams, axis=1)[:, None]
    laterals = np.cross(normal, beams)
    laterals /= np.linalg.norm(laterals, axis=1)[:, None]

    half = np.radians(sector_deg / 2.0)
    angles = np.linspace(-half, half, FAN_RAYS)
    directions = (np.cos(angles)[None, :, None] * beams[:, None, :]
                  + np.sin(angles)[None, :, None] * laterals[:, None, :])
    origins = np.repeat(apertures[:, None, :], FAN_RAYS, axis=1)

    flat_dir = np.ascontiguousarray(directions.reshape(-1, 3))
    flat_org = np.ascontiguousarray(origins.reshape(-1, 3))

    reach = heart.entry_distance(flat_org, flat_dir)
    reaches_heart = np.isfinite(reach)
    reach = np.where(reaches_heart, reach, reach_mm)

    hits = chest.blocked(flat_org, flat_dir, reach)
    shape = (len(apertures), FAN_RAYS)
    bone = hits["bone"].reshape(shape)
    lung = hits["lung"].reshape(shape)
    cartilage = hits["cartilage"].reshape(shape)
    on_target = reaches_heart.reshape(shape)

    core = np.abs(np.linspace(-1.0, 1.0, FAN_RAYS)) <= CORE_FRACTION
    return [
        WindowScore(
            aperture=apertures[i], beam=beams[i], lateral=laterals[i],
            bone_fraction=float(bone[i].mean()),
            lung_fraction=float(lung[i].mean()),
            cartilage_fraction=float(cartilage[i].mean()),
            core_bone=int((bone[i] & on_target[i])[core].sum()),
            core_lung=int((lung[i] & on_target[i])[core].sum()),
            core_on_target=int(on_target[i][core].sum()),
            plane_offset_mm=float(plane_offsets[i]),
        )
        for i in range(len(apertures))
    ]


def find_window(chest: Chest, heart: Heart, region: str, plane_point: np.ndarray,
                normal: np.ndarray, aim: np.ndarray,
                sector_deg: float = FAN_ANGLE_DEG,
                stride: int = 3) -> tuple[WindowScore | None, dict]:
    """
    Slide across the named region until the beam finds a way through.

    This is the search an operator performs, done exhaustively instead of by
    feel. Candidates are restricted to skin that can actually stand in the
    view's own imaging plane, then every one of them is cast and scored, and the
    best-ranked survivor is the window. If none survives, the report says which
    blocker was responsible rather than returning a pose that images a rib.
    """
    candidates = window_candidates(chest, region, heart)
    if len(candidates) == 0:
        return None, {"region": region, "tried": 0, "reason": "no skin in this region"}

    offsets = np.abs((candidates - plane_point) @ normal)
    in_plane = candidates[offsets <= APERTURE_PLANE_TOLERANCE_MM]
    plane_offsets = offsets[offsets <= APERTURE_PLANE_TOLERANCE_MM]
    if len(in_plane) == 0:
        nearest = float(offsets.min())
        return None, {
            "region": region, "tried": 0,
            "reason": (f"no skin in this window lies within "
                       f"{APERTURE_PLANE_TOLERANCE_MM:.0f} mm of the view's imaging plane; "
                       f"the closest is {nearest:.1f} mm off it"),
        }

    order = np.argsort(plane_offsets)[::stride]
    reach = float(np.linalg.norm(aim - plane_point)) + 140.0
    scores = score_apertures(
        chest, heart, in_plane[order], aim, normal, reach, plane_offsets[order], sector_deg
    )
    scores.sort(key=lambda s: s.rank())
    best = scores[0]
    report = {
        "region": region,
        "verdict": "open" if best.open else "SHUT — no aperture in this window clears the core",
        "tried": len(scores),
        "open": bool(best.open),
        "best_bone_fraction": round(best.bone_fraction, 3),
        "best_lung_fraction": round(best.lung_fraction, 3),
        "best_cartilage_fraction": round(best.cartilage_fraction, 3),
        "core_rays_blocked_by_bone": best.core_bone,
        "core_rays_blocked_by_lung": best.core_lung,
        "core_rays_reaching_the_heart": best.core_on_target,
        "aperture_offset_from_imaging_plane_mm": round(best.plane_offset_mm, 2),
        "open_apertures": int(sum(1 for s in scores if s.open)),
        "sector_deg": sector_deg,
    }
    return (best if best.open else None), report


# --------------------------------------------------------------------------- #
# the views                                                                    #
# --------------------------------------------------------------------------- #


def _plane_normal(points: list[np.ndarray]) -> np.ndarray:
    """Unit normal of the plane through three measured landmarks."""
    a, b, c = points
    return legacy.unit(np.cross(b - a, c - a))


def _rotate_about(axis: np.ndarray, angle_deg: float, vector: np.ndarray) -> np.ndarray:
    axis = legacy.unit(axis)
    t = np.radians(angle_deg)
    return (vector * np.cos(t) + np.cross(axis, vector) * np.sin(t)
            + axis * float(axis @ vector) * (1 - np.cos(t)))


#: The canon's views, each reduced to what can be MEASURED on a pack plus the
#: window an operator would use. `plane` names the landmarks whose plane the
#: view is; `aim` is what the beam is pointed through; `clock` is the canon's
#: indicator position, which is checked against the pose rather than imposed on
#: it.
@dataclass
class ViewSpec:
    view_id: str
    family: str
    name: str
    aliases: tuple[str, ...]
    window: str
    plane: tuple[str, ...]
    aim: tuple[str, ...]
    clock: str
    vertex: str
    in_plane: tuple[str, ...]
    contained: tuple[str, ...]
    #: Landmarks that must NOT lie in the imaging plane.
    #:
    #: Some views are defined as much by what they exclude as by what they
    #: contain, and the apical two-chamber is the clearest case: what makes it
    #: the two-chamber rather than the three-chamber is that the AORTA is out of
    #: plane, and what makes it apical-two rather than apical-four is that the
    #: RIGHT-SIDED chambers are. Without that, a rotation about the long axis
    #: that happens to sweep the wrong way still satisfies every positive test —
    #: apex in plane, mitral in plane, both inside the sector — and produces a
    #: second three-chamber wearing the two-chamber's name.
    #:
    #: Tested against the PLANE rather than the sector, because "the aorta is
    #: not in this plane" is the anatomical statement; a sector is wide and deep
    #: and may well have the aortic root somewhere in its far field without the
    #: plane going through it.
    out_of_plane: tuple[str, ...] = ()
    landmark_text: str = ""
    #: Turn the landmark plane this far about its own hinge line, in degrees.
    #:
    #: The hinge is the line through the first two `in_plane` landmarks — the
    #: same line `_candidate_planes` rocks about — so those two stay EXACTLY in
    #: plane through the turn and the view keeps the landmarks that define it.
    #:
    #: This is how a view that is "the four-chamber rotated sixty degrees" is
    #: built, and it is deliberately not a probe turn. Rotating the probe about
    #: its own beam is the manoeuvre a sonographer performs, and it produces this
    #: plane only when the beam runs along the axis being rotated about. On both
    #: of these composites it does not: the apical aperture stands 45-72 mm off a
    #: heart whose apex is tens of millimetres off the beam line, so turning
    #: about the beam swings the apex and the mitral straight out of the plane —
    #: measured at 5.7 mm off by ten degrees and 28.8 mm by sixty. Turning about
    #: the hinge keeps them at zero and searches the window again for an aperture
    #: that can stand on the result, which is the honest reading of "rotate to
    #: the two-chamber" on a substrate whose window is this far from its apex.
    #:
    #: BOTH SENSES are built and the canon's indicator clock chooses, for the
    #: same reason it chooses for a probe turn: "sixty degrees" does not say
    #: which way, and a plane and its 180-degree partner are the same plane, so
    #: the two senses are two genuinely different views.
    plane_turned_about_its_own_hinge_deg: float = 0.0
    perpendicular_to_long_axis: bool = False
    #: Reached from another view's pose rather than by its own window search.
    derive_from: str | None = None
    #: Which axis the plane is turned about. "lateral" is an anterior or
    #: posterior ANGULATION; "beam" is a rotation of the probe in place;
    #: "long_axis" is a rotation about the left ventricular long axis, which is
    #: what rotating an APICAL probe actually turns the plane about, because the
    #: transducer sits on that axis rather than across it.
    derive_axis: str = "beam"
    #: Turn until this landmark lies in the plane. `None` uses a fixed angle.
    derive_until_in_plane: str | None = None
    derive_fixed_deg: float = 0.0


VIEW_SPECS: tuple[ViewSpec, ...] = (
    ViewSpec(
        view_id="a3-subcostal-coronal", family="A",
        name="Subcostal coronal (draft)", aliases=("subxiphoid long axis",),
        window="subxiphoid", plane=("mitral", "tricuspid", "la"),
        aim=("mitral", "tricuspid"), clock="3:00", vertex="down",
        in_plane=("mitral", "tricuspid"), contained=("mitral", "tricuspid"),
        landmark_text=(
            "Below the xiphoid process, on the skin, beam angled up under the costal margin. "
            "The plane is the one containing both atrioventricular orifices and the left "
            "atrium, which is where the atrial septum lies most nearly perpendicular to a beam "
            "entering from below — the payload the canon gives this view. This window could "
            "not be placed on a heart-only substrate at all: 'below the diaphragm' is a body "
            "axis, and it took a registered chest to have one."
        ),
    ),
    ViewSpec(
        view_id="a5-subcostal-rao", family="A",
        name="Subcostal right anterior oblique (draft)",
        aliases=("subcostal RAO", "TET view", "SEROV", "subcostal RV three-chamber"),
        window="subxiphoid", plane=("tricuspid", "pulmonary", "rv"),
        aim=("tricuspid", "pulmonary"), clock="2:00", vertex="down",
        in_plane=("tricuspid", "pulmonary"), contained=("tricuspid", "pulmonary", "rv"),
        landmark_text=(
            "Below the xiphoid process, beam angled up under the costal margin, rotated "
            "counterclockwise from the coronal. What makes this view the view is that RV "
            "INFLOW and RV OUTFLOW lie in ONE plane, so that is exactly what is required "
            "here: the plane through the tricuspid orifice, the pulmonary orifice and the "
            "right ventricular centroid, with both orifices inside the sector. The canon's "
            "en-face aortic valve and its conal-septum deviation are the teaching payload and "
            "are NOT demonstrable on either substrate — neither carries valve leaflets and "
            "neither carries a separately tagged infundibular septum — so this pose reaches "
            "the plane and not the payload, which is what its Draft status is for. It is "
            "searched from its own aperture rather than turned from the subcostal coronal: "
            "the rotation is large enough that an operator repositions."
        ),
    ),
    ViewSpec(
        view_id="a6-subcostal-lao", family="A",
        name="Subcostal left anterior oblique (draft)",
        aliases=("subcostal LAO",),
        window="subxiphoid", plane=("mitral", "aortic", "la"),
        aim=("mitral", "aortic"), clock="5:00", vertex="down",
        in_plane=("mitral", "aortic"), contained=("mitral", "aortic", "la"),
        landmark_text=(
            "Below the xiphoid process, beam angled up under the costal margin, rotated "
            "clockwise from the coronal. The canon gives this view the left ventricular "
            "outflow tract, the atrial septum and the atrioventricular valves seen en face; "
            "of those three only the OUTFLOW TRACT is measurable on these substrates, so the "
            "plane is the one through the mitral orifice, the aortic orifice and the left "
            "atrium, and the atrial septum is what that plane passes through rather than "
            "something this pose can claim to demonstrate. There is no separately tagged "
            "atrial septum on either pack and none was invented. En-face valves need "
            "leaflets, which neither pack has."
        ),
    ),
    ViewSpec(
        view_id="a4-subcostal-sagittal", family="A",
        name="Subcostal sagittal bicaval (draft)",
        aliases=("subcostal short axis", "subxiphoid bicaval"),
        window="subxiphoid", plane=("svc", "ivc", "ra"),
        aim=("svc", "ivc"), clock="6:00", vertex="down",
        in_plane=("svc", "ivc"), contained=("svc", "ivc", "ra"),
        landmark_text=(
            "Below the xiphoid process, beam angled up under the costal margin, indicator to "
            "the feet. The canon makes the BICAVAL the reference plane of this view — superior "
            "vena cava and intrahepatic inferior vena cava draining into the right atrium, with "
            "the atrial septum between the atria — so the plane is the one through both caval "
            "inlets and the right atrial centroid, with both cavae inside the sector. This view "
            "was unbuildable on every substrate in this repository until 2026-08-22, and the "
            "blocker was a NAME rather than geometry: Rodero's caval inlets shipped as "
            "\"Tagged region 16\" and \"Tagged region 17\" because naming anatomy is an owner "
            "decision and no owner had made it. The intrahepatic IVC and the azygos continuity "
            "the canon also asks for are NOT here — this mesh stops at the caval inlets — and "
            "the atrial septum is not tagged separately on this pack, so the plane passes "
            "through it rather than demonstrating it."
        ),
    ),
    ViewSpec(
        view_id="f1-right-parasternal-bicaval", family="F",
        name="Right parasternal bicaval (draft)",
        aliases=("bicaval", "right sternal border sagittal"),
        window="right_parasternal", plane=("svc", "ivc", "ra"),
        aim=("svc", "ivc"), clock="12:00", vertex="up",
        in_plane=("svc", "ivc"), contained=("svc", "ivc"),
        landmark_text=(
            "Right sternal border, in the interspace named below, patient in the RIGHT lateral "
            "decubitus. The same bicaval plane as A4 reached through a different window, which "
            "is the point of carrying both: the canon gives this one the atrial septum lying "
            "most nearly perpendicular to the beam, which is what makes it the "
            "sinus-venosus-exclusion view. REAUTHORED, not restored. The pose that carried this "
            "id until 2026-08-22 was hand-authored from the canon rather than derived from this "
            "mesh, its transducer stood 66.05 mm off the skin, and it was withdrawn under the "
            "probe-contact rule. This one is placed by the same window search as every other "
            "pose here, on a plane built from the caval inlets the source itself names. The "
            "atrial septum is not tagged separately on this pack, so the perpendicularity the "
            "canon prizes is a property of the plane and not something this pose demonstrates."
        ),
    ),
    ViewSpec(
        view_id="b1-apical-four-chamber", family="B",
        name="Apical four-chamber (draft)", aliases=("A4C", "apical 4C"),
        window="apex", plane=("apex", "mitral", "tricuspid"),
        aim=("mitral", "tricuspid"), clock="3:00", vertex="down",
        in_plane=("apex", "mitral", "tricuspid"),
        contained=("apex", "mitral", "tricuspid"),
        landmark_text=(
            "At the cardiac apex on the skin, in the interspace named below. The plane is the "
            "one through the apex and both atrioventricular orifices. The three apical views "
            "below are reached from THIS aperture by angling and rotating the probe, which is "
            "what an operator does: the transducer is not lifted and replaced between them."
        ),
    ),
    ViewSpec(
        view_id="b2-apical-five-chamber", family="B",
        name="Apical five-chamber (draft)", aliases=("A5C",),
        window="apex", plane=("apex", "mitral", "tricuspid"),
        aim=("mitral", "aortic"), clock="3:00", vertex="down",
        in_plane=("aortic",), contained=("aortic",),
        derive_from="b1-apical-four-chamber", derive_axis="lateral",
        derive_until_in_plane="aortic",
        landmark_text=(
            "The four-chamber window, ANGLED anteriorly about the probe's own marker axis "
            "until the left ventricular outflow tract and the aortic orifice enter the plane. "
            "The angle is solved from the geometry, not chosen, and is reported. The apex is "
            "NOT required to stay in the plane through that angulation: foreshortening it is "
            "what the manoeuvre does, and its residual is measured and reported instead."
        ),
    ),
    ViewSpec(
        view_id="b3-apical-two-chamber", family="B",
        name="Apical two-chamber (draft)", aliases=("A2C",),
        window="apex", plane=("apex", "mitral", "tricuspid"),
        aim=("apex", "mitral"), clock="2:00", vertex="down",
        in_plane=("apex", "mitral"), contained=("apex", "mitral"),
        out_of_plane=("tricuspid", "aortic"),
        plane_turned_about_its_own_hinge_deg=60.0,
        landmark_text=(
            "The four-chamber plane, TURNED sixty degrees about the left ventricular long "
            "axis — the line through the measured apex and the mitral orifice — so that both "
            "of those stay exactly in plane while the right-sided chambers leave it. The "
            "direction of the turn is decided by the canon's indicator clock rather than "
            "assumed, because sixty degrees does not say which way, and the two ways are "
            "different views. Two exclusions are ENFORCED and they are what make this the "
            "two-chamber: the TRICUSPID must be out of plane, which is the manoeuvre's whole "
            "purpose, and so must the AORTIC orifice, because a plane through the apex, the "
            "mitral orifice and the aorta is the THREE-chamber, which this pack carries "
            "separately. The aperture is SEARCHED rather than inherited from the four-chamber "
            "pose: on this composite the apical window stands far enough off the heart that "
            "the four-chamber beam does not run along the long axis, so turning the probe "
            "where it stands swings the apex out of the plane instead of round it. Which "
            "structures the sector then crosses is measured rather than assumed."
        ),
    ),
    ViewSpec(
        view_id="b4-apical-three-chamber", family="B",
        name="Apical three-chamber (draft)", aliases=("A3C", "apical long axis"),
        window="apex", plane=("apex", "mitral", "aortic"),
        aim=("mitral", "aortic"), clock="11:00", vertex="down",
        in_plane=("apex", "mitral", "aortic"), contained=("mitral", "aortic"),
        landmark_text=(
            "Its own aperture in the apical window: the rotation from the four-chamber is large "
            "enough that an operator repositions rather than pivots, and a turned pose from the "
            "four-chamber aperture fails this view's own landmark checks where a searched one "
            "passes. The plane is the SAME anatomical plane the parasternal long "
            "axis images — the apex, the mitral orifice and the aortic orifice — reached from "
            "a different window, and this pack carries both so the pair can be compared."
        ),
    ),
    ViewSpec(
        view_id="b5-apical-rv-focused", family="B",
        name="Apical RV-focused (draft)", aliases=("RV-focused apical",),
        window="apex", plane=("apex", "tricuspid", "rv"),
        aim=("tricuspid", "rv"), clock="3:00", vertex="down",
        in_plane=("tricuspid", "rv"), contained=("tricuspid", "rv"),
        landmark_text=(
            "The apical window moved medially, on the plane through the apex, the tricuspid "
            "orifice and the right ventricular centroid."
        ),
    ),
    ViewSpec(
        view_id="c1-parasternal-long-axis", family="C",
        name="Parasternal long axis (draft)", aliases=("PLAX",),
        window="left_parasternal", plane=("apex", "mitral", "aortic"),
        aim=("mitral", "aortic"), clock="10:00", vertex="up",
        in_plane=("apex", "mitral", "aortic"), contained=("mitral", "aortic"),
        landmark_text=(
            "Left sternal border, in the interspace named below. The plane is the left "
            "ventricular long axis together with the aortic root. The apex is required to lie "
            "IN the plane but not inside the sector: foreshortening it is a property of this "
            "window, not a defect in the pose."
        ),
    ),
    ViewSpec(
        view_id="c2-parasternal-short-axis", family="C",
        name="Parasternal short axis (draft)", aliases=("PSAX",),
        window="left_parasternal", plane=("apex", "mitral", "aortic"),
        aim=("mitral",), clock="2:00", vertex="up",
        in_plane=(), contained=("mitral",),
        derive_from="c1-parasternal-long-axis", derive_axis="to_aim",
        derive_fixed_deg=90.0,
        landmark_text=(
            "The long-axis window, with the probe ROTATED ninety degrees in place. That is the "
            "manoeuvre, not an approximation of it. Whether the result is really a short axis "
            "is then checked rather than assumed: the angle between the resulting plane's "
            "normal and the measured left ventricular long axis is reported, and a true short "
            "axis has them parallel."
        ),
    ),
)


def build_plane(spec: ViewSpec, marks: dict[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """`(point on the plane, unit normal)`, from measured landmarks only."""
    missing = [n for n in spec.plane if n not in marks]
    if missing:
        raise KeyError(", ".join(missing))
    points = [marks[n] for n in spec.plane]

    if spec.perpendicular_to_long_axis:
        long_axis = legacy.unit(marks["apex"] - marks["av_base"])
        return marks["mitral"], long_axis

    normal = _plane_normal(points)
    turn = spec.plane_turned_about_its_own_hinge_deg
    if turn:
        hinge_names = hinge_of(spec, marks)
        hinge = legacy.unit(marks[hinge_names[1]] - marks[hinge_names[0]])
        return marks[hinge_names[0]], legacy.unit(_rotate_about(hinge, turn, normal))
    return points[0], normal


def hinge_of(spec: ViewSpec, marks: dict[str, np.ndarray]) -> list[str]:
    """The line a plane is turned and rocked about: its first two in-plane marks."""
    return [n for n in spec.in_plane if n in marks][:2] or list(spec.plane[:2])


def implied_clock(lateral: np.ndarray) -> str:
    """
    The indicator position this pose actually implies, on the chest clock.

    12 is toward the head, 3 is patient-left, 6 is toward the feet, 9 is
    patient-right — the canon's own convention. Computed from the pose and
    compared with the canon rather than copied from it, because a pose whose
    marker points somewhere else is a different view wearing the right name.
    """
    angle = float(np.degrees(np.arctan2(lateral[0], lateral[2]))) % 360.0
    hour = int(round(angle / 30.0)) % 12
    return f"{12 if hour == 0 else hour}:00"


def clock_disagreement_hours(a: str, b: str) -> float:
    ha, hb = int(a.split(":")[0]) % 12, int(b.split(":")[0]) % 12
    return min((ha - hb) % 12, (hb - ha) % 12)


# --------------------------------------------------------------------------- #
# building and checking one pose                                               #
# --------------------------------------------------------------------------- #


def _ceil_hundredth_cm(mm: float) -> float:
    return float(np.ceil(mm / 10.0 * 100.0) / 100.0)


@dataclass
class BuiltView:
    spec: ViewSpec
    sector: legacy.Sector
    score: WindowScore
    report: dict


def _candidate_planes(spec: ViewSpec, marks: dict[str, np.ndarray]
                      ) -> list[tuple[np.ndarray, np.ndarray, dict]]:
    """
    The planes worth trying for this view, nearest the canonical one first.

    A three-point landmark plane is a single plane in space, and the curve where
    it meets the skin may cross no usable window at all. A real operator has two
    freedoms that a fixed plane does not, and both are encoded here rather than
    being taken silently:

    * ROCK — rotate the plane about the line through two of its own landmarks.
      Those two stay exactly in plane; the third drifts, by an amount that is
      measured and reported per pose.
    * LEVEL — for the short axis, slide the plane along the long axis. That is
      not a liberty at all: the canon's protocol for this view IS a multi-level
      sweep, so the level is a parameter of the view.
    """
    if spec.perpendicular_to_long_axis:
        base, apex = marks["av_base"], marks["apex"]
        axis = legacy.unit(apex - base)
        return [
            (base + (apex - base) * level, axis,
             {"short_axis_level_from_base": level, "plane_rock_deg": 0.0})
            for level in SHORT_AXIS_LEVELS
        ]

    _, normal = build_plane(spec, marks)
    hinge_names = hinge_of(spec, marks)
    hinge = legacy.unit(marks[hinge_names[1]] - marks[hinge_names[0]])
    # The hinge's own first landmark, always. It is a point on the plane like
    # any other, but `find_window` measures its search reach from it, so
    # changing which one is used moves the scoring of rays that never reach the
    # heart — and with it poses that were already placed.
    anchor = marks[hinge_names[0]]
    turned = spec.plane_turned_about_its_own_hinge_deg
    out = []
    for rock in PLANE_ROCK_STEPS_DEG:
        rocked = legacy.unit(_rotate_about(hinge, rock, normal)) if rock else normal
        adjustment = {
            "plane_rock_deg": rock,
            "plane_rocked_about": f"the line through the {hinge_names[0]} and the "
                                  f"{hinge_names[1]}",
        }
        if turned:
            adjustment["plane_turned_about_hinge_deg"] = turned
            adjustment["plane_turn_basis"] = (
                "the canon's rotation for this view, applied to the plane about the line "
                f"through the {hinge_names[0]} and the {hinge_names[1]} so that both stay in "
                "it; the sense is chosen by the canon's indicator clock"
            )
        out.append((anchor, rocked, adjustment))
    return out


def turn_to_contain(origin: np.ndarray, normal: np.ndarray, axis: np.ndarray,
                    target: np.ndarray) -> float:
    """
    The angle, in degrees, that turns this plane about `axis` until it contains
    `target`.

    Solved rather than searched. Both probe axes are perpendicular to the plane
    normal, so turning by t sends n to n cos t + (a x n) sin t, and the
    condition (P - O) . n(t) = 0 is one equation with a closed form. The smaller
    of the two solutions is taken, because a view is reached by the smallest
    movement that gets there.
    """
    offset = target - origin
    u = float(offset @ normal)
    v = float(offset @ np.cross(axis, normal))
    if abs(u) < 1e-12 and abs(v) < 1e-12:
        return 0.0
    angle = float(np.degrees(np.arctan2(-u, v)))
    for candidate in (angle, angle + 180.0, angle - 180.0):
        if -90.0 <= candidate <= 90.0:
            return candidate
    return angle


def build_view(spec: ViewSpec, chest: Chest, heart: Heart,
               done: dict[str, "BuiltView"],
               head: ProbeHead = DEFAULT_HEAD,
               sector_deg: float = DEFAULT_SECTOR_DEG) -> tuple[BuiltView | None, dict]:
    """One pose at one probe setting, or the measured reason there is not one."""
    marks = heart.landmarks
    missing = [n for n in spec.plane if n not in marks]
    if missing:
        return None, {"view_id": spec.view_id, "built": False,
                      "reason": f"pack has no landmark(s): {', '.join(missing)}"}
    for name in (*spec.in_plane, *spec.contained,
                 *( (spec.derive_until_in_plane,) if spec.derive_until_in_plane else () )):
        if name not in marks:
            return None, {"view_id": spec.view_id, "built": False,
                          "reason": f"pack has no {name} landmark, which this view is about"}

    aim_names = [n for n in spec.aim if n in marks]
    if not aim_names:
        return None, {"view_id": spec.view_id, "built": False,
                      "reason": "pack has none of this view's aim landmarks"}
    aim = np.mean([marks[n] for n in aim_names], axis=0)

    if spec.derive_from is not None:
        parent = done.get(spec.derive_from)
        if parent is None:
            return None, {"view_id": spec.view_id, "built": False,
                          "reason": f"reached by turning the probe in the "
                                    f"{spec.derive_from} window, which was not found"}
        return _derive_view(spec, chest, heart, parent, aim, head, sector_deg)

    # Both senses of a canonical plane turn, each searched in full, and the
    # canon's indicator clock chooses between whichever of them build. A spec
    # with no turn has exactly one sense, so nothing that built before moves.
    turn = spec.plane_turned_about_its_own_hinge_deg
    senses = [spec] if not turn else [
        spec, replace(spec, plane_turned_about_its_own_hinge_deg=-turn)
    ]

    attempts: list[dict] = []
    made: list[tuple[BuiltView, dict]] = []
    sense_outcome: list[dict] = []
    for sense in senses:
        sense_turn = sense.plane_turned_about_its_own_hinge_deg
        before = len(made)
        first_reason: str | None = None
        for plane_point, normal, adjustment in _candidate_planes(sense, marks):
            score, window_report = find_window(chest, heart, sense.window, plane_point, normal,
                                               aim, sector_deg)
            if score is None:
                attempts.append({**adjustment, "window": window_report})
                first_reason = first_reason or (window_report.get("reason")
                                                or window_report.get("verdict"))
                continue
            built, report = _finish_view(spec, chest, heart, score.aperture, score.beam,
                                         score.lateral, score, aim, adjustment, window_report,
                                         head, sector_deg)
            if built is not None:
                made.append((built, report))
                break
            attempts.append({**adjustment, "window": window_report,
                             "rejected": report.get("reason")})
            first_reason = first_reason or report.get("reason")
        sense_outcome.append({
            "turn_deg": sense_turn,
            "built": len(made) > before,
            "why_not": None if len(made) > before else first_reason,
        })
    if made:
        chosen = min(made, key=lambda pair: pair[1].get("indicator_disagreement_hours", 99))
        if turn:
            # Which way round the plane was turned is a real choice, so the
            # reader gets both outcomes rather than only the winner. When the
            # other sense simply has no window, the indicator disagreement left
            # on this pose is a fact about the chest and not a coin flip.
            built, report = chosen
            adjustment = {**report["plane_adjustment"], "both_senses_tried": sense_outcome}
            report = {**report, "plane_adjustment": adjustment}
            built.report["plane_adjustment"] = adjustment
            chosen = (built, report)
        return chosen

    informative = next((a for a in attempts if a.get("rejected")), attempts[0] if attempts else {})
    return None, {
        "view_id": spec.view_id, "built": False,
        "reason": "no plane in this view's allowed range found an open window that also "
                  "contained the view's own landmarks",
        "planes_tried": len(attempts),
        "window": informative.get("window"),
        "first_rejection": informative.get("rejected"),
    }


def _derive_view(spec: ViewSpec, chest: Chest, heart: Heart, parent: "BuiltView",
                 aim: np.ndarray, head: ProbeHead = DEFAULT_HEAD,
                 sector_deg: float = DEFAULT_SECTOR_DEG) -> tuple[BuiltView | None, dict]:
    """
    A view reached by turning the probe where it already stands.

    The aperture is the parent's — the transducer is not lifted — and the plane
    is turned about one of the probe's own axes. The window is then re-cast from
    scratch through the NEW plane, because turning a probe can close a window
    that was open, and a view that images a rib is not a view whatever
    manoeuvre produced it.

    ## Which WAY the probe is turned, when the angle is a fixed one

    A solved angle has a sense: it is whatever brings the named landmark into
    the plane. A canonical fixed angle does not. Sixty degrees from the
    four-chamber is a real instruction and "sixty degrees which way" is not in
    it, and the two senses are different planes through the same aperture — one
    of them sweeps toward the left-sided chambers and the other toward the right.

    Geometry cannot pick between them, and the canon can: it gives this view an
    INDICATOR CLOCK, and the clock is exactly a statement about which way round
    the probe is. So both senses are built and the one whose pose implies a
    clock nearer the canon's is kept, with the original sense breaking a tie.
    This is the canon used as a check that happens to also be a tie-break, not
    as a constraint imposed on the geometry: the disagreement that is left is
    still measured and still reported.

    A 90 degree turn is exempt in effect rather than by rule — rotating a normal
    by plus or minus ninety about an axis in its own plane gives opposite
    normals, which is the same plane — so the short axis is untouched by this.
    """
    origin = parent.sector.origin
    beam, lateral = parent.sector.beam, parent.sector.lateral
    normal = parent.sector.normal
    if spec.derive_axis == "lateral":
        axis = lateral
    elif spec.derive_axis == "long_axis":
        axis = legacy.unit(heart.landmarks["mitral"] - heart.landmarks["apex"])
    elif spec.derive_axis == "to_aim":
        axis = legacy.unit(aim - origin)
    else:
        axis = beam
    axis = legacy.unit(axis - float(axis @ normal) * normal) if abs(float(axis @ normal)) > 1e-9 \
        else axis

    if spec.derive_until_in_plane is not None:
        turns = [(turn_to_contain(origin, normal, axis,
                                  heart.landmarks[spec.derive_until_in_plane]),
                  f"solved to bring the {spec.derive_until_in_plane} into the plane")]
    else:
        fixed = spec.derive_fixed_deg
        turns = [(fixed, "the canonical fixed angle for this manoeuvre")]
        if abs(fixed) > 1e-9:
            turns.append((-fixed, "the canonical fixed angle, turned the other way; the "
                                  "canon's indicator clock is what chooses between the two"))

    outcomes = [
        _turn_and_finish(spec, chest, heart, origin, beam, lateral, normal, axis,
                         angle, basis, aim, head, sector_deg)
        for angle, basis in turns
    ]
    made = [(built, report) for built, report in outcomes if built is not None]
    if made:
        return min(made, key=lambda pair: pair[1].get("indicator_disagreement_hours", 99))
    return outcomes[0]


def _turn_and_finish(spec: ViewSpec, chest: Chest, heart: Heart, origin: np.ndarray,
                     beam: np.ndarray, lateral: np.ndarray, normal: np.ndarray,
                     axis: np.ndarray, angle: float, solved: str, aim: np.ndarray,
                     head: ProbeHead, sector_deg: float) -> tuple[BuiltView | None, dict]:
    """One turn of the probe, cast, checked, and slid within its window if it shut."""
    new_normal = legacy.unit(_rotate_about(axis, angle, normal))
    if spec.derive_axis == "lateral":
        new_beam, new_lateral = legacy.unit(_rotate_about(axis, angle, beam)), lateral
    else:
        new_beam, new_lateral = beam, legacy.unit(_rotate_about(axis, angle, lateral))

    aimed = aim - origin
    aimed = aimed - float(aimed @ new_normal) * new_normal
    if float(np.linalg.norm(aimed)) > 1e-9:
        new_beam = legacy.unit(aimed)
        new_lateral = legacy.unit(np.cross(new_normal, new_beam))

    scores = score_apertures(chest, heart, origin[None, :], aim, new_normal,
                             float(np.linalg.norm(aim - origin)) + 140.0, np.zeros(1),
                             sector_deg)
    score = scores[0]
    adjustment = {
        "derived_from": spec.derive_from,
        "probe_axis_turned_about": spec.derive_axis,
        "turn_deg": round(angle, 2),
        "turn_basis": solved,
        "aperture_unchanged_from_parent": True,
    }
    window_report = {
        "region": spec.window,
        "verdict": "open" if score.open else "SHUT after the turn",
        "tried": 1,
        "open": bool(score.open),
        "best_bone_fraction": round(score.bone_fraction, 3),
        "best_lung_fraction": round(score.lung_fraction, 3),
        "best_cartilage_fraction": round(score.cartilage_fraction, 3),
        "core_rays_blocked_by_bone": score.core_bone,
        "core_rays_blocked_by_lung": score.core_lung,
        "core_rays_reaching_the_heart": score.core_on_target,
        "aperture_offset_from_imaging_plane_mm": 0.0,
        "open_apertures": int(score.open),
        "sector_deg": sector_deg,
    }
    if score.open:
        built, report = _finish_view(spec, chest, heart, origin, score.beam, score.lateral,
                                     score, aim, adjustment, window_report, head, sector_deg)
        if built is not None:
            return built, report
        rejection = report.get("reason")
    else:
        rejection = "turning the probe to this view closes its own window"

    # Slide within the same window. Turning a probe can shut the gap it was
    # standing in, and the operator's answer is to move a rib space, not to give
    # up on the view.
    anchor_names = [n for n in spec.in_plane if n in heart.landmarks]
    anchor = heart.landmarks[anchor_names[0]] if anchor_names else aim
    slid, slid_report = find_window(chest, heart, spec.window, anchor, new_normal, aim,
                                    sector_deg)
    if slid is None:
        return None, {"view_id": spec.view_id, "built": False,
                      "reason": f"{rejection}, and no other aperture in the "
                                f"{spec.window} window is open on the turned plane",
                      "window": window_report}
    moved = float(np.linalg.norm(slid.aperture - origin))
    adjustment = {**adjustment,
                  "aperture_unchanged_from_parent": False,
                  "slid_within_window_mm": round(moved, 1),
                  "slid_because": rejection}
    return _finish_view(spec, chest, heart, slid.aperture, slid.beam, slid.lateral,
                        slid, aim, adjustment, slid_report, head, sector_deg)


def centre_on_tissue(origin: np.ndarray, beam: np.ndarray, lateral: np.ndarray,
                     vertices: np.ndarray, half_angle: float) -> tuple[np.ndarray, np.ndarray, dict]:
    """
    Aim the beam at the middle of the tissue the plane actually cuts.

    Pointing the beam at a landmark centroid is not the same as centring the
    picture, and the difference is visible: the chamber-labelled pack's
    four-chamber sector came out with 15.2 degrees of dead sector on one side
    and 3.1 on the other, because the mean of two atrioventricular orifices is
    not the middle of the heart as seen from the apex.

    So the beam is rotated WITHIN the imaging plane until it bisects the angular
    spread of the tissue that plane cuts. Rotating in the plane changes nothing
    else: the plane, its normal and every landmark residual are untouched, and
    only the angular test in `contains` moves — in the direction that helps.
    The window still has to be re-cast afterwards, because a re-aimed fan sweeps
    different rays.
    """
    normal = np.cross(beam, lateral)
    offsets = vertices - origin
    in_plane = offsets[np.abs(offsets @ normal) <= legacy.SLAB_MM]
    if len(in_plane) == 0:
        return beam, lateral, {"centred": False, "reason": "the plane cuts no tissue"}

    angles = np.degrees(np.arctan2(in_plane @ lateral, in_plane @ beam))
    inside = np.abs(angles) <= np.degrees(half_angle)
    if inside.sum() < 50:
        return beam, lateral, {"centred": False, "reason": "too little tissue in the sector"}

    low, high = np.percentile(angles[inside], CENTRING_PERCENTILES)
    turn = float((low + high) / 2.0)
    radians = np.radians(turn)
    aimed = legacy.unit(np.cos(radians) * beam + np.sin(radians) * lateral)
    side = legacy.unit(-np.sin(radians) * beam + np.cos(radians) * lateral)
    return aimed, side, {
        "centred": True,
        "turned_deg": round(turn, 2),
        "tissue_span_before_deg": [round(float(low), 1), round(float(high), 1)],
        "dead_sector_before_deg": [round(float(np.degrees(half_angle) + low), 1),
                                   round(float(np.degrees(half_angle) - high), 1)],
        "dead_sector_after_deg": round(float(np.degrees(half_angle) - (high - low) / 2.0), 1),
    }


def _finish_view(spec: ViewSpec, chest: Chest, heart: Heart, origin: np.ndarray,
                 beam: np.ndarray, lateral: np.ndarray, score: WindowScore,
                 aim: np.ndarray, adjustment: dict, window_report: dict,
                 head: ProbeHead = DEFAULT_HEAD,
                 sector_deg: float = DEFAULT_SECTOR_DEG
                 ) -> tuple[BuiltView | None, dict]:
    """Depth, checks and the report, for one aperture that already has a window."""
    marks = heart.landmarks
    half = np.radians(sector_deg / 2.0)

    # The marker points along the lateral axis, and its SIGN is a display
    # convention rather than geometry: flipping it flips the plane's normal and
    # leaves the plane, the sector and every containment test identical. So the
    # sign is chosen to agree with the canon's indicator clock, and what is left
    # over is a real disagreement rather than an artefact of a cross product.
    if (clock_disagreement_hours(spec.clock, implied_clock(-lateral))
            < clock_disagreement_hours(spec.clock, implied_clock(lateral))):
        lateral = -lateral

    half = np.radians(sector_deg / 2.0)
    beam, lateral, centring = centre_on_tissue(origin, beam, lateral, heart.vertices, half)
    if centring.get("centred") and abs(centring["turned_deg"]) > 0.05:
        recast = score_apertures(chest, heart, origin[None, :],
                                 origin + beam * 100.0, np.cross(beam, lateral),
                                 float(np.linalg.norm(aim - origin)) + 140.0, np.zeros(1),
                                 sector_deg)[0]
        if not recast.open:
            # Re-aiming shut the window. The picture being off-centre is a
            # smaller fault than the beam going through a rib, so the original
            # aim is kept and the reason is recorded on the pose.
            beam, lateral = score.beam, score.lateral
            centring = {"centred": False,
                        "reason": "centring the sector closed the acoustic window; "
                                  "the original aim is kept"}
        else:
            score = recast
            window_report = {**window_report,
                             "best_bone_fraction": round(recast.bone_fraction, 3),
                             "best_lung_fraction": round(recast.lung_fraction, 3),
                             "best_cartilage_fraction": round(recast.cartilage_fraction, 3),
                             "core_rays_blocked_by_bone": recast.core_bone,
                             "core_rays_blocked_by_lung": recast.core_lung,
                             "re_cast_after_centring": True}

    normal = np.cross(beam, lateral)
    offsets = heart.vertices - origin
    elevation = np.abs(offsets @ normal)
    in_plane = offsets[elevation <= legacy.SLAB_MM]
    if len(in_plane) == 0:
        return None, {"view_id": spec.view_id, "built": False,
                      "reason": "the imaging plane does not intersect the heart"}
    along, across = in_plane @ beam, in_plane @ lateral
    inside = np.abs(np.arctan2(across, along)) <= half
    if not inside.any():
        return None, {"view_id": spec.view_id, "built": False,
                      "reason": "the sector contains no cardiac tissue"}
    reach = float(np.linalg.norm(in_plane[inside], axis=1).max())
    depth_cm = _ceil_hundredth_cm(reach + DISTAL_GUARD_MM)
    focus_cm = min(round(float(np.linalg.norm(aim - origin)) / 10.0, 2), depth_cm)

    sector = legacy.Sector(origin=origin, beam=beam, lateral=lateral,
                           half_angle=half, depth_mm=depth_cm * 10.0)

    residuals: dict[str, float] = {}
    failures: list[str] = []
    for name in spec.in_plane:
        if name not in marks:
            continue
        off = abs(float((marks[name] - origin) @ sector.normal))
        residuals[name] = round(off, 2)
        if off > legacy.SLAB_MM:
            failures.append(f"the imaging plane misses the {name} by {off:.1f} mm")
    for name in spec.contained:
        if name in marks and not sector.contains(marks[name]):
            failures.append(f"the sector does not reach the {name}")
    for name in spec.out_of_plane:
        if name not in marks:
            continue
        off = abs(float((marks[name] - origin) @ sector.normal))
        residuals[f"{name} (must be OUT of plane)"] = round(off, 2)
        if off <= legacy.SLAB_MM:
            failures.append(
                f"the {name} lies IN this plane, {off:.1f} mm off it, and this view is "
                f"defined by it being out")
    if failures:
        return None, {"view_id": spec.view_id, "built": False,
                      "reason": "; ".join(failures), "window": window_report}

    side = "left" if origin[0] > chest.midline_x else "right"
    if spec.window in ("left_parasternal", "right_parasternal", "apex"):
        placement = name_the_interspace(chest, origin, side)
    elif spec.window == "subxiphoid":
        placement = (f"{float(chest.xiphoid[:, 2].min() - origin[2]):.0f} mm below the xiphoid "
                     f"tip, {abs(float(origin[0] - chest.midline_x)):.0f} mm from the midline — "
                     "this window is under the costal margin, not between ribs")
    else:
        placement = (f"{float(origin[2] - chest.manubrium[:, 2].max()):.0f} mm above the "
                     "suprasternal notch")

    crossed = sorted(
        name for name, cloud in heart.body.items()
        if bool(np.any([sector.contains(p) for p in cloud[::max(1, len(cloud) // 400)]]))
    )
    clock = implied_clock(lateral)

    long_axis = legacy.unit(marks["apex"] - marks["av_base"])
    obliquity = float(np.degrees(np.arccos(abs(float(sector.normal @ long_axis)))))

    # How much room the transducer FACE has, which is the question a footprint
    # asks and a point aperture cannot answer on its own. Distance from this
    # aperture to the nearest bone surface — rib, cartilage-free sternum,
    # clavicle. Reported so a later round can enforce a footprint against a
    # number that was measured now rather than re-derived then.
    clearance = round(float(np.linalg.norm(chest.bone.vertices - origin, axis=1).min()), 2)

    report = {
        "view_id": spec.view_id,
        "built": True,
        "window": window_report,
        "plane_adjustment": adjustment,
        "landmark_plane_residual_mm": residuals,
        "placement": placement,
        "aperture_body_mm": [round(float(v), 2) for v in origin.tolist()],
        "stand_off_to_nearest_heart_mm": round(float(
            np.linalg.norm(heart.vertices - origin, axis=1).min()
        ), 2),
        "depth_cm": depth_cm,
        "focus_cm": focus_cm,
        "indicator_clock_canon": spec.clock,
        "indicator_clock_implied_by_pose": clock,
        "indicator_disagreement_hours": clock_disagreement_hours(spec.clock, clock),
        "probe_head": {
            "key": head.key,
            "name": head.name,
            "sector_deg": sector_deg,
            "footprint_mm": head.footprint_mm,
            "is_the_default_head_and_setting": (head.key == DEFAULT_HEAD.key
                                                and sector_deg == DEFAULT_SECTOR_DEG),
        },
        "bone_clearance_at_aperture_mm": clearance,
        "heads_whose_footprint_would_fit": heads_that_fit(clearance),
        # The ORIENTATION, in the body frame, beside the sector angle it was
        # placed at. A head that recovers a view is only reusable if the way it
        # was held is written down with it, so both axes are here as unit
        # vectors in +X patient-left, +Y posterior, +Z superior — the same frame
        # the aperture above is in, and the frame a future probe-head round will
        # want them in.
        "probe_orientation_body": {
            "beam_axis": [round(float(v), 6) for v in beam.tolist()],
            "lateral_axis": [round(float(v), 6) for v in lateral.tolist()],
            "plane_normal": [round(float(v), 6) for v in sector.normal.tolist()],
            "frame": "+X patient-left, +Y posterior, +Z superior",
        },
        "sector_centring": centring,
        "near_field_note": (
            "The empty wedge between the transducer and the first tissue is the composite's own "
            "stand-off, not a framing choice: it is chest wall plus however far this heart sits "
            "off it."
        ),
        "structures_crossed": crossed,
        "plane_landmarks": list(spec.plane),
        "plane_normal_vs_lv_long_axis_deg": round(obliquity, 1),
    }
    return BuiltView(spec=spec, sector=sector, score=score, report=report), report


def to_model_space(sector: legacy.Sector, rotation: np.ndarray,
                   translation: np.ndarray) -> dict:
    """The pose as the pack schema wants it: pack model space, unit axes."""
    inverse = rotation.T
    origin = inverse @ (sector.origin - translation)
    beam = legacy.unit(inverse @ sector.beam)
    lateral = inverse @ sector.lateral
    lateral = legacy.unit(lateral - float(lateral @ beam) * beam)
    return {
        "origin": [round(float(v), 9) for v in origin.tolist()],
        "beam_axis": [float(v) for v in beam.tolist()],
        "lateral_axis": [float(v) for v in lateral.tolist()],
    }


# --------------------------------------------------------------------------- #
# driving it                                                                   #
# --------------------------------------------------------------------------- #

#: Which body context serves which pack. Mirrors `CONTEXT_FOR_PACK` in
#: `src/packs/loadBodyContext.ts`; a pose is only as good as the registration it
#: was placed through, so the pairing is not guessed here either.
CONTEXT_FOR_PACK = {
    "normal-rodero": "adult-reference-chest-bp3d",
    "normal-vhl-heart0102-chambers": "fitted-chest-bp3d-heart0102-chambers",
}


def load_context(pack_id: str) -> tuple[np.ndarray, np.ndarray, float, dict]:
    context_id = CONTEXT_FOR_PACK[pack_id]
    path = REPO / "public" / "body-context" / context_id / "context.json"
    context = json.loads(path.read_text())
    rotation = np.array(context["model_to_body"]["rotation_row_major"], dtype=np.float64
                        ).reshape(3, 3)
    translation = np.array(context["model_to_body"]["translation_mm"], dtype=np.float64)
    scaling = context["registration"].get("chest_scaling")
    scale = float(scaling["uniform_scale_factor"]) if scaling else 1.0
    return rotation, translation, scale, context


def build_with_ladder(spec: ViewSpec, chest: Chest, heart: Heart,
                      done: dict[str, "BuiltView"]) -> tuple[BuiltView | None, dict]:
    """
    The default probe first, then the other heads, and stop at the first that works.

    This is the manoeuvre after the manoeuvre. When a window will not open or a
    landmark will not come inside the sector, an operator does not conclude the
    view is impossible on this patient — they change the sector, and if that is
    not enough they change the probe. Encoding that is what turns "no window
    here" into a claim about the substrate rather than about one transducer.

    The ladder is entered ONLY on failure and the default head is always tried
    first, so every pose that built before builds identically and at the same
    70 degrees. A pose that needed a different head says which, at what sector,
    and what the default failed with — and that record is the point: it is the
    evidence for which heads this app will eventually have to offer.
    """
    attempts: list[dict] = []
    default_failure: dict | None = None
    for head, sector_deg in PROBE_LADDER:
        setting = f"{head.key} at {sector_deg:.0f} degrees"
        view, report = build_view(spec, chest, heart, done, head, sector_deg)
        if view is not None:
            if attempts:
                ladder = {
                    "took": setting,
                    "default_failed_with": attempts[0]["reason"],
                    "settings_tried_before_it": [a["setting"] for a in attempts],
                    "why_this_is_recorded": (
                        "The default adult head could not place this view. The setting that "
                        "did is written here and on the pose so a later round can offer the "
                        "head rather than rediscover it."
                    ),
                }
                # Onto the BuiltView's own report as well, not just the copy
                # returned here: `view_document` writes the pose from
                # `built.report`, so a ladder recorded only on the return value
                # reaches the evidence and never reaches the pack.
                view.report["probe_ladder"] = ladder
                report = {**report, "probe_ladder": ladder}
            return view, report
        if default_failure is None:
            default_failure = report
        attempts.append({"setting": setting, "reason": report.get("reason", "")})

    failure = dict(default_failure or {})
    failure["probe_ladder"] = {
        "took": None,
        "settings_tried": [a["setting"] for a in attempts],
        "each_failed_with": {a["setting"]: a["reason"] for a in attempts},
        "conclusion": (
            "No head in the ladder placed this view. That is a finding about the substrate "
            "and the chest rather than about one transducer: the sector was opened to 90 "
            "degrees and narrowed to 45, so sector width is not what is in the way."
        ),
    }
    return None, failure


def survey(pack_id: str, cache: Path = bc.CACHE) -> dict:
    """Build every view this pack can support, and say why the rest are absent."""
    rotation, translation, scale, context = load_context(pack_id)
    by_concept = bc.elements_by_concept(cache)
    chest = load_chest(cache, by_concept, scale)
    heart = load_heart(pack_id, rotation, translation)

    built: list[BuiltView] = []
    reports: list[dict] = []
    done: dict[str, BuiltView] = {}
    for spec in VIEW_SPECS:
        view, report = build_with_ladder(spec, chest, heart, done)
        reports.append(report)
        if view is not None:
            built.append(view)
            done[spec.view_id] = view
    return {
        "pack_id": pack_id,
        "context_id": CONTEXT_FOR_PACK[pack_id],
        "chest_uniform_scale": scale,
        "landmarks_body_mm": {k: [round(float(x), 3) for x in v.tolist()]
                              for k, v in heart.landmarks.items()},
        "landmark_derivation": heart.landmark_source,
        "ray_target_mesh": {
            "full_triangles": heart.full_triangles,
            "triangles_used": int(len(heart.mesh.faces)),
            "max_vertex_shift_mm": heart.ray_mesh_error_mm,
        },
        "views": reports,
        "_built": built,
        "_heart": heart,
        "_chest": chest,
        "_rotation": rotation,
        "_translation": translation,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", default="all",
                        choices=("all", *CONTEXT_FOR_PACK))
    parser.add_argument("--evidence", action="store_true",
                        help="write the whole survey, failures included, under evidence/")
    parser.add_argument("--write", action="store_true",
                        help="add the built poses to their packs; existing views are never "
                             "touched")
    parser.add_argument("--replace", action="append", default=[], metavar="VIEW_ID",
                        help="regenerate this view even though the pack already carries it. "
                             "One id per flag, and only for a view whose DEFINITION changed "
                             "and whose committed pose no longer satisfies it.")
    args = parser.parse_args()
    packs = list(CONTEXT_FOR_PACK) if args.pack == "all" else [args.pack]
    for pack_id in packs:
        result = survey(pack_id)
        print(f"\n=== {pack_id}  (chest scale {result['chest_uniform_scale']}) ===")
        for report in result["views"]:
            if not report.get("built"):
                print(f"  -- {report['view_id']:28} NOT BUILT: {report['reason']}")
                if report.get("first_rejection"):
                    print(f"       nearest miss: {report['first_rejection']}")
                w = report.get("window")
                if w and w.get("tried"):
                    print(f"       best of {w['tried']}: bone {w['best_bone_fraction']:.2f} "
                          f"lung {w['best_lung_fraction']:.2f} "
                          f"cartilage {w['best_cartilage_fraction']:.2f} | "
                          f"core blocked by bone {w['core_rays_blocked_by_bone']} "
                          f"lung {w['core_rays_blocked_by_lung']}")
                elif w:
                    print(f"       {w.get('reason', '')}")
                continue
            w = report["window"]
            print(f"  ok {report['view_id']:28} {report['placement']}")
            print(f"       stand-off {report['stand_off_to_nearest_heart_mm']:6.1f} mm | "
                  f"depth {report['depth_cm']:5.2f} cm | focus {report['focus_cm']:5.2f} cm")
            print(f"       fan blocked: bone {w['best_bone_fraction']:.2f} "
                  f"lung {w['best_lung_fraction']:.2f} "
                  f"cartilage {w['best_cartilage_fraction']:.2f} | "
                  f"core clear | {w['open_apertures']} open apertures of {w['tried']}")
            print(f"       indicator: canon {report['indicator_clock_canon']} vs pose "
                  f"{report['indicator_clock_implied_by_pose']} "
                  f"({report['indicator_disagreement_hours']} h) | "
                  f"plane {report['plane_adjustment']} | "
                  f"landmark residual {report['landmark_plane_residual_mm']}")
        if args.evidence:
            print(f"  evidence -> {write_evidence(pack_id, result).relative_to(REPO)}")
        if args.write:
            here = tuple(i for i in args.replace
                         if any(v["view_id"] == i for v in
                                json.loads((REPO / "public" / "packs" / pack_id
                                            / "pack.json").read_text())["views"]))
            outcome = write_views(pack_id, result, apply=True, replace_ids=here)
            print(f"  WROTE {len(outcome['added'])}: {', '.join(outcome['added']) or 'none'}")
            if outcome["replaced"]:
                print(f"  REPLACED {len(outcome['replaced'])}: "
                      f"{', '.join(outcome['replaced'])}")
            print(f"  pack_version -> {outcome['pack_version']}")
            if outcome["already_authored"]:
                print(f"  left the {len(outcome['already_authored'])} pose(s) already authored "
                      f"alone: {', '.join(outcome['already_authored'])}")
    return 0



# --------------------------------------------------------------------------- #
# writing the poses into the packs                                             #
# --------------------------------------------------------------------------- #

#: The one sentence every pose from this module has to carry.
AGE_CORRECTNESS_CAVEAT = (
    "THE CHEST IS AN ADULT MALE BodyParts3D THORAX. Its rib obliquity, its intercostal spacing "
    "and its costal cartilage are the adult source's, at whatever size that context built it, so "
    "the interspace named here is the ADULT source's interspace and is NOT age-correct. A probe "
    "window indexed to an intercostal space on this chest is approximate."
)


def view_document(spec: ViewSpec, built: BuiltView, pack: dict, heart: Heart,
                  rotation: np.ndarray, translation: np.ndarray,
                  context: dict, chest_scale: float) -> dict:
    """One `PackView`, with the whole measurement behind it in its provenance."""
    report = built.report
    pose = to_model_space(built.sector, rotation, translation)
    structures = [s for s in report["structures_crossed"]
                  if s in {x["id"] for x in pack["meshes"]["structures"]}]
    anatomy = pack["provenance"]
    window = report["window"]
    probe = report["probe_head"]
    ladder = report.get("probe_ladder")

    head_text = (
        f"PROBE HEAD: {probe['name']}, sector {probe['sector_deg']:.0f} degrees, "
        f"face {probe['footprint_mm']:.0f} mm. "
    )
    if ladder:
        head_text += (
            f"THE DEFAULT HEAD COULD NOT PLACE THIS VIEW. "
            f"{DEFAULT_HEAD.name} at {DEFAULT_SECTOR_DEG:.0f} degrees failed with: "
            f"{ladder['default_failed_with']} "
            f"Settings tried before this one: {', '.join(ladder['settings_tried_before_it'])}. "
            "The head and the sector are recorded because they are the finding: this view "
            "exists on this substrate only with this transducer. "
        )
    head_text += (
        f"The aperture has {report['bone_clearance_at_aperture_mm']} mm of clearance to the "
        f"nearest bone, which admits the face of: "
        f"{', '.join(report['heads_whose_footprint_would_fit']) or 'no head in the table'}. "
        "The footprint is MEASURED and NOT ENFORCED — an aperture here is a point, so a face "
        "wider than that clearance would be partly on a rib and is not refused yet. "
    )

    note = (
        f"POSE PLACED ON A REGISTERED CHEST WALL, NOT ON THE HEART. The transducer sits on the "
        f"skin of the body context \"{context['context_id']}\" at {report['placement']}. "
        f"{spec.landmark_text} "
        f"ACOUSTIC WINDOW MEASURED OPEN, not assumed: of the {FAN_RAYS} rays across this "
        f"sector, {window['best_bone_fraction']:.0%} are stopped by bone, "
        f"{window['best_lung_fraction']:.0%} by lung and {window['best_cartilage_fraction']:.0%} "
        f"by costal cartilage before they reach cardiac tissue, and the central "
        f"{CORE_FRACTION:.0%} of the sector is clear of bone and air. Blockers behind the heart "
        f"are not counted, because they do not obstruct a structure the beam has already "
        f"imaged. Costal cartilage is scored separately from bone: it is not the same acoustic "
        f"obstacle, and in a child it transmits. "
        f"PLANE: {report['plane_adjustment']}. Landmark plane residuals in millimetres: "
        f"{report['landmark_plane_residual_mm']}. "
        f"INDICATOR: the canon gives {report['indicator_clock_canon']}; this pose implies "
        f"{report['indicator_clock_implied_by_pose']}, a disagreement of "
        f"{report['indicator_disagreement_hours']} hour(s), measured rather than imposed. "
        f"STAND-OFF: {report['stand_off_to_nearest_heart_mm']} mm from the skin to the nearest "
        f"cardiac surface, in a composite whose chest is scaled by {chest_scale}. "
        f"{head_text}"
        f"{AGE_CORRECTNESS_CAVEAT} "
        "structures[] is MEASURED — the structures whose geometry this sector actually "
        "intersects — and is not the canon's list of what a clinician would call out. "
        "NOT VETTED: draft, and neither the window nor the plane has been read by a clinician. "
        "SIMULATED ECHO: any image from this pose is generated from the pack's own labels, not "
        "acquired echocardiography."
    )

    return {
        "family": spec.family,
        "view_id": spec.view_id,
        "name": spec.name,
        "aliases": list(spec.aliases),
        "placement_landmark": report["placement"],
        "indicator_clock": spec.clock,
        "probe": {
            "origin": pose["origin"],
            "beam_axis": pose["beam_axis"],
            "lateral_axis": pose["lateral_axis"],
            "fan": {
                "angle_deg": report["probe_head"]["sector_deg"],
                "depth_cm": report["depth_cm"],
                "focus_cm": report["focus_cm"],
            },
            "display": {
                "vertex": spec.vertex,
                "flip_lr": False,
                "marker_side": "left",
            },
        },
        "structures": structures,
        "measurements": [],
        "lesion_attachments": [],
        "show_hide_preset": {"visible": structures, "hidden": []},
        "echo_tuning": {},
        "real_clip_slot": None,
        "emphasis": None,
        "provenance": {
            "creator": anatomy["creator"],
            "source": anatomy["source"],
            "source_url": anatomy["source_url"],
            "license": anatomy["license"],
            "license_url": anatomy["license_url"],
            "license_state": anatomy["license_state"],
            "modified": {"flag": True, "note": note},
            "derivation_chain": [
                f"public/packs/{heart.pack_id}/pack.json and its shipped glTF",
                f"public/body-context/{context['context_id']}/context.json "
                f"(model_to_body, scale 1)",
                "BodyParts3D 4.0 thoracic geometry: ribs 1-12, costal cartilages 1-7, "
                "manubrium, body of sternum, xiphoid process, clavicles and lungs, per side",
                "pipeline/acoustic_windows.py (window search, blocker ray casting, "
                "plane derivation and checks)",
            ],
            "vetted": {"status": "draft", "vetters": [], "last_reviewed": None},
        },
    }


def bump_patch(version: str) -> str:
    """`0.1.5` -> `0.1.6`. A pack whose views changed is a different revision."""
    parts = version.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def write_views(pack_id: str, result: dict, *, apply: bool,
                replace_ids: tuple[str, ...] = ()) -> dict:
    """
    Add this module's poses to a pack, and NEVER touch one already there.

    An authored pose is content. If a view id already exists it is left exactly
    as it is and reported as skipped, because replacing someone's authored pose
    with a generated one is not an improvement this module is entitled to make.

    ## The one way a pose is replaced, and why it is a flag

    `--replace <view_id>` is the exception, and it is deliberately awkward: a
    caller has to name every pose it is overwriting, one at a time, on the
    command line. That is the shape the rule should have. Regenerating a pose is
    right when the DEFINITION of the view changed and the pose in the pack no
    longer satisfies it — the apical two-chamber gained an enforced exclusion of
    the aorta, and the pose that was there had the aortic orifice 0.8 mm from
    its plane, which made it a second three-chamber wearing the two-chamber's
    name. It is wrong for everything else, and naming ids rather than passing a
    blanket "overwrite" is what keeps the two apart.

    A pack whose views changed gets its patch version bumped, because a body
    context pins the pack's exact bytes and a stale registration must fail loudly
    rather than be applied to a pack it was not fitted to.
    """
    pack_path = REPO / "public" / "packs" / pack_id / "pack.json"
    pack = json.loads(pack_path.read_text())
    replace_ids = tuple(replace_ids)
    existing = {view["view_id"] for view in pack["views"]} - set(replace_ids)
    rotation, translation = result["_rotation"], result["_translation"]
    _, _, _, context = load_context(pack_id)

    replaced = [view["view_id"] for view in pack["views"] if view["view_id"] in replace_ids]
    missing = [i for i in replace_ids if i not in replaced]
    if missing:
        raise SystemExit(
            f"{pack_id}: asked to replace {', '.join(missing)}, which this pack does not carry."
        )

    existing_names = {view["name"].lower() for view in pack["views"]}
    existing_aliases = {a.lower() for view in pack["views"] for a in view["aliases"]}

    added, skipped = [], []
    for built in result["_built"]:
        spec = built.spec
        if spec.view_id in existing:
            skipped.append(spec.view_id)
            continue
        # A second id for a view the pack already carries is a duplicate, not a
        # new view. Caught by name and by alias, because ids drift and the
        # canon's own names for a view do not.
        mine = {v["name"].lower() for v in pack["views"] if v["view_id"] == spec.view_id}
        mine |= {a.lower() for v in pack["views"] if v["view_id"] == spec.view_id
                 for a in v["aliases"]}
        clash = ((spec.name.lower() in existing_names - mine)
                 or (existing_aliases - mine) & {a.lower() for a in spec.aliases})
        if clash:
            raise SystemExit(
                f"{pack_id}: {spec.view_id} duplicates a view this pack already carries "
                f"under another id ({spec.name!r} / {spec.aliases}). Reconcile the id rather "
                "than adding a second copy of one view."
            )
        document = view_document(
            built.spec, built, pack, result["_heart"], rotation, translation,
            context, result["chest_uniform_scale"],
        )
        if spec.view_id in replaced:
            # IN PLACE. A pack's view order is the order somebody put them in,
            # and re-sorting it was a near-miss once already (observation 69):
            # a replacement that moved a pose to the end would show up in a diff
            # as every view changing.
            index = next(i for i, v in enumerate(pack["views"]) if v["view_id"] == spec.view_id)
            pack["views"][index] = document
        else:
            pack["views"].append(document)
        added.append(built.spec.view_id)

    changed = [i for i in added if i not in replaced]
    version = pack["meta"]["pack_version"]
    if apply and (added or replaced):
        pack["meta"]["pack_version"] = bump_patch(version)
        pack_path.write_text(json.dumps(pack, indent=2, sort_keys=False) + "\n")
    return {"pack_id": pack_id, "added": changed, "replaced": replaced,
            "already_authored": skipped,
            "pack_version": bump_patch(version) if (added or replaced) else version}


def write_evidence(pack_id: str, result: dict) -> Path:
    """
    The whole survey, including the views that could NOT be placed.

    A pack carries the poses that worked. It has nowhere to say that a view was
    attempted, that its window was searched, and that the search failed with
    these numbers — and that is exactly the finding a reader needs in order to
    judge the substrate rather than the poses. So it lives here.
    """
    path = REPO / "evidence" / "acoustic-windows" / pack_id / "window-survey.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    document = {
        "schema": "acoustic-windows/v0",
        "pack_id": result["pack_id"],
        "context_id": result["context_id"],
        "chest_uniform_scale": result["chest_uniform_scale"],
        "method": {
            "window": (
                "A named region of skin is sampled, every candidate aperture is restricted to "
                "those that can stand in the view's own imaging plane, and each one's whole "
                f"{FAN_ANGLE_DEG:.0f} degree fan is cast against the ribs, the costal "
                "cartilages, the sternum, the clavicles and the lungs. A blocker counts only if "
                "it lies BEFORE the beam first reaches cardiac tissue. The window is open when "
                f"the central {CORE_FRACTION:.0%} of the sector is clear of bone and air and no "
                f"more than {FAN_BONE_BUDGET:.0%} of the whole fan is stopped by bone."
            ),
            "cartilage": (
                "Scored separately and never counted as bone. Costal cartilage is not the same "
                "acoustic obstacle as rib, and in a child it transmits."
            ),
            "plane": (
                "Derived from measured cardiac landmarks, never from the window. Where the "
                "landmark plane meets no open skin the plane is ROCKED about the line through "
                "two of its own landmarks, smallest rock first, and the rock is reported. "
                "Views reached by turning the probe in a window another view already found say "
                "so, name the axis, and give the angle."
            ),
            "indicator": (
                "The canon's clock is checked against the pose, not imposed on it. The marker "
                "SIGN is chosen to agree with the canon, because flipping it changes no "
                "geometry; what is left over is a real disagreement and is reported per view."
            ),
            "age_correctness": AGE_CORRECTNESS_CAVEAT,
            "probe_heads": (
                "The default head is tried first and every view that builds on it is placed at "
                "exactly the sector the rest of this repository uses. Only a view the default "
                "cannot place enters the ladder, and the setting that works is recorded on the "
                "pose and here, because which transducer a view needs is the finding. Sector "
                "width is ENFORCED. Footprint is MEASURED against the aperture's clearance to "
                "the nearest bone and is NOT enforced: an aperture here is a point, and "
                "refusing a face wider than its clearance needs the face modelled as a chord "
                "on the skin, which is a change to the search rather than to the table."
            ),
        },
        "probe_ladder": [
            {"order": i + 1, "head": head.key, "name": head.name,
             "sector_deg": sector, "footprint_mm": head.footprint_mm,
             "max_sector_deg": head.max_sector_deg, "note": head.note,
             "is_default": i == 0}
            for i, (head, sector) in enumerate(PROBE_LADDER)
        ],
        "ray_target_mesh": result["ray_target_mesh"],
        "landmarks_body_mm": result["landmarks_body_mm"],
        "landmark_derivation": result["landmark_derivation"],
        "views": result["views"],
        "summary": {
            "built": sorted(v["view_id"] for v in result["views"] if v.get("built")),
            "not_built": {v["view_id"]: v["reason"]
                          for v in result["views"] if not v.get("built")},
            "built_on_the_default_head": sorted(
                v["view_id"] for v in result["views"]
                if v.get("built") and not v.get("probe_ladder")),
            "needed_another_probe_head": {
                v["view_id"]: {
                    "head": v["probe_head"]["key"],
                    "name": v["probe_head"]["name"],
                    "sector_deg": v["probe_head"]["sector_deg"],
                    "footprint_mm": v["probe_head"]["footprint_mm"],
                    "beam_axis_body": v["probe_orientation_body"]["beam_axis"],
                    "lateral_axis_body": v["probe_orientation_body"]["lateral_axis"],
                    "indicator_clock_implied_by_pose": v["indicator_clock_implied_by_pose"],
                    "indicator_clock_canon": v["indicator_clock_canon"],
                    "the_default_head_failed_with": v["probe_ladder"]["default_failed_with"],
                }
                for v in result["views"] if v.get("built") and v.get("probe_ladder")},
        },
    }
    path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n")
    return path


if __name__ == "__main__":
    raise SystemExit(main())
