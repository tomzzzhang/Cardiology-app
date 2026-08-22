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
from dataclasses import dataclass, field
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
FAN_ANGLE_DEG = 70.0

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
                    plane_offsets: np.ndarray) -> list[WindowScore]:
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

    half = np.radians(FAN_ANGLE_DEG / 2.0)
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
        chest, heart, in_plane[order], aim, normal, reach, plane_offsets[order]
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
    landmark_text: str
    rotate_about_long_axis_deg: float = 0.0
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
        derive_from="b1-apical-four-chamber", derive_axis="long_axis",
        derive_fixed_deg=60.0,
        landmark_text=(
            "The four-chamber window, ROTATED about the beam until the right-sided chambers "
            "leave the plane. Sixty degrees is the canonical rotation; which structures the "
            "sector then crosses is measured rather than assumed, and is listed below."
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
    if spec.rotate_about_long_axis_deg:
        long_axis = legacy.unit(marks["apex"] - marks["av_base"])
        normal = legacy.unit(_rotate_about(long_axis, spec.rotate_about_long_axis_deg, normal))
    return points[0], normal


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

    point, normal = build_plane(spec, marks)
    hinge_names = [n for n in spec.in_plane if n in marks][:2] or list(spec.plane[:2])
    hinge = legacy.unit(marks[hinge_names[1]] - marks[hinge_names[0]])
    anchor = marks[hinge_names[0]]
    out = []
    for rock in PLANE_ROCK_STEPS_DEG:
        rocked = legacy.unit(_rotate_about(hinge, rock, normal)) if rock else normal
        out.append((anchor, rocked, {
            "plane_rock_deg": rock,
            "plane_rocked_about": f"the line through the {hinge_names[0]} and the "
                                  f"{hinge_names[1]}",
        }))
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
               done: dict[str, "BuiltView"]) -> tuple[BuiltView | None, dict]:
    """One pose, or the measured reason there is not one."""
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
        return _derive_view(spec, chest, heart, parent, aim)

    attempts: list[dict] = []
    for plane_point, normal, adjustment in _candidate_planes(spec, marks):
        score, window_report = find_window(chest, heart, spec.window, plane_point, normal, aim)
        if score is None:
            attempts.append({**adjustment, "window": window_report})
            continue
        built, report = _finish_view(spec, chest, heart, score.aperture, score.beam,
                                     score.lateral, score, aim, adjustment, window_report)
        if built is not None:
            return built, report
        attempts.append({**adjustment, "window": window_report,
                         "rejected": report.get("reason")})

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
                 aim: np.ndarray) -> tuple[BuiltView | None, dict]:
    """
    A view reached by turning the probe where it already stands.

    The aperture is the parent's — the transducer is not lifted — and the plane
    is turned about one of the probe's own axes. The window is then re-cast from
    scratch through the NEW plane, because turning a probe can close a window
    that was open, and a view that images a rib is not a view whatever
    manoeuvre produced it.
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
        angle = turn_to_contain(origin, normal, axis,
                                heart.landmarks[spec.derive_until_in_plane])
        solved = f"solved to bring the {spec.derive_until_in_plane} into the plane"
    else:
        angle = spec.derive_fixed_deg
        solved = "the canonical fixed angle for this manoeuvre"

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
                             float(np.linalg.norm(aim - origin)) + 140.0, np.zeros(1))
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
    }
    if score.open:
        built, report = _finish_view(spec, chest, heart, origin, score.beam, score.lateral,
                                     score, aim, adjustment, window_report)
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
    slid, slid_report = find_window(chest, heart, spec.window, anchor, new_normal, aim)
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
                        slid, aim, adjustment, slid_report)


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
                 aim: np.ndarray, adjustment: dict,
                 window_report: dict) -> tuple[BuiltView | None, dict]:
    """Depth, checks and the report, for one aperture that already has a window."""
    marks = heart.landmarks
    half = np.radians(FAN_ANGLE_DEG / 2.0)

    # The marker points along the lateral axis, and its SIGN is a display
    # convention rather than geometry: flipping it flips the plane's normal and
    # leaves the plane, the sector and every containment test identical. So the
    # sign is chosen to agree with the canon's indicator clock, and what is left
    # over is a real disagreement rather than an artefact of a cross product.
    if (clock_disagreement_hours(spec.clock, implied_clock(-lateral))
            < clock_disagreement_hours(spec.clock, implied_clock(lateral))):
        lateral = -lateral

    half = np.radians(FAN_ANGLE_DEG / 2.0)
    beam, lateral, centring = centre_on_tissue(origin, beam, lateral, heart.vertices, half)
    if centring.get("centred") and abs(centring["turned_deg"]) > 0.05:
        recast = score_apertures(chest, heart, origin[None, :],
                                 origin + beam * 100.0, np.cross(beam, lateral),
                                 float(np.linalg.norm(aim - origin)) + 140.0, np.zeros(1))[0]
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
        view, report = build_view(spec, chest, heart, done)
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
            outcome = write_views(pack_id, result, apply=True)
            print(f"  WROTE {len(outcome['added'])}: {', '.join(outcome['added']) or 'none'}")
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
                "angle_deg": FAN_ANGLE_DEG,
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


def write_views(pack_id: str, result: dict, *, apply: bool) -> dict:
    """
    Add this module's poses to a pack, and NEVER touch one already there.

    An authored pose is content. If a view id already exists it is left exactly
    as it is and reported as skipped, because replacing someone's authored pose
    with a generated one is not an improvement this module is entitled to make.
    """
    pack_path = REPO / "public" / "packs" / pack_id / "pack.json"
    pack = json.loads(pack_path.read_text())
    existing = {view["view_id"] for view in pack["views"]}
    rotation, translation = result["_rotation"], result["_translation"]
    _, _, _, context = load_context(pack_id)

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
        clash = (spec.name.lower() in existing_names
                 or existing_aliases & {a.lower() for a in spec.aliases})
        if clash:
            raise SystemExit(
                f"{pack_id}: {spec.view_id} duplicates a view this pack already carries "
                f"under another id ({spec.name!r} / {spec.aliases}). Reconcile the id rather "
                "than adding a second copy of one view."
            )
        pack["views"].append(view_document(
            built.spec, built, pack, result["_heart"], rotation, translation,
            context, result["chest_uniform_scale"],
        ))
        added.append(built.spec.view_id)

    if apply and added:
        pack_path.write_text(json.dumps(pack, indent=2, sort_keys=False) + "\n")
    return {"pack_id": pack_id, "added": added, "already_authored": skipped}


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
        },
        "ray_target_mesh": result["ray_target_mesh"],
        "landmarks_body_mm": result["landmarks_body_mm"],
        "landmark_derivation": result["landmark_derivation"],
        "views": result["views"],
        "summary": {
            "built": sorted(v["view_id"] for v in result["views"] if v.get("built")),
            "not_built": {v["view_id"]: v["reason"]
                          for v in result["views"] if not v.get("built")},
        },
    }
    path.write_text(json.dumps(document, indent=2, sort_keys=False) + "\n")
    return path


if __name__ == "__main__":
    raise SystemExit(main())
