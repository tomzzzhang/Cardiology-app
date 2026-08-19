"""
Clinical views, derived from the measured cardiac frame.

Every view here is built from landmarks this pipeline MEASURED — the apex from
the source's universal ventricular coordinates, the four valve rings identified
by face adjacency, the chamber centroids — and never from a number typed in to
make a picture look right. A view that cannot be built that way is not built.

## What that rules out, and why family A is missing

`docs/view_canon.md` asks for A3 and A4, the subcostal coronal and sagittal
sweeps. They are not here, and the reason is the same one `anatomy.py` gives for
refusing to claim a body frame.

The subcostal family is defined by where the beam ENTERS: from below the
diaphragm, angling up into the chest. That is what makes the atrial septum lie
near-perpendicular to the beam, which is the entire teaching payload of A3 — the
best atrial-septal window in the study. "Below" is a body axis. This mesh is a
heart with no spine, no diaphragm and no chest wall, and the three defensible
proxies for body superior-inferior disagree by up to 46 degrees on it.

Placing a subcostal probe here would mean guessing that direction, and a wrong
guess does not look wrong: it produces a plausible sector through the atria
whose stated claim — septum perpendicular to the beam — is false. That is worse
than an absent view, so the views are absent. `docs/observations.md` says so
where a reader will find it.

The parasternal family is a different case. A parasternal probe sits ANTERIOR to
the heart, and anterior is a derived cardiac axis with an independent check
behind it (the pulmonary valve is anterior to the aortic valve, and nothing in
the construction knows that). So C1 and C2 are placed against measured axes, not
guessed ones.

## What every view still does not claim

Nobody clinical has looked at any of this. Probe placements on the chest are
prose for the learner; the geometry is cardiac. Indicator clocks and display
flags are the canon's values carried across unverified. Every view is draft.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

#: The numbers this pipeline and the TypeScript viewer both have to agree on.
_SHARED = json.loads(
    (Path(__file__).resolve().parent.parent / "shared" / "imaging-constants.json").read_text()
)

#: Half-thickness of the slab a sector is treated as imaging, in mm.
#:
#: Read from ``shared/imaging-constants.json`` rather than written here, because
#: ``src/viewer/beamDim.ts`` needs the same number and had a different one: 5 mm
#: against this file's 6.0, for the same physical quantity. The sweep scrubber
#: takes its structures from this module and the on-screen highlight takes its
#: thickness from that one, so the two disagreeing means the scrubber names
#: structures the highlight does not mark — invisibly, since both render
#: something plausible. The shared file records which value won and why.
#:
#: An echo
#: plane is elevation-focused and several millimetres thick, not a mathematical
#: plane; a zero-thickness test would find almost nothing.
SLAB_MM = float(_SHARED["elevationSlabHalfMm"]["value"])

#: How far the transducer face stands off the epicardium, in mm. The model
#: carries no chest wall, so this is a gap in empty space rather than an
#: intercostal position, and it is stated as such in every placement landmark.
STAND_OFF_MM = 8.0


def unit(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        raise ValueError("cannot normalise a zero-length vector")
    return vector / norm


@dataclass
class Sector:
    """A probe pose and the fan it images, in pack coordinates."""

    origin: np.ndarray
    beam: np.ndarray
    lateral: np.ndarray
    half_angle: float
    depth_mm: float

    @property
    def normal(self) -> np.ndarray:
        return np.cross(self.beam, self.lateral)

    def contains(self, point: np.ndarray, *, elevation_mm: float = SLAB_MM) -> bool:
        offset = point - self.origin
        elevation = abs(float(np.dot(offset, self.normal)))
        in_plane = offset - np.dot(offset, self.normal) * self.normal
        angle = abs(float(np.arctan2(np.dot(in_plane, self.lateral), np.dot(in_plane, self.beam))))
        return (
            elevation <= elevation_mm
            and angle <= self.half_angle
            and float(np.linalg.norm(in_plane)) <= self.depth_mm
        )


def stand_off(vertices: np.ndarray, through: np.ndarray, beam: np.ndarray) -> np.ndarray:
    """
    A transducer position outside the model, on the far side of `through`.

    Measured rather than assumed: how far the model reaches back against the
    beam from the point being aimed through, plus a small gap. Guessing a
    distance instead puts the probe inside the myocardium on one substrate and
    four centimetres into empty space on the next.
    """
    behind = float(np.max((through - vertices) @ beam))
    return through - beam * (max(behind, 0.0) + STAND_OFF_MM)


def measured_depth(vertices: np.ndarray, sector: Sector) -> float:
    """
    Sector depth in cm, from the tissue this fan actually images.

    Measured over the slab about the imaging plane, not over every vertex in the
    model. Measuring over all of them lets a pulmonary-vein stub sitting well
    out of plane set the depth, which puts centimetres of empty sector under the
    heart and pushes the anatomy into the top of the frame.
    """
    offsets = vertices - sector.origin
    in_slab = np.abs(offsets @ sector.normal) <= 12.0
    imaged = offsets[in_slab] if in_slab.any() else offsets
    return round(float(np.max(np.linalg.norm(imaged, axis=1))) * 1.08 / 10.0, 2)


def require_contains(sector: Sector, view_id: str, landmarks: dict[str, np.ndarray]) -> None:
    """
    Refuse a pose that does not contain what its name is about.

    This exists because of a real near-miss: an earlier apical four-chamber
    aimed the beam along the long axis and used the apex/MV/TV plane only for
    the sweep axis, leaving the imaging plane 12 degrees off and missing BOTH
    atrioventricular rings by about 17 mm. The pose looked entirely reasonable
    and was not a four-chamber view.
    """
    for label, point in landmarks.items():
        if not sector.contains(point):
            offset = point - sector.origin
            elevation = abs(float(np.dot(offset, sector.normal)))
            raise ValueError(
                f"{view_id}: pose does not contain the {label} "
                f"({elevation:.1f} mm off the imaging plane)"
            )


def require_in_plane(sector: Sector, view_id: str, landmarks: dict[str, np.ndarray],
                     tolerance_mm: float = SLAB_MM) -> None:
    """
    Refuse a pose whose PLANE misses a landmark, without demanding the sector
    reach it.

    The two are different requirements and conflating them rejects correct
    views. A parasternal long axis is the plane through the left ventricle's
    long axis and the aortic root, and the true apex is routinely outside its
    sector — foreshortening the apex is a known property of the window, not a
    defect in it. What must hold is that the apex lies IN the plane; whether the
    fan reaches that far is a matter of depth and angle.
    """
    for label, point in landmarks.items():
        elevation = abs(float(np.dot(point - sector.origin, sector.normal)))
        if elevation > tolerance_mm:
            raise ValueError(
                f"{view_id}: imaging plane misses the {label} by {elevation:.1f} mm"
            )


def _pose_at(sector: Sector, sweep: dict, t: float) -> Sector:
    """The sector at scrub position `t`. Mirrors `src/echo/probeFrame.ts`."""
    span = sweep["range"]
    value = span["from"] + (span["to"] - span["from"]) * t
    direction = unit(np.array(sweep["axis"]["direction"], dtype=float))

    if sweep["mode"] == "translate":
        return Sector(
            origin=sector.origin + direction * value,
            beam=sector.beam, lateral=sector.lateral,
            half_angle=sector.half_angle, depth_mm=sector.depth_mm,
        )

    radians = np.radians(value)
    cos, sin = np.cos(radians), np.sin(radians)

    def rotate(v: np.ndarray) -> np.ndarray:
        return v * cos + np.cross(direction, v) * sin + direction * np.dot(direction, v) * (1 - cos)

    pivot = np.array(sweep["axis"].get("origin", sector.origin), dtype=float)
    return Sector(
        origin=pivot + rotate(sector.origin - pivot),
        beam=rotate(sector.beam), lateral=rotate(sector.lateral),
        half_angle=sector.half_angle, depth_mm=sector.depth_mm,
    )


def first_seen_samples(
    structures, sector: Sector, sweep: dict, samples: int = 61,
) -> dict[str, tuple[int, int]]:
    """
    The sample index at which the sweep first reaches each structure.

    The measurement `structures_in_order` is built from, exposed on its own so
    the ORDER can be audited rather than trusted. The value is
    ``(first sample, -triangle count)``: the sample decides the order, and the
    size breaks ties so that a sweep entering the left ventricle and clipping a
    vein stub in the same step is described as reaching the ventricle.

    Nothing here decides what is worth naming, what a sweep is *for*, or which
    structures a clinician would call out — those are the canon's business and a
    vetter's, and this pipeline may not assert them. This walks the sweep and
    asks which labelled structures have geometry inside the sector.

    **The criterion is "any single surface vertex inside the sector", and that is
    a known weakness.** `src/viewer/beamDim.ts` explicitly rejected the same
    criterion for its highlight, on the grounds that it calls a whole chamber
    crossed when the beam clips one corner of it — "which is precisely the
    judgement the learner is trying to make". The two therefore disagree about
    what "reached" means even now that they agree about the slab. Recorded in
    `docs/observations.md`; not changed here, because changing it changes which
    structures every shipped view claims to cross and that is a content
    decision, not a cleanup.
    """
    first_seen: dict[str, tuple[int, int]] = {}
    for step in range(samples):
        posed = _pose_at(sector, sweep, step / (samples - 1))
        offsets_normal = posed.normal
        for structure in structures:
            if structure.slug in first_seen:
                continue
            vertices = structure.surface.vertices.astype(np.float64)
            offsets = vertices - posed.origin
            elevation = np.abs(offsets @ offsets_normal)
            near = elevation <= SLAB_MM
            if not near.any():
                continue
            in_plane = offsets[near] - np.outer(offsets[near] @ offsets_normal, offsets_normal)
            angle = np.abs(np.arctan2(in_plane @ posed.lateral, in_plane @ posed.beam))
            reach = np.linalg.norm(in_plane, axis=1)
            if np.any((angle <= posed.half_angle) & (reach <= posed.depth_mm)):
                first_seen[structure.slug] = (step, -structure.surface.triangle_count)
    return first_seen


def ordering_is_vacuous(first_seen: dict[str, tuple[int, int]]) -> bool:
    """
    Whether the "order" a sweep reaches structures in carries no information.

    If every structure is first reached at the SAME sample, then nothing about
    the sweep decided the order — the size tie-break did, and the result is
    simply the structures sorted largest first. That is a fact about the mesh,
    not about the sweep, and shipping it as `structures_in_order` would invite a
    scrubber to annotate ticks that do not exist.

    Measured on the shipped pack, `c2-parasternal-short-axis` is exactly this
    case: its sector is wide enough that the first position of the sweep already
    contains every named structure. `b1` and `c1` are not — they reach different
    structures at different points along the tilt, which is what the annotation
    is supposed to show.
    """
    if len(first_seen) < 2:
        return True
    return len({step for step, _ in first_seen.values()}) == 1


def structures_in_order(structures, sector: Sector, sweep: dict, samples: int = 61) -> list[str]:
    """
    Which structures the sweep crosses, in the order it first reaches them.

    **This is a measurement, not a reading.** It says: walk the sweep, and at
    each position ask which labelled structures have geometry inside the sector.
    Nothing here decides what is worth naming, what a sweep is *for*, or which
    structures a clinician would call out — those are the canon's business and a
    vetter's, and this pipeline may not assert them.

    That distinction is why the list can be shipped at all. An earlier revision
    left `structures_in_order` empty on the grounds that naming the structures a
    sweep crosses is a clinical reading. Naming them is; measuring which ones
    the fan actually intersects is arithmetic, and it is what the scrubber needs
    in order to be annotated with anything at all.

    **An ordering the sweep did not produce is not shipped.** Where every
    structure is first reached at the same sample the order is entirely the size
    tie-break — the structures sorted largest first, which says something about
    the mesh and nothing about the sweep — and this returns an empty list rather
    than a plausible one. The wave 1d scrubber is meant to take its ticks from
    this list; ticks derived from a vacuous ordering would be annotations for
    events that never happen.
    """
    first_seen = first_seen_samples(structures, sector, sweep, samples)
    if ordering_is_vacuous(first_seen):
        return []
    return [slug for slug, _ in sorted(first_seen.items(), key=lambda item: item[1])]


@dataclass
class Landmarks:
    """Measured points, in pack coordinates, that the views are built from."""

    apex: np.ndarray
    base: np.ndarray
    long_axis_mm: float
    rings: dict[str, np.ndarray]
    centroids: dict[str, np.ndarray]
    vertices: np.ndarray
    notes: list[str] = field(default_factory=list)


def landmarks_from(structures, frame) -> Landmarks:
    """Collect the measured geometry the view builders share."""
    return Landmarks(
        apex=frame.rotation @ frame.apex,
        base=frame.rotation @ frame.base,
        long_axis_mm=frame.long_axis_mm,
        rings={
            valve: frame.rotation @ frame.ring(valve)
            for valve in frame.valves.by_valve
        },
        centroids={s.slug: np.array(s.centroid, dtype=float) for s in structures},
        vertices=np.vstack([s.surface.vertices.astype(np.float64) for s in structures]),
    )


# --------------------------------------------------------------------------- #
# the views                                                                    #
# --------------------------------------------------------------------------- #


def apical_four_chamber(landmarks: Landmarks) -> tuple[dict, Sector, dict]:
    """
    B1, apical four-chamber. `docs/view_canon.md` family B.

    THE defining property is that the imaging plane passes through the apex and
    both atrioventricular rings, so that plane is built FIRST and everything
    else is derived inside it. Building the beam along the long axis and merely
    using this normal for the sweep — an earlier revision — produced a plane 12
    degrees off that missed both rings by about 17 mm while looking entirely
    reasonable.

    Chosen as the first view on this substrate because it is the derived frame
    rendered: the probe sits at the measured apex and looks along the measured
    long axis at the measured valve plane. Its teaching payload also survives a
    substrate with valve RINGS but no leaflets — chamber sizes, both septa, the
    two rings at the crux.
    """
    apex = landmarks.apex
    mitral, tricuspid = landmarks.rings["mitral"], landmarks.rings["tricuspid"]

    normal = unit(np.cross(mitral - apex, tricuspid - apex))
    if normal[2] < 0:
        normal = -normal

    target = (mitral + tricuspid) / 2.0
    axis = unit(target - apex)
    origin = stand_off(landmarks.vertices, apex, axis)
    beam = unit(target - origin)

    # Lateral points toward the patient's left — toward the mitral ring — so
    # rightward structures fall on the opposite side of the sector, per the
    # canon's anatomically-correct orientation rule.
    lateral = unit(np.cross(normal, beam))
    if np.dot(lateral, mitral - tricuspid) < 0:
        lateral = -lateral

    sector = Sector(origin, beam, lateral, np.radians(80.0 / 2.0), 0.0)
    sector.depth_mm = measured_depth(landmarks.vertices, sector) * 10.0
    require_contains(sector, "b1-apical-four-chamber", {
        "mitral ring": mitral, "tricuspid ring": tricuspid, "apex": apex,
    })

    # Positive sweep tilts the plane ANTERIORLY. For a rotation about axis `a`
    # the beam moves toward `a x beam`; choosing `a = beam x normal` makes that
    # product the anterior normal exactly, so the declared range reads the way
    # the canon describes the sweep.
    sweep = {
        "mode": "tilt",
        "axis": {
            "direction": [float(v) for v in unit(np.cross(beam, normal))],
            "origin": [float(v) for v in origin],
        },
        # Posterior (toward the coronary sinus) through the reference plane to
        # anterior (toward the outflow tract, the "five-chamber").
        "range": {"unit": "deg", "from": -18.0, "to": 22.0},
        "interpolation": "slerp",
        "structures_in_order": [],
    }

    identity = {
        "family": "B",
        "view_id": "b1-apical-four-chamber",
        "name": "Apical four-chamber (draft)",
        "aliases": ["A4C", "apical 4C"],
        "placement_landmark": (
            "Cardiac apex, derived from this mesh: probe at the left-ventricular apex located by "
            "the source's universal ventricular coordinate, looking along the measured long axis "
            "at the valve plane. The model carries no chest wall, so the transducer stands off "
            "the epicardium rather than sitting in an intercostal space."
        ),
        "indicator_clock": "3:00",
        # Family B renders vertex-down — the paediatric convention in
        # docs/view_canon.md, unlike most adult labs.
        "display": {"vertex": "down", "flip_lr": False, "marker_side": "right"},
        "derivation": (
            "Imaging plane through the left-ventricular apex and BOTH atrioventricular ring "
            "centroids, which is the defining property of the view; probe standing off the "
            "apical epicardium along the plane, beam toward the midpoint of the two rings. Sweep "
            "tilts the plane posteriorly to anteriorly about the in-plane axis."
        ),
    }
    return identity, sector, sweep


def parasternal_long_axis(landmarks: Landmarks) -> tuple[dict, Sector, dict]:
    """
    C1, parasternal long axis. `docs/view_canon.md` family C.

    The plane is the one through the left ventricle's long axis and the aortic
    root — measured here as the plane through the apex, the mitral ring and the
    aortic ring, which is the same statement in landmarks this pipeline has.
    Mitral-to-aortic continuity, the view's central relationship, is exactly the
    relationship between the two rings that plane is built from.

    The probe stands off ANTERIORLY, which is a measured cardiac axis with an
    independent check behind it, not a guess about the chest. What the substrate
    cannot show is what a parasternal view is usually read for in detail —
    leaflet morphology, root measurements at the sinuses — because there are no
    leaflets and the aortic wall is a single tagged tube.
    """
    apex = landmarks.apex
    mitral, aortic = landmarks.rings["mitral"], landmarks.rings["aortic"]

    normal = unit(np.cross(mitral - apex, aortic - apex))
    # Point the elevation normal toward the patient's left, so the sweep's
    # declared direction reads rightward-to-leftward as the canon describes it.
    if normal[0] < 0:
        normal = -normal

    # Aim through the middle of the long axis, from anterior. `anterior` is the
    # frame's +z: measured, and checked by the pulmonary valve sitting anterior
    # to the aortic valve — a relation nothing in the frame's construction knows.
    # Aimed at the middle of the mitral-to-aortic region, which is what a
    # parasternal long axis is centred on. Aiming at the centroid of all three
    # landmarks instead drags the sector apically and pushes the aortic root to
    # the edge of the fan, which is the wrong half of the view to lose.
    target = (mitral + aortic) / 2.0
    anterior = np.array([0.0, 0.0, 1.0])
    approach = unit(anterior - np.dot(anterior, normal) * normal)
    origin = stand_off(landmarks.vertices, target, -approach)
    beam = unit(target - origin)

    # Screen-x runs toward the BASE, so the apex falls on screen-left: the
    # canon's standing PLAX exception, which holds in dextrocardia too.
    lateral = unit(np.cross(normal, beam))
    if np.dot(lateral, landmarks.base - apex) < 0:
        lateral = -lateral

    sector = Sector(origin, beam, lateral, np.radians(70.0 / 2.0), 0.0)
    sector.depth_mm = measured_depth(landmarks.vertices, sector) * 10.0
    require_contains(sector, "c1-parasternal-long-axis", {
        "mitral ring": mitral, "aortic ring": aortic,
    })
    # The apex has to be in the PLANE — that is what makes this a long-axis view
    # — but not necessarily in the sector. A real parasternal long axis
    # foreshortens or loses the true apex, which is why the apical window
    # exists.
    require_in_plane(sector, "c1-parasternal-long-axis", {"apex": apex})

    sweep = {
        "mode": "tilt",
        "axis": {
            "direction": [float(v) for v in unit(np.cross(beam, normal))],
            "origin": [float(v) for v in origin],
        },
        # One slider, one physical rock of the transducer: rightward and
        # inferoapical (the RV inflow variant) through the reference plane to
        # leftward and superior (the RV outflow variant). The canon's protocol
        # returns to the reference between the two; a single monotonic track
        # cannot express that, and UI-3 in the planning folder is the open
        # question about views with more than one sweep.
        "range": {"unit": "deg", "from": -20.0, "to": 20.0},
        "interpolation": "slerp",
        "structures_in_order": [],
    }

    identity = {
        "family": "C",
        "view_id": "c1-parasternal-long-axis",
        "name": "Parasternal long axis (draft)",
        "aliases": ["PLAX"],
        "placement_landmark": (
            "Mid left sternal border. Derived from this mesh as the plane through the "
            "left-ventricular apex, the mitral ring and the aortic ring, viewed from the measured "
            "ANTERIOR side. The model carries no chest wall or sternum, so the transducer stands "
            "off the epicardium rather than sitting in an intercostal space."
        ),
        "indicator_clock": "10:00",
        # Family C renders vertex-up, and PLAX additionally puts the apex on
        # screen-left. Both are docs/view_canon.md values carried across.
        "display": {"vertex": "up", "flip_lr": False, "marker_side": "left"},
        "derivation": (
            "Imaging plane through the left-ventricular apex, the mitral ring centroid and the "
            "aortic ring centroid — the long axis of the left ventricle together with the aortic "
            "root. Probe standing off the anterior epicardium along the measured anterior axis. "
            "Screen-x runs toward the base so the apex falls on screen-left."
        ),
    }
    return identity, sector, sweep


def parasternal_short_axis(landmarks: Landmarks) -> tuple[dict, Sector, dict]:
    """
    C2, parasternal short axis, as the multi-level sweep. `view_canon.md` family C.

    The only view here whose sweep is a TRANSLATION, and the substrate suits it:
    the plane is perpendicular to the measured long axis and slides along it, so
    every level of the canon's protocol — great vessels, mitral, papillary,
    apex — is a position on one slider rather than a separate pose.

    What the substrate cannot show at those levels is most of what the levels
    are named for: no trileaflet aortic valve to see en face, no "fish-mouth"
    mitral orifice, no papillary muscles, no coronaries. What it does show is
    the chamber cross-sections and the septum, level by level, which is the
    spatial relationship the sweep exists to teach.

    The sweep starts at the aortic ring's level and ends short of the apex,
    both measured, so the track covers tissue rather than running off the end of
    the heart into empty sector.
    """
    apex, base = landmarks.apex, landmarks.base
    apical = unit(apex - base)

    # A short-axis plane is perpendicular to the long axis, so the long axis IS
    # the sector's elevation normal, and the beam and lateral span the cut.
    anterior = np.array([0.0, 0.0, 1.0])
    beam_direction = unit(-(anterior - np.dot(anterior, apical) * apical))
    aortic_level = landmarks.rings["aortic"] + apical * 2.0
    target = base + apical * float(np.dot(aortic_level - base, apical))
    origin = stand_off(landmarks.vertices, target, beam_direction)

    beam = beam_direction
    lateral = unit(np.cross(apical, beam))
    # Patient-left to screen-x, per the canon's orientation rule.
    if lateral[0] < 0:
        lateral = -lateral

    sector = Sector(origin, beam, lateral, np.radians(70.0 / 2.0), 0.0)
    sector.depth_mm = measured_depth(landmarks.vertices, sector) * 10.0
    # At the start of the sweep the plane is at the aortic ring's level, so the
    # ring is what the first position has to contain.
    require_contains(sector, "c2-parasternal-short-axis", {
        "aortic ring": landmarks.rings["aortic"],
    })

    # The travel is measured: from this level to just short of the apex, so the
    # last position still has tissue in it.
    travel = float(np.dot(apex - origin, apical)) * 0.88
    sweep = {
        "mode": "translate",
        "axis": {"direction": [float(v) for v in apical]},
        "range": {"unit": "mm", "from": 0.0, "to": round(travel, 1)},
        "interpolation": "lerp",
        "structures_in_order": [],
    }

    identity = {
        "family": "C",
        "view_id": "c2-parasternal-short-axis",
        "name": "Parasternal short-axis sweep (draft)",
        "aliases": ["PSAX", "short axis"],
        "placement_landmark": (
            "Mid left sternal border, indicator toward the left shoulder. Derived from this mesh "
            "as the plane perpendicular to the measured long axis, entered from the measured "
            "anterior side and slid from the aortic ring's level toward the apex. The model "
            "carries no chest wall, so the transducer stands off the epicardium."
        ),
        "indicator_clock": "2:00",
        "display": {"vertex": "up", "flip_lr": False, "marker_side": "right"},
        "derivation": (
            "Imaging plane perpendicular to the long axis measured between the left-ventricular "
            "apex and the centroid of the four valve rings, translated along that axis from the "
            "aortic ring's level to 88 percent of the distance to the apex. Probe standing off "
            "the anterior epicardium."
        ),
    }
    return identity, sector, sweep


#: The views this pipeline can build from measured landmarks, in the order the
#: app should offer them. B1 first: it is the frame rendered, and the strongest
#: test of the cut.
BUILDERS = (apical_four_chamber, parasternal_long_axis, parasternal_short_axis)

#: Views `docs/view_canon.md` asks for that this substrate cannot support, and
#: the reason. Carried into the pack's provenance so the gap is visible to a
#: reader holding only the pack, rather than looking like an oversight.
SKIPPED = {
    "a3-subcostal-coronal": (
        "Subcostal coronal sweep. NOT AUTHORED: the subcostal family is defined by the beam "
        "entering from below the diaphragm, which is what puts the atrial septum "
        "near-perpendicular to it — the view's whole teaching payload. That direction is a BODY "
        "axis, and this heart-only mesh carries no spine, diaphragm or chest wall; the three "
        "defensible proxies for body superior-inferior disagree by up to 46 degrees on it. A "
        "guessed placement would render a plausible sector whose stated claim is false."
    ),
    "a4-subcostal-sagittal": (
        "Subcostal sagittal (bicaval) sweep. NOT AUTHORED, for the same reason as A3. The "
        "bicaval PLANE is derivable here — the caval stubs and the right atrium are all measured "
        "landmarks — but the subcostal WINDOW is not, and approaching that plane from a guessed "
        "direction would misstate the angle every structure in it makes with the beam. The right "
        "parasternal bicaval view F1 reaches the same plane from a side this mesh can locate, "
        "and is the honest route to this content."
    ),
}
