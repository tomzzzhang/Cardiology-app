"""
The anatomical frame, derived from the mesh rather than assumed.

`docs/build_plan.md` requires a pack to declare its orientation convention. The
first version of this pipeline satisfied that by measuring the superior axis
from the ventricular centroid to the aortic-wall centroid. That is a guess
dressed as a measurement, and it is wrong: in the frame it produces, the
inferior vena cava comes out SUPERIOR to the valve plane.

## What a heart-only mesh can and cannot tell you

It cannot tell you the patient's axes. Three defensible proxies for body
superior-inferior disagree badly on this mesh:

| proxy | superior axis (source coords) | verdict |
| --- | --- | --- |
| ventricular centroid -> aortic wall | `[-0.583, 0.040, 0.812]` | fails the IVC check |
| SVC centroid - IVC centroid | `[-0.043, -0.533, 0.845]` | 46 deg from the above |
| averaged caval disc normals | `[ 0.508, -0.098, 0.856]` | the two cavae disagree by 68 deg |

The cavae are truncated stubs — flat discs, not tubes (third singular value
0.16-0.31 of the first) — so neither their principal axes nor their normals
carry a reliable direction. A heart in isolation has no spine, no diaphragm and
no chest wall, and no amount of arithmetic recovers axes the geometry does not
contain. So this module does not claim them.

## Which ring is which valve

Everything below rests on the four valve rings, so their identity cannot be an
assumption. It is not read off their positions — that is circular, since the
positions are what the frame is being built to interpret. It is read off what
each one SEPARATES: a valve plane borders exactly two of the six documented
tags, and the pair names it uniquely. See `identify_valve_planes`. Disagreement
with the published Rodero mapping raises rather than warns.

What the mesh CAN tell you, and tightly, is the **cardiac** frame:

* the apex, from the universal ventricular coordinates the source already ships
  (`Z = 0` on the left-ventricular myocardium), stable to 1.7 mm across a
  twenty-fold change in the sampling threshold;
* the base, from the four valve-ring centroids, which fit a common plane to
  within 5.8 mm;
* the long axis between them, 86.7 mm on this mesh, agreeing with the fitted
  base-plane normal to 6 degrees;
* left-right, from the left- and right-atrial centroids.

That is also the frame the content actually needs. Every plane in
`docs/view_canon.md` is defined against cardiac landmarks — the apical
four-chamber is the plane through the long axis and both atrioventricular
valves, the short axis is the plane perpendicular to it — not against the
patient's axes. The probe PLACEMENTS are described on the chest, but the
placements are prose for the learner; the geometry is cardiac.

## Reproducibility

`derive_cardiac_frame` returns the basis together with every input it measured
and the result of every check it ran, and the caller writes that record into the
pack. A reader with the pack alone can see which tags were used, what the
residuals were, and which checks passed — and re-run them.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from meshlib import TetMesh

#: Left- and right-atrial myocardium, for the left-right axis.
LA_TAG, RA_TAG = 3, 4
#: Left-ventricular myocardium, whose universal coordinates locate the apex.
LV_TAG, RV_TAG = 1, 2
#: Great-vessel walls.
AORTA_TAG, PA_TAG = 5, 6
#: The six tags whose identity the source documents. A valve plane is found by
#: which TWO of these it borders, so this tuple is the whole alphabet.
CHAMBER_TAGS = (LV_TAG, RV_TAG, LA_TAG, RA_TAG, AORTA_TAG, PA_TAG)
#: Caval tags, used only as CHECKS on the derived frame, never as inputs.
SVC_TAG, IVC_TAG = 16, 17

#: The published Rodero/CEMRG valve-plane tags, and the pair of chambers each
#: one separates. The PAIR is the definition; the tag is what this module
#: checks the mesh against. See `identify_valve_planes`.
PUBLISHED_VALVES: dict[str, tuple[int, frozenset[int]]] = {
    "mitral": (7, frozenset({LV_TAG, LA_TAG})),
    "tricuspid": (8, frozenset({RV_TAG, RA_TAG})),
    "aortic": (9, frozenset({LV_TAG, AORTA_TAG})),
    "pulmonary": (10, frozenset({RV_TAG, PA_TAG})),
}

#: Share of a group's chamber-facing boundary below which a neighbour is a graze
#: rather than a border.
#:
#: RELATIVE rather than absolute on purpose. Two tag groups that merely touch
#: along a seam share a few faces out of thousands; a valve plane's two borders
#: are most of its boundary. An absolute floor would have to be re-picked for
#: every mesh resolution. On this mesh the margin is a factor of twenty-five:
#: the weakest real border is the pulmonary valve against the pulmonary artery
#: at 8.1% of its own chamber-facing boundary, and the strongest spurious one is
#: the left ventricle grazing the pulmonary artery at 0.3% of its.
GRAZE_FRACTION = 0.02

#: Fraction of left-ventricular points, lowest apicobasal coordinate first,
#: averaged to locate the apex. One percent is ~1700 points here: enough to be
#: insensitive to a single stray element, few enough to stay at the apex.
APEX_PERCENTILE = 1.0

#: Universal-coordinate values outside [0, 1] are the source's "not applicable"
#: sentinel (it writes -10), carried by every point with no ventricular
#: coordinate. Including them would drag the apex toward the atria.
UVC_SENTINEL_FLOOR = -1.0


@dataclass
class ValveIdentification:
    """Which tag is which valve, and the adjacency that says so."""

    #: Valve name -> the tag carrying that valve plane.
    by_valve: dict[str, int]
    #: Candidate tag -> {chamber tag: shared triangles}, for every tag that
    #: borders any of `CHAMBER_TAGS`. The evidence, not just the verdict.
    borders: dict[int, dict[int, int]]
    agrees_with_published: bool

    @property
    def by_tag(self) -> dict[int, str]:
        return {tag: valve for valve, tag in self.by_valve.items()}

    @property
    def tags(self) -> tuple[int, ...]:
        """The four valve-plane tags, in the published valve order."""
        return tuple(self.by_valve[valve] for valve in PUBLISHED_VALVES)


@dataclass
class CardiacFrame:
    """A measured cardiac basis, plus everything needed to check it."""

    #: Rows map source coordinates onto (x = patient-left, y = base, z = anterior).
    rotation: np.ndarray
    apex: np.ndarray
    base: np.ndarray
    long_axis_mm: float
    ring_centroids: dict[int, np.ndarray]
    base_plane_residuals_mm: list[float]
    base_normal_vs_long_axis_deg: float
    valves: ValveIdentification
    checks: dict[str, bool] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(self.checks.values())

    def ring(self, valve: str) -> np.ndarray:
        """The centroid of a named valve's ring, in source coordinates."""
        return self.ring_centroids[self.valves.by_valve[valve]]


def _unit(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        raise ValueError("cannot normalise a zero-length vector")
    return vector / norm


def _tag_points(mesh: TetMesh, tag: int) -> np.ndarray:
    selector = mesh.tags == tag
    if not selector.any():
        raise ValueError(f"mesh carries no elements tagged {tag}")
    return mesh.points[np.unique(mesh.tets[selector])]


def _centroid(mesh: TetMesh, tag: int) -> np.ndarray:
    return _tag_points(mesh, tag).mean(axis=0)


def tag_face_adjacency(mesh: TetMesh) -> dict[tuple[int, int], int]:
    """
    Shared-triangle counts between every pair of differently-tagged elements.

    Two tetrahedra are adjacent when they share a triangular face, and an
    interior face of the whole mesh belongs to exactly two tetrahedra. So
    sorting every face by its vertex triple and looking at consecutive equal
    keys finds every adjacency in one pass; where the two owners carry different
    tags, that face is a piece of the boundary BETWEEN those two tags.

    Returns `{(lower tag, higher tag): shared triangles}`.
    """
    tets = mesh.tets.astype(np.int64)
    faces = np.vstack([
        tets[:, [0, 1, 2]], tets[:, [0, 1, 3]], tets[:, [0, 2, 3]], tets[:, [1, 2, 3]],
    ])
    faces.sort(axis=1)
    owner = np.tile(mesh.tags.astype(np.int64), 4)

    # One integer per face. Point indices are well under 2^21 on any mesh this
    # pipeline can hold in memory, so the triple packs into an int64 exactly and
    # sorting scalars is far cheaper than a lexsort over three columns.
    count = mesh.points.shape[0]
    key = (faces[:, 0] * count + faces[:, 1]) * count + faces[:, 2]
    order = np.argsort(key, kind="stable")
    key, owner = key[order], owner[order]

    shared = key[:-1] == key[1:]
    left, right = owner[:-1][shared], owner[1:][shared]
    crossing = left != right
    pairs = np.stack([
        np.minimum(left[crossing], right[crossing]),
        np.maximum(left[crossing], right[crossing]),
    ], axis=1)
    unique, counts = np.unique(pairs, axis=0, return_counts=True)
    return {(int(a), int(b)): int(n) for (a, b), n in zip(unique, counts)}


def identify_valve_planes(mesh: TetMesh) -> ValveIdentification:
    """
    Name the valve planes from what they SEPARATE, not from where they sit.

    A valve plane is the interface between a chamber and the thing that chamber
    opens into, so it borders exactly two of the six documented tags, and the
    pair is unique across the four valves:

        LV + LA     -> mitral          RV + RA     -> tricuspid
        LV + aorta  -> aortic          RV + PA     -> pulmonary

    Everything else in this mesh fails that test for a structural reason rather
    than by luck. The six chamber tags themselves border three to five of their
    own kind. The pulmonary veins, caval stubs and atrial appendage — tags 11-24
    — each hang off exactly one chamber and border exactly one.

    The previous version of this module ASSUMED tags 7-10 were the mitral,
    tricuspid, aortic and pulmonary rings, reading their identity off their
    centroid positions, and the whole frame rests on that reading: the base is
    the mean of the four ring centroids, and two of the nine checks are
    statements about named valves. A mis-identified ring would move the base
    plane and quietly invert a check. Adjacency settles it from the topology
    instead, and disagreement with the published mapping RAISES: on this
    substrate that would mean the mesh is Strocchi-tagged, or has been
    re-exported under a different convention, and every downstream number would
    be wrong in a way that still looked plausible.
    """
    adjacency = tag_face_adjacency(mesh)
    chambers = set(CHAMBER_TAGS)

    borders: dict[int, dict[int, int]] = {}
    for (a, b), shared in adjacency.items():
        for tag, other in ((a, b), (b, a)):
            if other in chambers:
                borders.setdefault(tag, {})[other] = shared

    by_pair = {pair: valve for valve, (_tag, pair) in PUBLISHED_VALVES.items()}
    by_valve: dict[str, int] = {}
    ambiguous: list[str] = []

    for tag, neighbours in sorted(borders.items()):
        if tag in chambers:
            continue
        total = sum(neighbours.values())
        strong = {
            other for other, shared in neighbours.items()
            if shared >= total * GRAZE_FRACTION
        }
        valve = by_pair.get(frozenset(strong))
        if valve is None:
            continue
        if valve in by_valve:
            ambiguous.append(f"{valve}: tags {by_valve[valve]} and {tag}")
            continue
        by_valve[valve] = tag

    if ambiguous:
        raise ValueError(
            "more than one tag borders the same pair of chambers, so the valve "
            "planes are not identifiable from adjacency: " + "; ".join(ambiguous)
        )

    missing = [valve for valve in PUBLISHED_VALVES if valve not in by_valve]
    if missing:
        raise ValueError(
            "no tag borders the chamber pair that defines the "
            + ", ".join(missing)
            + f" valve; measured chamber borders were {borders}"
        )

    published = {valve: tag for valve, (tag, _pair) in PUBLISHED_VALVES.items()}
    agrees = by_valve == published
    if not agrees:
        raise ValueError(
            "valve-plane adjacency DISAGREES with the published Rodero mapping. "
            f"Measured {by_valve}, published {published}. This mesh may be "
            "Strocchi-tagged or re-exported under another convention; the frame, "
            "every view derived from it, and every structure label are unsafe "
            "until the tag convention is settled."
        )

    return ValveIdentification(
        by_valve=by_valve,
        borders={tag: dict(sorted(n.items())) for tag, n in sorted(borders.items())},
        agrees_with_published=agrees,
    )


def apex_from_uvc(mesh: TetMesh) -> np.ndarray:
    """
    The left-ventricular apex, from the source's own apicobasal coordinate.

    `Z` runs 0 at the apex to 1 at the base over the ventricular myocardium.
    Taking the mean of the lowest percentile is far more robust than taking the
    single most-apical vertex, which is one decimation artefact away from moving
    several millimetres.
    """
    apicobasal = mesh.uvc("Z")
    points = np.unique(mesh.tets[mesh.tags == LV_TAG])
    valid = points[apicobasal[points] >= UVC_SENTINEL_FLOOR]
    if valid.size == 0:
        raise ValueError("no left-ventricular point carries a usable apicobasal coordinate")
    threshold = np.percentile(apicobasal[valid], APEX_PERCENTILE)
    return mesh.points[valid[apicobasal[valid] <= threshold]].mean(axis=0)


def derive_cardiac_frame(mesh: TetMesh) -> CardiacFrame:
    """
    Measure the cardiac basis, then check it against anatomy it did not use.

    The construction is one strong primary axis, one strong secondary, and a
    third that is forced:

    * **primary** `L`, apex to base. Both ends are measured from different
      evidence — the apex from the universal coordinates, the base from the
      valve rings — so their agreement with the independently fitted base-plane
      normal is a real corroboration rather than an identity.
    * **secondary** `R`, right atrium to left atrium, orthogonalised against
      `L`. The atria sit side by side, which makes this the cleanest left-right
      evidence in the mesh.
    * **third** `A = R x L`, which completes a right-handed basis.

    Every check below uses structures that are NOT inputs to the construction,
    or relations that orthogonalisation cannot force. `LA left of RA` is
    deliberately absent: it is true by construction and would only flatter the
    result.

    Which ring is which valve is DERIVED first, from face adjacency, because
    four of these checks name valves and the base is the mean of the four ring
    centroids. See `identify_valve_planes`.
    """
    valves = identify_valve_planes(mesh)
    rings = {tag: _centroid(mesh, tag) for tag in sorted(valves.tags)}
    base = np.mean(list(rings.values()), axis=0)
    apex = apex_from_uvc(mesh)

    long_axis = _unit(base - apex)
    left_raw = _centroid(mesh, LA_TAG) - _centroid(mesh, RA_TAG)
    left = _unit(left_raw - np.dot(left_raw, long_axis) * long_axis)
    anterior = np.cross(left, long_axis)

    rotation = np.vstack([left, long_axis, anterior])
    if float(np.linalg.det(rotation)) < 0:
        raise ValueError("derived cardiac frame is left-handed")

    # Independent fit of the base plane through the four ring centroids. Its
    # normal is a second, unrelated construction of "which way is basal", so the
    # angle between it and the long axis measures whether the two agree.
    stacked = np.array(list(rings.values())) - base
    base_normal = np.linalg.svd(stacked)[2][2]
    if np.dot(base_normal, base - apex) < 0:
        base_normal = -base_normal

    def framed(point: np.ndarray) -> np.ndarray:
        return rotation @ point

    apex_f, base_f = framed(apex), framed(base)
    lv, rv = framed(_centroid(mesh, LV_TAG)), framed(_centroid(mesh, RV_TAG))
    la, ra = framed(_centroid(mesh, LA_TAG)), framed(_centroid(mesh, RA_TAG))
    svc, ivc = framed(_centroid(mesh, SVC_TAG)), framed(_centroid(mesh, IVC_TAG))
    valve = {name: framed(rings[tag]) for name, tag in valves.by_valve.items()}
    checks = {
        # Sign of the anterior axis. The pulmonary valve is the most anterior of
        # the four, and nothing in the construction knows that.
        "pulmonary valve anterior to aortic valve":
            valve["pulmonary"][2] > valve["aortic"][2],
        # Sign of the left axis, from valves rather than from the atria that set it.
        "mitral valve left of tricuspid valve":
            valve["mitral"][0] > valve["tricuspid"][0],
        "left ventricle left of right ventricle": lv[0] > rv[0],
        "aortic valve right of mitral valve":
            valve["aortic"][0] < valve["mitral"][0],
        # Sign of the long axis: the atria are basal to their ventricles.
        "left atrium basal to left ventricle": la[1] > lv[1],
        "right atrium basal to right ventricle": ra[1] > rv[1],
        # The cavae are never inputs. The SVC joins the right atrium above the
        # valve plane and the IVC enters behind the SVC; both are free checks.
        "superior vena cava basal to the valve plane": svc[1] > base_f[1],
        "inferior vena cava posterior to superior vena cava": ivc[2] < svc[2],
        "apex apical to every valve ring":
            all(apex_f[1] < framed(centroid)[1] for centroid in rings.values()),
    }

    frame = CardiacFrame(
        rotation=rotation,
        apex=apex,
        base=base,
        long_axis_mm=float(np.linalg.norm(base - apex)),
        ring_centroids=rings,
        valves=valves,
        base_plane_residuals_mm=[float(value) for value in stacked @ base_normal],
        base_normal_vs_long_axis_deg=float(
            np.degrees(np.arccos(np.clip(np.dot(base_normal, long_axis), -1.0, 1.0)))
        ),
        checks=checks,
    )

    if not frame.ok:
        failed = [name for name, passed in checks.items() if not passed]
        frame.notes.append("FRAME CHECKS FAILED: " + "; ".join(failed))
    return frame


def frame_record(frame: CardiacFrame) -> dict:
    """
    The derivation, as it is written into the pack.

    This exists so the basis is checkable by someone holding only the pack: it
    names the tags used, the landmark positions measured, the residuals, and the
    outcome of every check, in the SOURCE coordinates the measurements were made
    in. A basis with no record is indistinguishable from a hand-tuned one.
    """
    valves = frame.valves
    by_tag = valves.by_tag
    return {
        "method": "cardiac-landmarks-v2",
        "description": (
            "Cardiac basis measured from the mesh. Valve planes identified by FACE ADJACENCY: "
            "each valve plane borders exactly two of the six documented tags and that pair names "
            "it uniquely (LV+LA mitral, RV+RA tricuspid, LV+aorta aortic, RV+PA pulmonary). "
            "Primary axis: left-ventricular apex to the centroid of the four valve-ring "
            "centroids, the apex located from the source's universal ventricular coordinate Z. "
            "Secondary axis: right-atrial to left-atrial myocardium centroid, orthogonalised "
            "against the primary. Third axis completes a right-handed basis. Axes are CARDIAC, "
            "not the patient's: a heart-only mesh carries no spine, diaphragm or chest wall, and "
            "the three defensible proxies for body superior-inferior disagree by up to 46 degrees "
            "on this mesh, so no body frame is claimed. See pipeline/anatomy.py."
        ),
        "inputs": {
            "apex": {
                "source": "universal ventricular coordinate Z on left-ventricular myocardium",
                "tag": LV_TAG,
                "percentile": APEX_PERCENTILE,
            },
            "base": {
                "source": "mean of the valve-ring centroids",
                "tags": [int(tag) for tag in sorted(valves.tags)],
            },
            "left_right": {"source": "right-atrial to left-atrial centroid", "tags": [RA_TAG, LA_TAG]},
        },
        "valve_identification": {
            "method": "tag-face-adjacency-v1",
            "description": (
                "Each valve plane is the interface between a chamber and what it opens into, so "
                "it borders exactly two of the six documented tags and that pair identifies it. "
                "Counts are shared triangles between tag groups; a neighbour carrying less than "
                f"{GRAZE_FRACTION:.0%} of a group's chamber-facing boundary is a graze, not a "
                "border. Position is not consulted."
            ),
            "chamber_tags": {
                "lv": LV_TAG, "rv": RV_TAG, "la": LA_TAG,
                "ra": RA_TAG, "aorta": AORTA_TAG, "pa": PA_TAG,
            },
            "valves": {
                valve: {
                    "tag": int(tag),
                    "borders": {
                        str(other): int(shared)
                        for other, shared in valves.borders[tag].items()
                    },
                }
                for valve, tag in valves.by_valve.items()
            },
            "published_tags": {
                valve: tag for valve, (tag, _pair) in PUBLISHED_VALVES.items()
            },
            "agrees_with_published": bool(valves.agrees_with_published),
        },
        "landmarks_source_mm": {
            "apex": [float(v) for v in frame.apex],
            "base": [float(v) for v in frame.base],
            "valve_rings": {
                by_tag[tag]: [float(v) for v in centroid]
                for tag, centroid in frame.ring_centroids.items()
            },
        },
        "basis_source_to_pack": {
            "patient_left": [float(v) for v in frame.rotation[0]],
            "basal": [float(v) for v in frame.rotation[1]],
            "anterior": [float(v) for v in frame.rotation[2]],
        },
        "measurements": {
            "long_axis_mm": round(frame.long_axis_mm, 2),
            "base_plane_residuals_mm": [round(v, 2) for v in frame.base_plane_residuals_mm],
            "base_normal_vs_long_axis_deg": round(frame.base_normal_vs_long_axis_deg, 1),
        },
        "checks": {name: bool(passed) for name, passed in frame.checks.items()},
        "checks_passed": int(sum(frame.checks.values())),
        "checks_total": len(frame.checks),
    }
