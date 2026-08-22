"""
The patient/body frame, and the rigid registration that puts a heart into it.

## What this exists to fix

A heart-only mesh has a CARDIAC frame and no BODY frame. `normal-rodero` says so
itself, in `meshes.anatomical_frame.description`: "Axes are CARDIAC, not the
patient's: a heart-only mesh carries no spine, diaphragm or chest wall, and the
three defensible proxies for body superior-inferior disagree by up to 46 degrees
on this mesh, so no body frame is claimed."

That was the right call, and it left the app with no world up. What stood in for
one was the apical four-chamber: place B1 and the beam becomes "the z axis".
That is a view defining the model's frame, which is backwards — an imaging
window is a fact about where a transducer goes, not about which way is up — and
it is now removed. This module supplies the replacement: a body frame measured
from a body, and a rigid transform from one heart's model space into it.

## The frame

Right-handed, and fixed:

* `+X` patient-left
* `+Y` posterior
* `+Z` superior
* anterior is `-Y`

`cross(+X, +Z) = -Y = anterior`, which is the same handedness convention
`meshes.anatomical_frame.basis_source_to_pack` already uses (`patient_left x
basal` points along `anterior`).

## Where the frame comes from, and why it is measured rather than declared

BodyParts3D ships a whole body, so unlike a heart-only mesh it can be ASKED
which way is up. It is asked, in `measure_body_axes`, from structures whose
relative position is not in doubt:

* skull minus foot gives superior,
* sternum minus thoracic spine gives anterior,
* left clavicle minus right clavicle gives patient-left.

The answer is that BodyParts3D's own source axes ALREADY ARE this frame, so the
BodyParts3D-to-body transform is the identity and body coordinates are source
millimetres. That is a measurement, not an assumption, and it is re-derived on
every run rather than pinned — if a future source revision moves its axes, the
check below fails instead of quietly registering a heart into a rotated body.

It also contradicts what the committed `anatomy-bodyparts3d-heart` pack declares
(`up=+y, anterior=+z`), which that pack's own provenance already flags as "the
SOURCE's own axis order, unverified". It was unverified and it was wrong. The
pack is left byte-unchanged here; the finding is recorded rather than acted on,
because rewriting a committed pack is a different task from measuring an axis.

## The registration, and the one thing it deliberately does not do

Rodero and BodyParts3D are two different hearts. Rodero is a population-average
adult (mean shape of 19 subjects) with an 86.7 mm base-to-apex left ventricle;
BodyParts3D's is one man's, artist-adjusted by its publisher's own admission,
with a 65.9 mm one. A 20.8 mm difference in the single largest cardiac dimension
is not registration error. It is two hearts being different sizes.

So the fit is rigid with scale LOCKED TO ONE, and it is fitted on landmarks that
carry POSITION AND ORIENTATION rather than length:

* the four valve centres, which sit on the fibrous skeleton — the part of a
  heart whose placement in a chest is actually stable;
* one APEX-DIRECTION landmark, which is each heart's own base-to-apex unit
  vector taken out to a shared fixed distance `L`. It constrains which way the
  long axis points without asserting that the two hearts are the same length.

Fitting the apex POINT instead would be asking a rigid transform to absorb a
20.8 mm size difference, and it would pay for that by tilting the valve plane.
Both alternatives are computed and reported in the evidence file so the choice
is visible rather than asserted.

The residual apex separation is reported, decomposed, and NOT minimised: of the
20.9 mm that remains, 20.8 mm is the length difference and 0.2 mm is fit error.

## What this is not

Not a patient. Not clinical ground truth. A population-average heart rigidly
placed inside one adult male reference body, which is a teaching composite and
is labelled as one.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

import fast_simplification
from scipy.spatial import cKDTree

from bodyparts3d import read_element_map
from meshlib import Surface, read_gltf_surfaces, read_obj, write_gltf

REPO = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".cache" / "bodyparts3d"
ARCHIVE_DIR = "partof_BP3D_4.0_obj_99"
ELEMENT_MAP = "partof_element_parts.txt"

#: Where the descriptor and its evidence land.
CONTEXT_ID = "adult-reference-chest-bp3d"
CONTEXT_DIR = REPO / "public" / "body-context" / CONTEXT_ID
EVIDENCE_DIR = REPO / "evidence" / "body-context" / CONTEXT_ID

#: The pack this registration is FOR. A registration is bound to exact bytes:
#: model-space coordinates are only meaningful against the revision that defined
#: them, and a pack that changed its mesh would need a new fit, not this one.
BOUND_PACK_ID = "normal-rodero"

SCHEMA_VERSION = "body-context/v0"

# --------------------------------------------------------------------------- #
# concepts                                                                     #
# --------------------------------------------------------------------------- #

#: Valve concepts, per side. These are the landmark correspondences.
VALVE_CONCEPTS = {
    "mitral": "FMA7235",
    "tricuspid": "FMA7234",
    "aortic": "FMA7236",
    "pulmonary": "FMA7246",
}

#: The left-ventricular CAVITY, which is where the apex direction is measured.
#:
#: The cavity rather than the `left ventricle` concept, and the distinction
#: matters: `FMA7101` also contains the aortic cusps and the anterior mitral
#: leaflet, and a centroid taken over those is dragged basally far enough to
#: swing the derived long axis by 38 degrees. Measured, not guessed at: with the
#: cavity alone the axis agrees with Rodero's to 2.4 degrees.
LV_CAVITY_CONCEPT = "FMA9466"

#: Structures used to measure which way the body's own axes point.
AXIS_CONCEPTS = {
    "skull": "FMA46565",
    "right_foot": "FMA11343",
    "sternum": "FMA7485",
    "thoracic_spine": "FMA9140",
    "left_clavicle": "FMA13323",
    "right_clavicle": "FMA13322",
}

#: Thoracic context groups: display group -> the source concepts that make it.
#:
#: Selected through the source's own PART-OF concept table rather than by
#: guessing at opaque element ids, so the selection is reproducible and every
#: element that lands in an asset can be named in the report.
#:
#: SCAPULAE ARE EXCLUDED, and the reason is a measurement rather than a taste:
#: the two of them are 54,278 triangles, roughly as much as the ribs and the
#: spine together, and they sit behind the heart where they hide rather than
#: orient. The clavicles cost 2,322 and frame the suprasternal notch and the
#: parasternal windows, so they stay. Recorded in the report either way.
CHEST_CONCEPTS: dict[str, tuple[str, ...]] = {
    "skin": ("FMA7163",),
    "ribs": ("FMA7480",),
    "sternum": ("FMA7485",),
    "spine": ("FMA9140",),
    "lungs": ("FMA7309", "FMA7310"),
    "diaphragm": ("FMA13295",),
    "shoulder": ("FMA13322", "FMA13323"),
}

#: Triangles allowed per display group after decimation.
#:
#: This is scene CONTEXT, not the subject. The heart is what the learner reads;
#: a chest that cost as much as the heart would be spending the frame budget on
#: the wrong thing. Totals ~120k against 698,510 raw.
#:
#: The sternum and the clavicles are under budget already and are left ALONE:
#: they are small, they are the landmarks the parasternal and suprasternal
#: windows are named for, and decimating them would buy nothing.
CHEST_TRIANGLE_BUDGET: dict[str, int] = {
    "skin": 30_000,
    "ribs": 35_000,
    "sternum": 10_000,
    "spine": 16_000,
    "lungs": 26_000,
    "diaphragm": 12_000,
    "shoulder": 4_000,
}

#: The z band the SKIN is cropped to, in body millimetres.
#:
#: The source ships one skin surface for the whole body — 1,719 mm of it, from
#: sole to scalp. Only the thorax is context for a heart, so it is cropped to a
#: band that comfortably contains every other group (ribs 1008-1370, spine
#: 1050-1377, lungs 1015-1356, diaphragm 986-1193).
#:
#: The cut edge is left OPEN. Capping it would be inventing a surface that is
#: not in the source, which is the same rule the geometry ingest already
#: follows: an open boundary here is a crop, and a crop should look like one.
SKIN_CROP_Z_MM = (960.0, 1400.0)

#: Total asset budget for the whole chest, in bytes. Context is not allowed to
#: cost what a pack costs.
CHEST_BUDGET_BYTES = 8_000_000

#: How apical a point has to be to count as apex, as a percentile along the long
#: axis. Mirrors `anatomy.APEX_PERCENTILE`: the mean of an extreme percentile is
#: far steadier than the single most extreme vertex, which is one decimation
#: artefact away from moving millimetres.
APEX_PERCENTILE = 99.0

#: Cosine below which a measured body axis is not dominated by one source axis.
#: 0.98 is about 11 degrees; the real measurements are all above 0.997.
AXIS_DOMINANCE = 0.98

#: The exact upstream bytes this registration was derived from.
#:
#: Verified HERE rather than in `fetch.py`, and that is a deliberate constraint
#: rather than a preference. `pipeline/sources.py` is pinned by SHA-256 inside
#: the committed Rodero candidate evidence (`derivation_files[5]`), so adding a
#: checksum field to its `RemoteFile` would break the immutable byte-binding on
#: evidence this checkpoint is required to leave untouched. This module owns its
#: own source registry instead, which is also the more honest arrangement: the
#: body context is not a pack ingest and does not go through the pack pipeline.
#:
#: The upstream path is MUTABLE — BodyParts3D publishes under `LATEST/` — so
#: these hashes are the pin. A mismatch fails the run rather than being recorded
#: as the new truth, because bytes that changed under a `LATEST/` path have not
#: had their licence or their content re-checked.
SOURCE_SHA256 = {
    "partof_BP3D_4.0_obj_99.zip":
        "9fbc713fffeee924a5a657d9813d84d7eb957bded63adb854931dd5e3eb61c97",
    "partof_element_parts.txt":
        "3f5f6df1028eb122b30de77c711597b6bb8e5541658e5985859fd228adbf88ea",
}

SOURCE_URLS = {
    name: f"https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/{name}"
    for name in SOURCE_SHA256
}


# --------------------------------------------------------------------------- #
# reading                                                                      #
# --------------------------------------------------------------------------- #


def elements_by_concept(cache: Path) -> dict[str, set[str]]:
    """Concept id -> its element ids, from the source's own PART-OF table."""
    rows = read_element_map(cache / ELEMENT_MAP)
    by_concept: dict[str, set[str]] = collections.defaultdict(set)
    for concept, _name, element in rows:
        by_concept[concept].add(element)
    return by_concept


def concept_vertices(cache: Path, by_concept: dict[str, set[str]], concept: str) -> np.ndarray:
    """Every vertex of every element the source lists under one concept."""
    blocks = []
    for element in sorted(by_concept.get(concept, ())):
        path = cache / ARCHIVE_DIR / f"{element}.obj"
        if path.exists():
            blocks.append(np.asarray(read_obj(path).vertices, dtype=np.float64))
    if not blocks:
        raise SystemExit(f"{concept}: no element geometry found under {cache / ARCHIVE_DIR}")
    return np.vstack(blocks)


def pack_node_vertices(gltf: Path) -> dict[str, np.ndarray]:
    """
    Structure id -> its world-space vertices, from a pack's own glTF.

    Goes through `read_gltf_surfaces` so node transforms are applied the same
    way the ingest applies them; a primitive is a buffer chunk rather than a
    structure, so primitives are grouped back by surface name.
    """
    grouped: dict[str, list[np.ndarray]] = collections.defaultdict(list)
    for surface, _material, _node in read_gltf_surfaces(gltf):
        # `read_gltf_surfaces` suffixes each primitive with `#index`, since one
        # structure can be split across several to stay under a 16-bit index
        # limit. The structure is the part before the suffix.
        structure = surface.name.rsplit("#", 1)[0]
        grouped[structure].append(np.asarray(surface.vertices, dtype=np.float64))
    return {name: np.vstack(blocks) for name, blocks in grouped.items()}


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_sources(cache: Path) -> dict[str, str]:
    """
    Check the cached upstream files against their pins before reading a byte.

    Fails the run on a mismatch. The alternative — deriving anyway and recording
    whatever hash arrived — would silently rebuild a registration from material
    whose provenance and licence were established for different bytes.
    """
    verified: dict[str, str] = {}
    for name, expected in SOURCE_SHA256.items():
        path = cache / name
        if not path.exists():
            raise SystemExit(
                f"{path} is missing. Fetch it from {SOURCE_URLS[name]} into the gitignored "
                "cache; raw sources are never committed."
            )
        actual = sha256_of(path)
        if actual != expected:
            raise SystemExit(
                f"{name}: sha256 mismatch — pinned {expected}, cached {actual}. The upstream "
                "path is 'LATEST/' and is free to change; re-verify the source and its licence "
                "before re-pinning, rather than updating the hash to whatever arrived."
            )
        verified[name] = actual
    return verified


# --------------------------------------------------------------------------- #
# the body frame                                                               #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class BodyAxes:
    """Which source axis carries each body direction, and how cleanly."""

    superior: np.ndarray
    anterior: np.ndarray
    patient_left: np.ndarray
    evidence: dict


def measure_body_axes(cache: Path, by_concept: dict[str, set[str]]) -> BodyAxes:
    """
    Ask the whole body which way is up, forward and left.

    Each direction is a difference between two structures whose relative
    position is not in question. They are measured IN ORDER and each one is
    orthogonalised against the ones already established, because the raw
    differences are not orthogonal and should not be expected to be:

    * **superior**, skull minus foot, is the cleanest vector in the body and
      needs nothing removed from it;
    * **patient-left**, left clavicle minus right, with the superior component
      removed — the two clavicles are not at identical heights;
    * **anterior**, sternum minus thoracic spine, with both removed. This one
      matters: the sternum's centroid sits well ABOVE the centroid of the whole
      thoracic spine, so the raw difference carries a 13-degree superior tilt
      (|cos| 0.9732 with -Y). That is real anatomy, not a broken frame, and
      anterior is a transverse-plane direction — so it is measured in the
      transverse plane rather than being rejected for failing to be one.

    The check is then that each ORTHOGONALISED direction is dominated by a
    single source axis. This source is axis-aligned; a direction that still came
    out obliquely after orthogonalisation would mean the archive's contents no
    longer share the coordinate frame the heart was read in.
    """
    centroid = {
        name: concept_vertices(cache, by_concept, concept).mean(axis=0)
        for name, concept in AXIS_CONCEPTS.items()
    }

    raw = {
        "superior": centroid["skull"] - centroid["right_foot"],
        "patient_left": centroid["left_clavicle"] - centroid["right_clavicle"],
        "anterior": centroid["sternum"] - centroid["thoracic_spine"],
    }

    axes: dict[str, np.ndarray] = {}
    evidence: dict = {"landmark_centroids_mm": {k: v.tolist() for k, v in centroid.items()},
                      "measurement_order": list(raw),
                      "measured": {}}
    established: list[np.ndarray] = []
    for name, vector in raw.items():
        residual = vector.astype(np.float64).copy()
        for prior in established:
            residual = residual - (residual @ prior) * prior
        unit = residual / np.linalg.norm(residual)
        index = int(np.argmax(np.abs(unit)))
        sign = float(np.sign(unit[index]))
        snapped = np.zeros(3)
        snapped[index] = sign
        cosine = float(abs(unit[index]))
        if cosine < AXIS_DOMINANCE:
            raise SystemExit(
                f"body axis {name!r} measured as {unit.round(4).tolist()}, which no single "
                f"source axis dominates (best |cos| = {cosine:.4f}). The source's parts no "
                "longer share one coordinate frame, or the wrong concepts were read."
            )
        axes[name] = snapped
        established.append(snapped)
        raw_unit = vector / np.linalg.norm(vector)
        evidence["measured"][name] = {
            "raw_mm": vector.tolist(),
            "raw_unit": raw_unit.tolist(),
            "orthogonalised_unit": unit.tolist(),
            "snapped_to": snapped.tolist(),
            "cosine_with_snapped_axis": cosine,
            "cosine_before_orthogonalisation": float(abs(raw_unit[index])),
        }

    left, superior, anterior = axes["patient_left"], axes["superior"], axes["anterior"]
    if not np.allclose(np.cross(left, superior), anterior):
        raise SystemExit(
            "measured body axes are not right-handed under the repository's convention "
            f"(patient_left x superior should equal anterior): {np.cross(left, superior)} "
            f"!= {anterior}"
        )
    evidence["handedness_check"] = "cross(patient_left, superior) == anterior"
    return BodyAxes(superior=superior, anterior=anterior, patient_left=left, evidence=evidence)


def bodyparts_to_body(axes: BodyAxes) -> np.ndarray:
    """
    Rotation from BodyParts3D source axes into the fixed patient/body frame.

    Rows are where each SOURCE axis has to go: `+X` patient-left, `+Y`
    posterior, `+Z` superior. Comes out as the identity for this source, which
    is a result and not a shortcut — it is built from the measurement either way.
    """
    return np.vstack([axes.patient_left, -axes.anterior, axes.superior])


# --------------------------------------------------------------------------- #
# landmarks                                                                    #
# --------------------------------------------------------------------------- #


def cavity_apex(cavity: np.ndarray, base: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    The apex of a left-ventricular cavity, and the long axis it was found along.

    The cavity's own principal axis, pointed away from `base`, and then the mean
    of the most apical `APEX_PERCENTILE` of the cloud along it. One helper for
    both hearts in a pairing, because an apex measured two different ways on the
    two sides would put the difference between the methods into the residual and
    call it anatomy.
    """
    centre = cavity.mean(axis=0)
    _, _, right = np.linalg.svd(cavity - centre, full_matrices=False)
    axis = right[0]
    # Point it apex-ward: away from the base.
    if float((base - centre) @ axis) > 0:
        axis = -axis
    projection = cavity @ axis
    apex = cavity[projection >= np.percentile(projection, APEX_PERCENTILE)].mean(axis=0)
    return apex, axis


def bodyparts_landmarks(cache: Path, by_concept: dict[str, set[str]]) -> dict:
    """The jig's landmarks, in BodyParts3D source millimetres."""
    valves = {
        name: concept_vertices(cache, by_concept, concept).mean(axis=0)
        for name, concept in VALVE_CONCEPTS.items()
    }
    base = np.mean(list(valves.values()), axis=0)

    cavity = concept_vertices(cache, by_concept, LV_CAVITY_CONCEPT)
    apex, axis = cavity_apex(cavity, base)

    return {"valves": valves, "base": base, "apex": apex, "lv_long_axis": axis}


def rodero_landmarks(pack: dict) -> dict:
    """
    Rodero's own published landmarks, carried into the pack's MODEL space.

    The pack publishes `landmarks_source_mm` in the SOURCE tet-mesh frame, not
    in the frame `views[].probe` uses — checked against the shipped glTF, where
    the two disagree by 23 to 45 mm. `basis_source_to_pack` is the rotation
    between them, and applying it reproduces the glTF's own valve-ring node
    centroids to under half a millimetre. That agreement is asserted by
    `check_against_gltf` rather than taken on trust.
    """
    frame = pack["meshes"]["anatomical_frame"]
    basis = frame["basis_source_to_pack"]
    rotation = np.array(
        [basis["patient_left"], basis["basal"], basis["anterior"]], dtype=np.float64
    )
    if abs(np.linalg.det(rotation) - 1.0) > 1e-9:
        raise SystemExit("pack basis_source_to_pack is not a rotation")

    source = frame["landmarks_source_mm"]
    valves = {
        name: rotation @ np.array(point, dtype=np.float64)
        for name, point in source["valve_rings"].items()
    }
    return {
        "valves": valves,
        "base": rotation @ np.array(source["base"], dtype=np.float64),
        "apex": rotation @ np.array(source["apex"], dtype=np.float64),
        "source_to_pack": rotation,
    }


# --------------------------------------------------------------------------- #
# the fit                                                                      #
# --------------------------------------------------------------------------- #


def kabsch(source: np.ndarray, target: np.ndarray, weights: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Weighted rigid fit, scale locked to one.

    The reflection guard is the `D` term: without it, a landmark set that is
    close to planar can be matched by a rotation composed with a mirror, which
    would swap left and right and still report a small residual. Anatomy has a
    handedness and a mirrored heart is a different organ, so the determinant is
    forced positive rather than checked afterwards.
    """
    weights = np.asarray(weights, dtype=np.float64)
    weights = weights / weights.sum()
    source_centre = (weights[:, None] * source).sum(axis=0)
    target_centre = (weights[:, None] * target).sum(axis=0)
    covariance = (weights[:, None] * (source - source_centre)).T @ (target - target_centre)
    u, _, vt = np.linalg.svd(covariance)
    d = np.diag([1.0, 1.0, float(np.sign(np.linalg.det(vt.T @ u.T)))])
    rotation = vt.T @ d @ u.T
    return rotation, target_centre - rotation @ source_centre


def direction_landmark(base: np.ndarray, apex: np.ndarray, length: float) -> np.ndarray:
    """A point on the base-to-apex ray at a shared distance: direction, not length."""
    unit = (apex - base) / np.linalg.norm(apex - base)
    return base + length * unit


def fit_registration(
    rodero: dict,
    bodyparts: dict,
    *,
    landmark_key: str = "valves",
    landmark_names: tuple[str, ...] = ("mitral", "tricuspid", "aortic", "pulmonary"),
    scheme_label: str = "valve_centres",
    source_length_key: str = "rodero_base_to_apex_mm",
    target_length_key: str = "bodyparts_base_to_apex_mm",
    shared_length: float | None = None,
) -> dict:
    """
    Pack model space -> body frame, and every number needed to judge it.

    Three schemes are computed. One is USED; the other two are recorded so the
    trade-off the chosen one makes is visible in the evidence rather than
    asserted in a comment.

    The landmark FAMILY is a parameter because two packs in this repository
    carry different ones and neither can be made to carry the other's.
    `normal-rodero` publishes four valve-ring centres, which sit on the fibrous
    skeleton and are the best landmarks available for placing a heart in a
    chest. `normal-vhl-heart0102-chambers` has no valve-ring geometry at all —
    its own provenance says the source has none and that none was invented — so
    it is fitted on the four chamber-cavity centroids instead. Same estimator,
    same scale lock, same three schemes; a cruder correspondence, and the
    residuals say so rather than the method hiding it.
    """
    names = list(landmark_names)
    source_points = np.array([rodero[landmark_key][n] for n in names])
    target_points = np.array([bodyparts[landmark_key][n] for n in names])

    rodero_length = float(np.linalg.norm(rodero["apex"] - rodero["base"]))
    bodyparts_length = float(np.linalg.norm(bodyparts["apex"] - bodyparts["base"]))
    shared = bodyparts_length if shared_length is None else float(shared_length)

    source_direction = direction_landmark(rodero["base"], rodero["apex"], shared)
    target_direction = direction_landmark(bodyparts["base"], bodyparts["apex"], shared)

    schemes = {
        f"{scheme_label}_and_apex_direction": (
            np.vstack([source_points, source_direction]),
            np.vstack([target_points, target_direction]),
            np.ones(5),
            names + ["apex_direction"],
        ),
        f"{scheme_label}_only": (
            source_points, target_points, np.ones(4), names,
        ),
        f"{scheme_label}_and_apex_point": (
            np.vstack([source_points, rodero["apex"]]),
            np.vstack([target_points, bodyparts["apex"]]),
            np.ones(5),
            names + ["apex_point"],
        ),
    }

    reports = {}
    for label, (source, target, weights, labels) in schemes.items():
        rotation, translation = kabsch(source, target, weights)
        residual = np.linalg.norm(source @ rotation.T + translation - target, axis=1)
        moved = rotation @ (rodero["apex"] - rodero["base"])
        moved = moved / np.linalg.norm(moved)
        reference = bodyparts["apex"] - bodyparts["base"]
        reference = reference / np.linalg.norm(reference)
        angle = float(
            np.degrees(np.arctan2(np.linalg.norm(np.cross(moved, reference)), moved @ reference))
        )
        apex_gap = float(
            np.linalg.norm(rotation @ rodero["apex"] + translation - bodyparts["apex"])
        )
        reports[label] = {
            "rotation": rotation,
            "translation": translation,
            "weights": {name: 1.0 for name in labels},
            "per_landmark_residual_mm": dict(zip(labels, residual.tolist())),
            "rms_residual_mm": float(np.sqrt((residual ** 2).mean())),
            "max_residual_mm": float(residual.max()),
            "long_axis_disagreement_deg": angle,
            "apex_separation_mm": apex_gap,
        }

    chosen = f"{scheme_label}_and_apex_direction"
    report = reports[chosen]
    report["scheme"] = chosen
    report["shared_direction_length_mm"] = shared
    report[source_length_key] = rodero_length
    report[target_length_key] = bodyparts_length
    report["irreducible_length_difference_mm"] = abs(rodero_length - bodyparts_length)
    report["apex_separation_attributable_to_fit_mm"] = (
        report["apex_separation_mm"] - report["irreducible_length_difference_mm"]
    )
    report["alternatives"] = {
        label: {k: v for k, v in body.items() if k not in ("rotation", "translation")}
        for label, body in reports.items()
        if label != chosen
    }
    return report


def validate_rigid(rotation: np.ndarray, translation: np.ndarray) -> dict:
    """Everything that has to be true of a rigid, unit-scale, non-reflecting map."""
    orthonormality = float(np.abs(rotation @ rotation.T - np.eye(3)).max())
    determinant = float(np.linalg.det(rotation))
    scales = np.linalg.norm(rotation, axis=0)
    if orthonormality > 1e-9:
        raise SystemExit(f"registration rotation is not orthonormal: error {orthonormality:.3e}")
    if abs(determinant - 1.0) > 1e-9:
        raise SystemExit(
            f"registration rotation has determinant {determinant:.12f}; a reflection or a "
            "scale has entered the fit"
        )
    if not np.all(np.isfinite(translation)):
        raise SystemExit("registration translation is not finite")
    return {
        "determinant": determinant,
        "orthonormality_error": orthonormality,
        "column_norms": scales.tolist(),
        "scale": 1.0,
        "reflection": False,
        "shear": False,
    }


# --------------------------------------------------------------------------- #
# checks against the shipped pack                                              #
# --------------------------------------------------------------------------- #


def check_against_gltf(pack_dir: Path, rodero: dict) -> dict:
    """
    The published landmarks must agree with the geometry that actually ships.

    A registration derived from a pack's metadata and applied to a pack's mesh
    is only sound while the two describe the same heart. The valve rings are
    separate glTF nodes, so this is directly checkable rather than assumed.
    """
    nodes = pack_node_vertices(pack_dir / "assets" / "model.gltf")
    agreement = {}
    for valve in VALVE_CONCEPTS:
        node = f"{valve}-valve-ring"
        if node not in nodes:
            raise SystemExit(f"{node}: expected valve-ring node missing from the pack glTF")
        gap = float(np.linalg.norm(nodes[node].mean(axis=0) - rodero["valves"][valve]))
        agreement[valve] = gap
    worst = max(agreement.values())
    if worst > 2.0:
        raise SystemExit(
            f"published landmarks disagree with the shipped mesh by up to {worst:.2f} mm; "
            "the pack's metadata and its geometry are not the same heart"
        )
    return {"per_valve_mm": agreement, "max_mm": worst}


def pleural_span(left_lung: np.ndarray, right_lung: np.ndarray,
                 heart: np.ndarray) -> float:
    """
    Pleural span at the heart's own height: the CTR denominator.

    Module level rather than a closure because the scale solver has to measure
    the ratio the SAME way the composite validation reports it. Two copies of
    this expression would let a fitted chest hit a target that the report then
    measured differently and disagreed with.
    """
    low, high = heart[:, 2].min(), heart[:, 2].max()
    band_left = left_lung[(left_lung[:, 2] > low) & (left_lung[:, 2] < high)]
    band_right = right_lung[(right_lung[:, 2] > low) & (right_lung[:, 2] < high)]
    return float(band_left[:, 0].max() - band_right[:, 0].min())


def composite_validation(cache: Path, by_concept: dict[str, set[str]],
                         heart_body: np.ndarray,
                         to_body: np.ndarray | None = None) -> dict:
    """
    Whether the registered heart is the right SIZE and PLACE for this chest.

    The registration fits a valve plane. It cannot tell you whether the heart it
    placed then fills the chest the way a heart should, and that is the question
    a reader actually has when they look at the composite.

    Every figure here is measured twice — once for the placed heart, once for
    BodyParts3D's OWN heart in the same chest — because the second is the
    control. A number that looks wrong for the composite means nothing until you
    know what the native pair scores.

    The honest summary of what this produces: placement is right, size is
    marginal. The cardiothoracic ratio comes out at 0.543 against 0.491 for the
    native pair, which radiographically reads as mild cardiomegaly, and the
    heart overlaps the diaphragm dome by up to 9.9 mm against 3.3 mm natively.
    Both differences are the same fact — Rodero is 14 mm wider — and the fault
    is not obviously Rodero's: its left ventricle is 86.7 mm base-to-apex, in
    the normal adult range, while BodyParts3D's is 65.9 mm, below it, in a
    source whose publisher says parts were artist-adjusted. A correctly sized
    heart in a slightly small chest is what this composite is.

    None of it is repaired. Repairing it would mean scaling one of the two, and
    a scaled heart is a heart with the wrong dimensions reported as the right
    ones.
    """
    # `to_body` carries BOTH the source-to-body rotation and, for a fitted
    # context, the uniform scale baked into the chest geometry. The control has
    # to be measured in the same body the heart was placed in, or the native
    # pair stops being a control.
    transform = np.eye(3) if to_body is None else np.asarray(to_body, dtype=np.float64)

    def concept_points(*concepts: str) -> np.ndarray:
        return np.vstack([concept_vertices(cache, by_concept, c) for c in concepts]) @ transform.T

    left_lung = concept_points("FMA7310")
    right_lung = concept_points("FMA7309")
    diaphragm = concept_points("FMA13295")
    spine = concept_points("FMA9140")
    sternum = concept_points("FMA7485")
    native = concept_points("FMA7088")  # the heart concept: BodyParts3D own heart

    def internal_thoracic_width(heart: np.ndarray) -> float:
        return pleural_span(left_lung, right_lung, heart)

    # The diaphragm dome, gridded in the transverse plane. Coarse on purpose:
    # this asks "is the heart under the dome here", not "do these surfaces
    # intersect", and a fine grid would report sampling noise as anatomy.
    dome: dict[tuple[int, int], float] = {}
    for point in diaphragm:
        key = (round(point[0] / 6), round(point[1] / 6))
        dome[key] = max(dome.get(key, -1e9), float(point[2]))

    def below_diaphragm(heart: np.ndarray) -> tuple[int, float]:
        count, worst = 0, 0.0
        for point in heart:
            top = dome.get((round(point[0] / 6), round(point[1] / 6)))
            if top is not None and point[2] < top:
                count += 1
                worst = max(worst, top - float(point[2]))
        return count, worst

    midline = float((sternum[:, 0].min() + sternum[:, 0].max()) / 2)

    def describe(heart: np.ndarray, label: str) -> dict:
        width = float(heart[:, 0].max() - heart[:, 0].min())
        internal = internal_thoracic_width(heart)
        count, worst = below_diaphragm(heart)
        return {
            "what": label,
            "transverse_cardiac_width_mm": round(width, 2),
            "internal_thoracic_width_mm": round(internal, 2),
            "cardiothoracic_ratio": round(width / internal, 4),
            "percent_left_of_midline": round(float((heart[:, 0] > midline).mean() * 100), 2),
            "right_border_mm_from_midline": round(float(heart[:, 0].min() - midline), 2),
            "left_border_mm_from_midline": round(float(heart[:, 0].max() - midline), 2),
            "vertices_below_diaphragm_dome": count,
            "vertices_total": int(len(heart)),
            "worst_below_diaphragm_mm": round(worst, 2),
        }

    # Behind the spine, and outside the skin, are the two failures that would
    # make the composite indefensible rather than merely imperfect.
    anterior_spine: dict[int, float] = {}
    for point in spine:
        key = round(point[2] / 6)
        anterior_spine[key] = min(anterior_spine.get(key, 1e9), float(point[1]))
    behind = sum(
        1 for point in heart_body
        if (front := anterior_spine.get(round(point[2] / 6))) is not None and point[1] > front
    )

    return {
        "method": (
            "Cardiothoracic ratio uses the pleural span at the heart's own height as the "
            "internal thoracic diameter, which is the radiographic denominator. The diaphragm "
            "test grids the dome in 6 mm transverse cells and asks whether heart geometry sits "
            "below it. Both are measured for the placed heart AND for BodyParts3D's own heart "
            "in the same chest, because the native pair is the control."
        ),
        "placed_heart": describe(heart_body, "the registered pack heart"),
        "native_control": describe(native, "BodyParts3D's own heart, its native pair"),
        "vertices_posterior_to_spine": behind,
        "normal_cardiothoracic_ratio": "< 0.50",
        "interpretation": (
            "Placement is anatomically correct: apex to the left at about the midclavicular "
            "line, roughly two thirds of the heart left of midline, nothing posterior to the "
            "spine, nothing outside the skin. SIZE is marginal and is not repaired. The placed "
            "heart is wider than the one this chest was built around, so the ratio exceeds 0.50 "
            "and the diaphragm overlap grows. Scaling either body to fix it would report false "
            "dimensions for whichever was scaled, so the difference is measured and disclosed "
            "instead. This is a reference composite, not a patient."
        ),
    }


def anatomy_checks(rotation: np.ndarray, translation: np.ndarray,
                   rodero: dict, pack_dir: Path) -> dict:
    """
    Sanity the fit could not have forced.

    A rigid fit on valve centres knows nothing about which way is down, so
    "the apex ends up inferior, anterior and to the left" is a real test of the
    result rather than a restatement of its inputs.
    """
    nodes = pack_node_vertices(pack_dir / "assets" / "model.gltf")

    def to_body(points: np.ndarray) -> np.ndarray:
        return points @ rotation.T + translation

    apex = rotation @ rodero["apex"] + translation
    base = rotation @ rodero["base"] + translation
    offset = apex - base
    left_ventricle = to_body(nodes["lv-myocardium"]).mean(axis=0)
    right_ventricle = to_body(nodes["rv-myocardium"]).mean(axis=0)

    checks = {
        "apex is inferior to the valve plane": bool(offset[2] < 0),
        "apex is anterior to the valve plane": bool(offset[1] < 0),
        "apex is left of the valve plane": bool(offset[0] > 0),
        "right ventricle is anterior to the left ventricle": bool(
            right_ventricle[1] < left_ventricle[1]
        ),
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        raise SystemExit("registered heart fails anatomical checks: " + "; ".join(failed))
    return {
        "checks": checks,
        "apex_minus_base_mm": offset.tolist(),
        "lv_centroid_body_mm": left_ventricle.tolist(),
        "rv_centroid_body_mm": right_ventricle.tolist(),
    }


# --------------------------------------------------------------------------- #
# the chest                                                                    #
# --------------------------------------------------------------------------- #


def _merge(blocks: list[tuple[np.ndarray, np.ndarray]], name: str) -> Surface:
    """Concatenate `(vertices, faces)` pairs into one surface, reindexing faces."""
    vertices: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    offset = 0
    for verts, tris in blocks:
        vertices.append(verts)
        faces.append(tris + offset)
        offset += len(verts)
    return Surface(
        name=name,
        vertices=np.ascontiguousarray(np.vstack(vertices), dtype=np.float32),
        faces=np.ascontiguousarray(np.vstack(faces), dtype=np.int32),
    )


def _crop_z(verts: np.ndarray, faces: np.ndarray, low: float, high: float
            ) -> tuple[np.ndarray, np.ndarray]:
    """
    Keep triangles whose centroid lies in `[low, high]`, leaving the edge open.

    By centroid rather than by "all three vertices inside", which would erode a
    band of triangles at the boundary and make the crop look like damage instead
    of a cut.
    """
    centroids = verts[faces].mean(axis=1)
    keep = (centroids[:, 2] >= low) & (centroids[:, 2] <= high)
    kept = faces[keep]
    used = np.unique(kept)
    remap = np.full(len(verts), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return verts[used], remap[kept].astype(np.int32)


def _decimate(surface: Surface, budget: int) -> tuple[Surface, float]:
    """
    Reduce to `budget` triangles and MEASURE what that cost.

    The error reported is the distance from each surviving vertex to the nearest
    vertex of the original mesh. It is a vertex-to-vertex figure, not a true
    surface Hausdorff distance, and it is named that way in the report rather
    than dressed up as something stronger: on a source this dense it is a fair
    proxy, and claiming a Hausdorff distance we did not compute would be exactly
    the kind of overstatement this pipeline exists to avoid.
    """
    if surface.triangle_count <= budget:
        return surface, 0.0
    reduction = min(max(1.0 - budget / surface.triangle_count, 0.0), 0.98)
    points, faces = fast_simplification.simplify(
        surface.vertices.astype(np.float32), surface.faces.astype(np.int32), reduction
    )
    reduced = Surface(
        name=surface.name,
        vertices=np.ascontiguousarray(points, dtype=np.float32),
        faces=np.ascontiguousarray(faces, dtype=np.int32),
    )
    distance, _ = cKDTree(surface.vertices.astype(np.float64)).query(
        reduced.vertices.astype(np.float64), k=1
    )
    return reduced, float(distance.max())


def build_chest(cache: Path, by_concept: dict[str, set[str]], to_body: np.ndarray,
                crop_z: tuple[float, float] = SKIN_CROP_Z_MM
                ) -> tuple[list[Surface], dict]:
    """
    Select, crop, merge and decimate the thoracic context.

    Coordinates stay in SOURCE millimetres throughout, which for this source is
    the body frame. Nothing is rescaled and nothing is recentred: the chest and
    the registration target have to sit in one frame or the heart inside them
    means nothing, and a chest quietly centred on its own bounds — which is what
    the geometry pack ingest does to a pack — would break exactly that.
    """
    surfaces: list[Surface] = []
    report: dict = {"groups": {}, "excluded": {
        "scapulae": (
            "FMA13395 and FMA13396, 54,278 triangles for the pair. Excluded on budget: "
            "comparable in cost to the ribs and the spine together, and positioned behind the "
            "heart where they occlude rather than orient."
        ),
    }}

    for group, concepts in CHEST_CONCEPTS.items():
        blocks: list[tuple[np.ndarray, np.ndarray]] = []
        elements: list[str] = []
        for concept in concepts:
            for element in sorted(by_concept.get(concept, ())):
                path = cache / ARCHIVE_DIR / f"{element}.obj"
                if not path.exists():
                    continue
                surface = read_obj(path)
                verts = np.asarray(surface.vertices, dtype=np.float64) @ to_body.T
                blocks.append((verts, np.asarray(surface.faces, dtype=np.int64)))
                elements.append(element)
        if not blocks:
            raise SystemExit(f"chest group {group!r}: no geometry found")

        merged = _merge(blocks, group)
        raw_triangles = merged.triangle_count
        raw_bounds = (merged.vertices.min(axis=0), merged.vertices.max(axis=0))

        cropped_note = None
        if group == "skin":
            verts, faces = _crop_z(
                merged.vertices.astype(np.float64), merged.faces.astype(np.int64),
                *crop_z,
            )
            merged = Surface(
                name=group,
                vertices=np.ascontiguousarray(verts, dtype=np.float32),
                faces=np.ascontiguousarray(faces, dtype=np.int32),
            )
            cropped_note = (
                f"cropped to z in [{crop_z[0]:.0f}, {crop_z[1]:.0f}] mm; "
                f"{raw_triangles:,} -> {merged.triangle_count:,} triangles. The cut edge is "
                "left open rather than capped."
            )

        before_decimation = merged.triangle_count
        merged, error_mm = _decimate(merged, CHEST_TRIANGLE_BUDGET[group])
        surfaces.append(merged)

        report["groups"][group] = {
            "concepts": list(concepts),
            "source_elements": elements,
            "source_element_count": len(elements),
            "raw_triangles": int(raw_triangles),
            "triangles_before_decimation": int(before_decimation),
            "triangles": int(merged.triangle_count),
            "triangle_budget": CHEST_TRIANGLE_BUDGET[group],
            "decimated": bool(before_decimation != merged.triangle_count),
            "max_vertex_to_source_vertex_mm": round(error_mm, 4),
            "bounds_before_mm": {
                "min": [round(v, 3) for v in raw_bounds[0].tolist()],
                "max": [round(v, 3) for v in raw_bounds[1].tolist()],
            },
            "bounds_after_mm": {
                "min": [round(float(v), 3) for v in merged.vertices.min(axis=0).tolist()],
                "max": [round(float(v), 3) for v in merged.vertices.max(axis=0).tolist()],
            },
            **({"crop": cropped_note} if cropped_note else {}),
        }

    report["totals"] = {
        "raw_triangles": sum(g["raw_triangles"] for g in report["groups"].values()),
        "triangles": sum(g["triangles"] for g in report["groups"].values()),
        "groups": len(surfaces),
        "draw_calls": len(surfaces),
    }
    return surfaces, report


def chest_clearances(surfaces: list[Surface], heart_body: np.ndarray) -> dict:
    """
    How close the registered heart comes to each chest structure.

    UNSIGNED nearest-surface distance, sampled vertex to vertex, and reported as
    an observation rather than as a gate. Organs in a real chest touch: the RV
    sits against the sternum, the heart rests on the diaphragm, the lungs hug it.
    A number near zero here is anatomy, not an error, and the point of measuring
    is that the composition can be judged instead of assumed.
    """
    out: dict = {}
    for surface in surfaces:
        distance, _ = cKDTree(surface.vertices.astype(np.float64)).query(heart_body, k=1)
        out[surface.name] = {
            "min_mm": round(float(distance.min()), 3),
            "median_mm": round(float(np.median(distance)), 3),
            "heart_points_within_5mm": int((distance < 5).sum()),
            "heart_points": int(len(heart_body)),
        }
    return out


# --------------------------------------------------------------------------- #
# output                                                                       #
# --------------------------------------------------------------------------- #


def build(cache: Path = CACHE, *, write_assets: bool = True) -> tuple[dict, dict]:
    """Derive everything, returning `(descriptor, evidence)`."""
    pack_dir = REPO / "public" / "packs" / BOUND_PACK_ID
    pack_path = pack_dir / "pack.json"
    pack = json.loads(pack_path.read_text())

    verified = verify_sources(cache)
    by_concept = elements_by_concept(cache)
    axes = measure_body_axes(cache, by_concept)
    to_body = bodyparts_to_body(axes)
    if not np.allclose(to_body, np.eye(3)):
        # Supported, just not what this source turns out to need. Recorded so a
        # future source revision that DOES need it is visible rather than silent.
        print(f"note: BodyParts3D -> body rotation is not the identity:\n{to_body}")

    bodyparts = bodyparts_landmarks(cache, by_concept)
    bodyparts = {
        "valves": {k: to_body @ v for k, v in bodyparts["valves"].items()},
        "base": to_body @ bodyparts["base"],
        "apex": to_body @ bodyparts["apex"],
        "lv_long_axis": to_body @ bodyparts["lv_long_axis"],
    }
    rodero = rodero_landmarks(pack)

    chest_surfaces, chest_report = build_chest(cache, by_concept, to_body)
    gltf_agreement = check_against_gltf(pack_dir, rodero)
    report = fit_registration(rodero, bodyparts)
    rotation, translation = report["rotation"], report["translation"]
    rigid = validate_rigid(rotation, translation)
    anatomy = anatomy_checks(rotation, translation, rodero, pack_dir)

    # The chest assets, and the measurements that justify them.
    assets_dir = CONTEXT_DIR / "assets"
    gltf_path = assets_dir / "chest.gltf"
    if write_assets:
        assets_dir.mkdir(parents=True, exist_ok=True)
        gltf_bytes, bin_bytes = write_gltf(gltf_path, chest_surfaces, bin_name="chest.bin")
        total_bytes = gltf_bytes + bin_bytes
        if total_bytes > CHEST_BUDGET_BYTES:
            raise SystemExit(
                f"chest assets are {total_bytes:,} bytes, over the "
                f"{CHEST_BUDGET_BYTES:,} budget. Context must not cost what a pack costs."
            )
        chest_report["totals"]["gltf_bytes"] = gltf_bytes
        chest_report["totals"]["bin_bytes"] = bin_bytes
        chest_report["totals"]["total_bytes"] = total_bytes

    # Clearances, measured against the heart as it actually lands in the body.
    heart_nodes = pack_node_vertices(pack_dir / "assets" / "model.gltf")
    heart_model = np.vstack(list(heart_nodes.values()))
    heart_body = heart_model @ rotation.T + translation
    chest_report["clearance_to_registered_heart"] = chest_clearances(chest_surfaces, heart_body)
    chest_report["registered_heart_bounds_body_mm"] = {
        "min": [round(float(v), 2) for v in heart_body.min(axis=0).tolist()],
        "max": [round(float(v), 2) for v in heart_body.max(axis=0).tolist()],
    }

    bin_path = assets_dir / "chest.bin"
    context_assets = [{
        "gltf": "assets/chest.gltf",
        "bin": "assets/chest.bin",
        "sha256": sha256_of(gltf_path),
        "bin_sha256": sha256_of(bin_path),
        "bytes": gltf_path.stat().st_size + bin_path.stat().st_size,
        "groups": [
            {
                "group": surface.name,
                "triangles": int(surface.triangle_count),
                "source_elements": chest_report["groups"][surface.name]["source_elements"],
            }
            for surface in chest_surfaces
        ],
    }] if gltf_path.exists() and bin_path.exists() else []

    descriptor = {
        "schema_version": SCHEMA_VERSION,
        "context_id": CONTEXT_ID,
        "display_name": "Adult reference chest — BodyParts3D",
        "pack_binding": {
            "pack_id": pack["meta"]["id"],
            "pack_version": pack["meta"]["pack_version"],
            "pack_schema_version": pack["meta"]["schema_version"],
            "pack_json_sha256": sha256_of(pack_path),
        },
        "body_frame": {
            "patient_left": [1, 0, 0],
            "posterior": [0, 1, 0],
            "superior": [0, 0, 1],
            "handedness": "right",
            "units": "mm",
            "note": (
                "Anterior is -Y. cross(patient_left, superior) = -Y = anterior, the same "
                "handedness convention meshes.anatomical_frame.basis_source_to_pack uses."
            ),
        },
        "model_to_body": {
            "rotation_row_major": [round(v, 12) for v in rotation.reshape(-1).tolist()],
            "translation_mm": [round(v, 9) for v in translation.tolist()],
            "scale": 1,
        },
        "registration": {
            "method": "rigid-landmark-kabsch-scale-locked-v1",
            "jig": (
                "BodyParts3D 4.0 heart, used only to measure where and how a heart sits in "
                "this body. It is never displayed; the displayed heart is the bound pack."
            ),
            "scheme": report["scheme"],
            "landmark_definitions": {
                "mitral/tricuspid/aortic/pulmonary": (
                    "target: vertex centroid of every element the source lists under the "
                    "valve concept (FMA7235/7234/7236/7246). source: the pack's published "
                    "anatomical_frame.landmarks_source_mm.valve_rings, carried into pack "
                    "model space by anatomical_frame.basis_source_to_pack."
                ),
                "apex_direction": (
                    "each heart's own base-to-apex unit vector taken out to a shared "
                    f"{report['shared_direction_length_mm']:.6f} mm. Constrains long-axis "
                    "DIRECTION without asserting the two hearts are the same length. "
                    "Target apex: mean of the most apical percentile of the BodyParts3D left "
                    "ventricular cavity (FMA9466) along that cavity's own principal axis. "
                    "Source apex: the pack's published apex, from its universal ventricular "
                    "coordinate."
                ),
            },
            "weights": report["weights"],
            "rms_residual_mm": report["rms_residual_mm"],
            "max_residual_mm": report["max_residual_mm"],
            "per_landmark_residual_mm": report["per_landmark_residual_mm"],
            "long_axis_disagreement_deg": report["long_axis_disagreement_deg"],
            "apex_separation_mm": report["apex_separation_mm"],
            "irreducible_length_difference_mm": report["irreducible_length_difference_mm"],
            "apex_separation_attributable_to_fit_mm": report[
                "apex_separation_attributable_to_fit_mm"
            ],
            "rigid_validation": rigid,
            "anatomy_checks": anatomy["checks"],
        },
        "context_assets": context_assets,
        "provenance": {
            "creator": (
                "The Database Center for Life Science (DBCLS), Research Organization of "
                "Information and Systems"
            ),
            "source": (
                "BodyParts3D 4.0, partof_BP3D_4.0_obj_99.zip and partof_element_parts.txt, "
                "LSDB Archive"
            ),
            "source_urls": {
                "description": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html",
                "download": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html",
                "license": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
                "paper": "https://academic.oup.com/nar/article/37/suppl_1/D782/1000752",
                "source_cautions": "https://lifesciencedb.jp/bp3d/info_en/index.html",
                "taro_scale_information": (
                    "https://emc.nict.go.jp/bio/en-data-offer/information-on-the-provision.html"
                ),
            },
            "source_sha256": verified,
            "license": "CC-BY-4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "license_state": "confirmed",
            "attribution": (
                "BodyParts3D, © The Database Center for Life Science licensed under CC "
                "Attribution 4.0 International"
            ),
            "license_read_on": "2026-08-21",
            "license_page_last_updated": "2025/02/27",
            "license_history_caveat": (
                "The rights holder's current licence page states CC Attribution 4.0 "
                "International and grants redistribution and derivative works explicitly. "
                "Older project pages for the same data state CC BY-SA 2.1 Japan. The "
                "licensing history is NOT consistent; the current page is taken as "
                "authoritative because it is the rights holder's own and is the more recent "
                "statement. If that reading is wrong, material derived from this source is a "
                "share-alike derivative and this record must be revisited."
            ),
            "subject": (
                "A living adult male. BodyParts3D describes itself as a three-dimensional "
                "whole-body model for an adult human male, and the underlying whole-body "
                "reference is an MRI volunteer (the NICT/TARO adult male reference), NOT a "
                "cadaver and NOT a post-mortem specimen. Whole-body skin height measured from "
                "the source is 1719 mm."
            ),
            "source_cautions": (
                "The publisher's own notice states there could be many errors for use as "
                "anatomical education, and that some parts were made from scratch by artists "
                "or distorted to fit into the environment. It also warns that OBJ sets are "
                "versioned per organ and that sets differing in the one's place of their "
                "version number do not necessarily share body coordinates."
            ),
            "known_legacy_provenance_defect": (
                "pipeline/sources.py and public/packs/anatomy-bodyparts3d-heart/pack.json both "
                "describe this source as a cadaver with a post-mortem leaflet configuration. "
                "That is wrong, and it is NOT corrected in place by this checkpoint: "
                "pipeline/sources.py is pinned by SHA-256 inside the committed Rodero candidate "
                "evidence (derivation_files[5]), and editing it would break an immutable "
                "byte-binding on evidence that must stay unchanged. The correction is recorded "
                "here and deferred to a separate evidence-safe migration."
            ),
            "not_a_patient": (
                "A population-average adult heart rigidly placed inside one adult male "
                "reference body. A teaching composite: not a patient, not a matched pair, and "
                "not clinical ground truth."
            ),
        },
    }

    evidence = {
        "context_id": CONTEXT_ID,
        "body_axis_measurement": axes.evidence,
        "bodyparts_to_body_rotation_row_major": to_body.reshape(-1).tolist(),
        "landmarks_body_mm": {
            "valves": {k: v.tolist() for k, v in bodyparts["valves"].items()},
            "base": bodyparts["base"].tolist(),
            "apex": bodyparts["apex"].tolist(),
        },
        "landmarks_pack_model_mm": {
            "valves": {k: v.tolist() for k, v in rodero["valves"].items()},
            "base": rodero["base"].tolist(),
            "apex": rodero["apex"].tolist(),
        },
        "published_landmarks_agree_with_shipped_gltf_mm": gltf_agreement,
        "fit": {k: v for k, v in report.items() if k not in ("rotation", "translation")},
        "chest": chest_report,
        "rigid_validation": rigid,
        "anatomy": anatomy,
        "composite_validation": composite_validation(cache, by_concept, heart_body),
    }
    return descriptor, evidence


# --------------------------------------------------------------------------- #
# the fitted context: one chest, scaled to one heart                           #
# --------------------------------------------------------------------------- #

#: The second context, and the pack it is FOR.
#:
#: A separate context rather than a second registration inside the first, for
#: the same reason the first one is a document and not a pack field: a body
#: context is a fact about a PAIRING. `adult-reference-chest-bp3d` is the
#: pairing of the BodyParts3D thorax at its native size with `normal-rodero`,
#: and nothing here may change it.
FITTED_CONTEXT_ID = "fitted-chest-bp3d-heart0102-chambers"
FITTED_CONTEXT_DIR = REPO / "public" / "body-context" / FITTED_CONTEXT_ID
FITTED_EVIDENCE_DIR = REPO / "evidence" / "body-context" / FITTED_CONTEXT_ID
FITTED_BOUND_PACK_ID = "normal-vhl-heart0102-chambers"

#: The date the owner decided to fit a chest to this heart rather than source a
#: new body, and to do it by uniform scale only.
FITTED_OWNER_DECISION_DATE = "2026-08-22"

#: The four chamber CAVITIES, which are this pairing's landmark correspondence.
#:
#: `normal-vhl-heart0102-chambers` has no valve-ring geometry — its own
#: provenance records that the source has none and that none was invented — so
#: the valve-centre jig the Rodero registration uses cannot be built for it.
#: Chamber cavities are what both hearts actually have: four of them, named on
#: both sides, and not collinear, so they determine an orientation.
#:
#: They are a CRUDER correspondence than valve centres. A cavity centroid moves
#: with how full the cavity is, and this pack's right atrium and right ventricle
#: are both larger than expected. The residuals are reported rather than the
#: choice being presented as equivalent to the Rodero one.
CHAMBER_CAVITY_CONCEPTS = {
    "left_ventricle": "FMA9466",
    "right_ventricle": "FMA9291",
    "left_atrium": "FMA9465",
    "right_atrium": "FMA11359",
}

#: The pack's own lumen nodes, in the same order.
CHAMBER_PACK_NODES = {
    "left_ventricle": "lv-lumen",
    "right_ventricle": "rv-lumen",
    "left_atrium": "la-lumen",
    "right_atrium": "ra-lumen",
}

#: Bounds, step count and rounding for the uniform scale search.
#:
#: Bisection rather than a formula because the denominator is not a closed form:
#: the pleural span is measured in the band the heart occupies, and that band
#: moves as the chest is scaled. Fixed bounds and a fixed step count so the
#: answer is the same on every machine and every run; the result is then ROUNDED
#: and everything downstream is rebuilt from the rounded number, so the shipped
#: geometry is a function of a short decimal rather than of a search trajectory.
SCALE_SEARCH_BOUNDS = (0.5, 2.5)
SCALE_BISECTION_STEPS = 60
SCALE_DECIMALS = 6

#: How far the achieved ratio may sit from the native pair's before the run
#: fails. The gate the owner set is 0.01; this is that gate, in the pipeline.
CTR_TOLERANCE = 0.01

#: Transverse cell size for the containment tests, in body millimetres. Matches
#: the diaphragm dome grid in `composite_validation`: coarse on purpose, because
#: the question is "is the heart inside the cage here", not "do these two
#: surfaces intersect".
CONTAINMENT_CELL_MM = 6.0


def chamber_landmarks(chambers: dict[str, np.ndarray]) -> dict:
    """
    Chamber-cavity landmarks, measured identically on both hearts of a pairing.

    * each chamber's landmark is its cavity centroid;
    * `base` is the midpoint of the two ATRIAL centroids, which is the same
      basal reference the pack's own measured cardiac frame uses
      (`meshes.anatomical_frame`: "basal is the ventricular midpoint to the
      atrial midpoint");
    * `apex` is `cavity_apex` of the left-ventricular cavity about that base.

    One function for both sides. A landmark defined one way on the source and
    another way on the target puts the difference between two definitions into
    the residual and reports it as anatomy.
    """
    centroids = {name: points.mean(axis=0) for name, points in chambers.items()}
    base = (centroids["left_atrium"] + centroids["right_atrium"]) / 2.0
    apex, axis = cavity_apex(chambers["left_ventricle"], base)
    return {"chambers": centroids, "base": base, "apex": apex, "lv_long_axis": axis}


def bodyparts_chamber_landmarks(cache: Path, by_concept: dict[str, set[str]]) -> dict:
    """The jig's chamber landmarks, in BodyParts3D source millimetres."""
    return chamber_landmarks({
        name: concept_vertices(cache, by_concept, concept)
        for name, concept in CHAMBER_CAVITY_CONCEPTS.items()
    })


def pack_chamber_landmarks(nodes: dict[str, np.ndarray]) -> dict:
    """
    The pack's chamber landmarks, taken from the geometry that actually ships.

    Straight off the glTF rather than out of `anatomical_frame`. The pack's
    published `landmarks_source_mm.observer_seed_centroids` are the means of
    hand-placed SEED MARKS, not of the labelled volumes those marks grew into,
    so they are not the same quantity as a cavity centroid and using them would
    silently mix two definitions. The seeds are compared against these in the
    evidence file as an observation instead.
    """
    missing = [node for node in CHAMBER_PACK_NODES.values() if node not in nodes]
    if missing:
        raise SystemExit(
            f"{FITTED_BOUND_PACK_ID}: expected lumen node(s) missing from the pack glTF: "
            + ", ".join(missing)
        )
    return chamber_landmarks({
        name: nodes[node] for name, node in CHAMBER_PACK_NODES.items()
    })


def scaled_to_body(to_body: np.ndarray, scale: float) -> np.ndarray:
    """
    Source axes -> body frame, with the fitted uniform scale folded in.

    This is where the scaling LIVES: in the transform that builds the chest
    asset, so the millimetres written into the glTF are already the fitted ones.
    `model_to_body` in the descriptor stays rigid and unit-scale, because a
    scale there would resize the HEART, which is the one thing that must not be
    resized — and `rigidProblem` refuses it for exactly that reason.
    """
    return np.asarray(to_body, dtype=np.float64) * float(scale)


def fit_chambers(pack: dict, body: dict, scale: float) -> dict:
    """The chamber-landmark registration into a body scaled by `scale`."""
    scaled = {
        "chambers": {k: v * scale for k, v in body["chambers"].items()},
        "base": body["base"] * scale,
        "apex": body["apex"] * scale,
    }
    shared = float(np.linalg.norm(scaled["apex"] - scaled["base"]))
    return fit_registration(
        pack, scaled,
        landmark_key="chambers",
        landmark_names=tuple(CHAMBER_CAVITY_CONCEPTS),
        scheme_label="chamber_centroids",
        source_length_key="pack_base_to_apex_mm",
        target_length_key="bodyparts_base_to_apex_mm",
        shared_length=shared,
    )


def cardiothoracic_ratio(heart: np.ndarray, left_lung: np.ndarray,
                         right_lung: np.ndarray) -> tuple[float, float, float]:
    """`(ratio, transverse cardiac width, internal thoracic width)`, all in mm."""
    width = float(heart[:, 0].max() - heart[:, 0].min())
    span = pleural_span(left_lung, right_lung, heart)
    return width / span, width, span


def solve_chest_scale(pack_landmarks: dict, body_landmarks: dict, heart_model: np.ndarray,
                      left_lung: np.ndarray, right_lung: np.ndarray,
                      target_ratio: float) -> tuple[float, dict]:
    """
    The one number this context adds: how much to scale the chest.

    THE RULE. BodyParts3D's own heart sits in its own thorax at a measured
    cardiothoracic ratio. That ratio is the target, and the chest is scaled
    UNIFORMLY until the bound pack's heart occupies the same fraction of it,
    measured exactly the way `composite_validation` measures it.

    Uniform and nothing else. Per-axis factors would invent proportions no
    measurement in this repository supports — the source is one man's thorax and
    there is no second body here to say how a chest that is deeper is also wide.
    A uniform scale asserts one thing only: this thorax, at a different size.

    The ratio falls monotonically as the chest grows, so this is a bisection.
    The heart's own transverse width barely moves — the fit's rotation is almost
    scale-independent — so the search is really solving for the denominator.
    """
    low, high = SCALE_SEARCH_BOUNDS
    trace: list[dict] = []

    def ratio_at(scale: float) -> tuple[float, float, float]:
        report = fit_chambers(pack_landmarks, body_landmarks, scale)
        heart = heart_model @ report["rotation"].T + report["translation"]
        return cardiothoracic_ratio(heart, left_lung * scale, right_lung * scale)

    if ratio_at(low)[0] < target_ratio or ratio_at(high)[0] > target_ratio:
        raise SystemExit(
            f"the target cardiothoracic ratio {target_ratio:.4f} is not bracketed by scales "
            f"{low} to {high}. The pairing is further from the native one than a uniform "
            "scale of this size can express; this needs an owner decision, not a wider search."
        )

    for _ in range(SCALE_BISECTION_STEPS):
        middle = 0.5 * (low + high)
        if ratio_at(middle)[0] > target_ratio:
            low = middle
        else:
            high = middle
    solved = 0.5 * (low + high)
    scale = round(solved, SCALE_DECIMALS)

    for probe in (1.0, scale):
        ratio, width, span = ratio_at(probe)
        trace.append({
            "scale": probe,
            "cardiothoracic_ratio": round(ratio, 4),
            "transverse_cardiac_width_mm": round(width, 2),
            "internal_thoracic_width_mm": round(span, 2),
        })

    achieved, width, span = ratio_at(scale)
    if abs(achieved - target_ratio) > CTR_TOLERANCE:
        raise SystemExit(
            f"uniform scale {scale} achieves a cardiothoracic ratio of {achieved:.4f}, which is "
            f"more than {CTR_TOLERANCE} from the native pair's {target_ratio:.4f}."
        )

    return scale, {
        "target_cardiothoracic_ratio": round(target_ratio, 4),
        "achieved_cardiothoracic_ratio": round(achieved, 4),
        "uniform_scale_factor": scale,
        "unrounded_solution": round(solved, 12),
        "search_bounds": list(SCALE_SEARCH_BOUNDS),
        "bisection_steps": SCALE_BISECTION_STEPS,
        "rounded_to_decimals": SCALE_DECIMALS,
        "transverse_cardiac_width_mm": round(width, 2),
        "internal_thoracic_width_mm": round(span, 2),
        "at_each_scale": trace,
    }


def _facing_wall(points: np.ndarray, heart: np.ndarray, key_axes: list[int],
                 value_axis: int, mode: str) -> tuple[np.ndarray, np.ndarray]:
    """
    Per transverse cell, the chest coordinate facing each heart point.

    Both clouds are binned on the same grid and given cell ids in one pass, so
    a heart point and the wall in front of it are matched by construction rather
    than by a lookup that could silently miss. `matched` is false for a heart
    point whose cell holds no chest geometry at all; those make no claim either
    way and are excluded rather than counted as clearance.
    """
    chest_cells = np.floor_divide(points[:, key_axes], CONTAINMENT_CELL_MM).astype(np.int64)
    heart_cells = np.floor_divide(heart[:, key_axes], CONTAINMENT_CELL_MM).astype(np.int64)
    _, ids = np.unique(np.vstack([chest_cells, heart_cells]), axis=0, return_inverse=True)
    ids = np.asarray(ids).reshape(-1)
    chest_ids, heart_ids = ids[:len(chest_cells)], ids[len(chest_cells):]

    extreme = np.full(int(ids.max()) + 1, -np.inf if mode == "max" else np.inf)
    if mode == "max":
        np.maximum.at(extreme, chest_ids, points[:, value_axis])
    else:
        np.minimum.at(extreme, chest_ids, points[:, value_axis])

    wall = extreme[heart_ids]
    return wall, np.isfinite(wall)


def containment_report(chest_points: dict[str, np.ndarray], heart: np.ndarray,
                       midline: float) -> dict:
    """
    Whether the placed heart is INSIDE the cage, with clearance, per structure.

    The unsigned nearest-surface distances `chest_clearances` reports say how
    CLOSE the heart comes to each group; they cannot say which SIDE of it the
    heart is on, and "3 mm from the sternum" reads identically whether the heart
    is behind it or through it. This is the directed test, one structure at a
    time, in the direction each structure actually contains a heart:

    * spine — the heart is anterior to the spine's anterior surface;
    * sternum — the heart is posterior to the sternum's posterior surface;
    * ribs — the heart is medial to the rib cage, tested per side against the
      cage's own left and right extremes.

    Each is measured per transverse cell so a curved cage is compared with the
    part of the heart that actually faces it, rather than one global extreme
    being compared with another somewhere else in the chest. A violation fails
    the run: a heart through its own ribs is not a composite worth shipping.
    """
    ribs = chest_points["ribs"]
    tests = {
        "spine": ("heart anterior to the spine's anterior surface",
                  chest_points["spine"], [2], 1, "min", -1.0),
        "sternum": ("heart posterior to the sternum's posterior surface",
                    chest_points["sternum"], [0, 2], 1, "max", +1.0),
        "ribs_left": ("heart medial to the left rib cage",
                      ribs[ribs[:, 0] > midline], [1, 2], 0, "max", -1.0),
        "ribs_right": ("heart medial to the right rib cage",
                       ribs[ribs[:, 0] < midline], [1, 2], 0, "min", +1.0),
    }

    structures: dict = {}
    for name, (direction, points, key_axes, value_axis, mode, sign) in tests.items():
        wall, matched = _facing_wall(points, heart, key_axes, value_axis, mode)
        clearance = sign * (heart[matched][:, value_axis] - wall[matched])
        structures[name] = {
            "direction": direction,
            "heart_points_facing_it": int(matched.sum()),
            "heart_points_total": int(len(heart)),
            "min_clearance_mm": round(float(clearance.min()), 3),
            "median_clearance_mm": round(float(np.median(clearance)), 3),
            "violations": int((clearance < 0).sum()),
        }

    failed = [n for n, s in structures.items() if s["violations"] > 0]
    if failed:
        detail = "; ".join(
            f"{n}: {structures[n]['violations']} point(s), worst "
            f"{structures[n]['min_clearance_mm']} mm"
            for n in failed
        )
        raise SystemExit(
            "the registered heart is not inside the fitted rib cage: " + detail
        )

    return {
        "method": (
            f"Per {CONTAINMENT_CELL_MM:.0f} mm transverse cell, the coordinate of the chest "
            "structure facing each heart point, compared with the heart point in the direction "
            "that structure contains a heart. Signed: positive is inside. Heart points with no "
            "chest geometry in their own cell are not counted, because a cell with no wall in "
            "it makes no claim either way."
        ),
        "structures": structures,
        "all_clearances_positive": True,
    }


def seed_centroid_comparison(pack: dict, pack_landmarks: dict) -> dict:
    """
    How far the pack's published seed centroids sit from its lumen centroids.

    An observation, not a check. The pack publishes the mean of the hand-placed
    SEED MARKS per chamber; this registration uses the mean of the LABELLED
    VOLUME each mark grew into. They are different quantities and are expected
    to disagree — recorded so that using the geometry rather than the metadata
    is a visible choice rather than a silent one.
    """
    frame = pack["meshes"]["anatomical_frame"]
    basis = frame["basis_source_to_pack"]
    rotation = np.array(
        [basis["patient_left"], basis["basal"], basis["anterior"]], dtype=np.float64
    )
    seeds = frame["landmarks_source_mm"]["observer_seed_centroids"]
    out = {}
    for name, node in CHAMBER_PACK_NODES.items():
        if name not in seeds:
            continue
        seed = rotation @ np.array(seeds[name], dtype=np.float64)
        out[name] = {
            "seed_centroid_pack_mm": [round(v, 3) for v in seed.tolist()],
            "lumen_centroid_pack_mm": [
                round(float(v), 3) for v in pack_landmarks["chambers"][name].tolist()
            ],
            "separation_mm": round(
                float(np.linalg.norm(seed - pack_landmarks["chambers"][name])), 3
            ),
        }
    return out


def build_fitted(cache: Path = CACHE, *, write_assets: bool = True) -> tuple[dict, dict]:
    """Derive the fitted context, returning `(descriptor, evidence)`."""
    pack_dir = REPO / "public" / "packs" / FITTED_BOUND_PACK_ID
    pack_path = pack_dir / "pack.json"
    if not pack_path.exists():
        raise SystemExit(
            f"{pack_path.relative_to(REPO)} is missing. This context is bound to that pack and "
            "cannot be derived without it."
        )
    pack = json.loads(pack_path.read_text())

    verified = verify_sources(cache)
    by_concept = elements_by_concept(cache)
    axes = measure_body_axes(cache, by_concept)
    to_body = bodyparts_to_body(axes)

    source_landmarks = bodyparts_chamber_landmarks(cache, by_concept)
    body_landmarks = {
        "chambers": {k: to_body @ v for k, v in source_landmarks["chambers"].items()},
        "base": to_body @ source_landmarks["base"],
        "apex": to_body @ source_landmarks["apex"],
    }

    nodes = pack_node_vertices(pack_dir / "assets" / "model.gltf")
    pack_landmarks = pack_chamber_landmarks(nodes)
    heart_model = np.vstack(list(nodes.values()))

    left_lung = concept_vertices(cache, by_concept, "FMA7310") @ to_body.T
    right_lung = concept_vertices(cache, by_concept, "FMA7309") @ to_body.T
    native = concept_vertices(cache, by_concept, "FMA7088") @ to_body.T

    # The target is not a constant typed in from a document: it is measured here,
    # from BodyParts3D's own heart in BodyParts3D's own thorax, so the number the
    # chest is fitted to is re-derived on every run alongside the fit itself.
    native_ratio, native_width, native_span = cardiothoracic_ratio(native, left_lung, right_lung)
    target_ratio = round(native_ratio, 4)

    scale, scaling = solve_chest_scale(
        pack_landmarks, body_landmarks, heart_model, left_lung, right_lung, target_ratio
    )
    scaling["native_pair"] = {
        "what": "BodyParts3D's own heart in its own thorax, at native size",
        "transverse_cardiac_width_mm": round(native_width, 2),
        "internal_thoracic_width_mm": round(native_span, 2),
        "cardiothoracic_ratio": round(native_ratio, 4),
        "note": (
            "The ratio of a body to itself does not change when that body is scaled uniformly, "
            "so this control reads the same in the fitted chest as at native size. That is the "
            "check that the scaling really was uniform."
        ),
    }

    to_body_scaled = scaled_to_body(to_body, scale)
    crop_z = (SKIN_CROP_Z_MM[0] * scale, SKIN_CROP_Z_MM[1] * scale)
    chest_surfaces, chest_report = build_chest(cache, by_concept, to_body_scaled, crop_z)
    chest_report["uniform_scale_factor"] = scale
    chest_report["skin_crop_z_mm"] = [round(v, 3) for v in crop_z]

    report = fit_chambers(pack_landmarks, body_landmarks, scale)
    rotation, translation = report["rotation"], report["translation"]
    rigid = validate_rigid(rotation, translation)
    anatomy = anatomy_checks(rotation, translation, pack_landmarks, pack_dir)

    assets_dir = FITTED_CONTEXT_DIR / "assets"
    gltf_path = assets_dir / "chest.gltf"
    bin_path = assets_dir / "chest.bin"
    if write_assets:
        assets_dir.mkdir(parents=True, exist_ok=True)
        gltf_bytes, bin_bytes = write_gltf(gltf_path, chest_surfaces, bin_name="chest.bin")
        total_bytes = gltf_bytes + bin_bytes
        if total_bytes > CHEST_BUDGET_BYTES:
            raise SystemExit(
                f"chest assets are {total_bytes:,} bytes, over the "
                f"{CHEST_BUDGET_BYTES:,} budget. Context must not cost what a pack costs."
            )
        chest_report["totals"]["gltf_bytes"] = gltf_bytes
        chest_report["totals"]["bin_bytes"] = bin_bytes
        chest_report["totals"]["total_bytes"] = total_bytes

    heart_body = heart_model @ rotation.T + translation
    chest_report["clearance_to_registered_heart"] = chest_clearances(chest_surfaces, heart_body)
    chest_report["registered_heart_bounds_body_mm"] = {
        "min": [round(float(v), 2) for v in heart_body.min(axis=0).tolist()],
        "max": [round(float(v), 2) for v in heart_body.max(axis=0).tolist()],
    }

    # Containment is measured against the FULL-RESOLUTION source structures, not
    # the decimated display meshes: decimation moves vertices by up to a
    # millimetre, and a containment answer should not depend on a triangle
    # budget chosen for frame rate.
    sternum = concept_vertices(cache, by_concept, "FMA7485") @ to_body_scaled.T
    containment = containment_report(
        {
            "ribs": concept_vertices(cache, by_concept, "FMA7480") @ to_body_scaled.T,
            "sternum": sternum,
            "spine": concept_vertices(cache, by_concept, "FMA9140") @ to_body_scaled.T,
        },
        heart_body,
        float((sternum[:, 0].min() + sternum[:, 0].max()) / 2),
    )
    chest_report["heart_inside_the_rib_cage"] = containment

    context_assets = [{
        "gltf": "assets/chest.gltf",
        "bin": "assets/chest.bin",
        "sha256": sha256_of(gltf_path),
        "bin_sha256": sha256_of(bin_path),
        "bytes": gltf_path.stat().st_size + bin_path.stat().st_size,
        "groups": [
            {
                "group": surface.name,
                "triangles": int(surface.triangle_count),
                "source_elements": chest_report["groups"][surface.name]["source_elements"],
            }
            for surface in chest_surfaces
        ],
    }] if gltf_path.exists() and bin_path.exists() else []

    scaled_body_height_mm = round(1719.0 * scale, 1)

    descriptor = {
        "schema_version": SCHEMA_VERSION,
        "context_id": FITTED_CONTEXT_ID,
        "display_name": "Fitted reference chest — BodyParts3D scaled to this heart",
        "pack_binding": {
            "pack_id": pack["meta"]["id"],
            "pack_version": pack["meta"]["pack_version"],
            "pack_schema_version": pack["meta"]["schema_version"],
            "pack_json_sha256": sha256_of(pack_path),
        },
        "body_frame": {
            "patient_left": [1, 0, 0],
            "posterior": [0, 1, 0],
            "superior": [0, 0, 1],
            "handedness": "right",
            "units": "mm",
            "note": (
                "Anterior is -Y. cross(patient_left, superior) = -Y = anterior, the same "
                "handedness convention meshes.anatomical_frame.basis_source_to_pack uses."
            ),
        },
        "model_to_body": {
            "rotation_row_major": [round(v, 12) for v in rotation.reshape(-1).tolist()],
            "translation_mm": [round(v, 9) for v in translation.tolist()],
            "scale": 1,
        },
        "registration": {
            "method": "rigid-landmark-kabsch-scale-locked-v1",
            "jig": (
                "BodyParts3D 4.0 heart, uniformly scaled with its own thorax, used only to "
                "measure where and how a heart sits in this body. It is never displayed; the "
                "displayed heart is the bound pack."
            ),
            "scheme": report["scheme"],
            "landmark_definitions": {
                "left_ventricle/right_ventricle/left_atrium/right_atrium": (
                    "target: vertex centroid of every element the source lists under the "
                    "chamber-cavity concept (FMA9466/9291/9465/11359), in the uniformly scaled "
                    "body. source: vertex centroid of the pack's own lumen node "
                    "(lv-lumen/rv-lumen/la-lumen/ra-lumen) in the shipped glTF. Chamber "
                    "cavities rather than valve rings because this pack HAS no valve-ring "
                    "geometry: its source carries none and its provenance records that none "
                    "was invented."
                ),
                "apex_direction": (
                    "each heart's own base-to-apex unit vector taken out to a shared "
                    f"{report['shared_direction_length_mm']:.6f} mm. Constrains long-axis "
                    "DIRECTION without asserting the two hearts are the same length. Base on "
                    "both sides is the midpoint of the two atrial cavity centroids, which is "
                    "the basal reference the pack's own measured cardiac frame uses. Apex on "
                    "both sides is the mean of the most apical percentile of the left "
                    "ventricular cavity along that cavity's own principal axis."
                ),
            },
            "weights": report["weights"],
            "rms_residual_mm": report["rms_residual_mm"],
            "max_residual_mm": report["max_residual_mm"],
            "per_landmark_residual_mm": report["per_landmark_residual_mm"],
            "long_axis_disagreement_deg": report["long_axis_disagreement_deg"],
            "apex_separation_mm": report["apex_separation_mm"],
            "irreducible_length_difference_mm": report["irreducible_length_difference_mm"],
            "apex_separation_attributable_to_fit_mm": report[
                "apex_separation_attributable_to_fit_mm"
            ],
            "landmark_caveat": (
                "Chamber-cavity centroids are a CRUDER correspondence than the valve centres "
                "adult-reference-chest-bp3d fits on, and the residuals are correspondingly "
                "larger. A cavity centroid moves with how full the cavity is, and this pack's "
                "right ventricular lumen is 148.3 mL against an expected 60-100 mL and remains "
                "unresolved, so part of the residual is a labelling question rather than a "
                "registration one."
            ),
            "chest_scaling": {
                "what_was_scaled": (
                    "THE CHEST, not the heart. The BodyParts3D source is uniformly scaled about "
                    "the body-frame origin before the thoracic geometry is extracted, so the "
                    "millimetres written into chest.bin are already the fitted ones."
                ),
                "why_not_in_model_to_body": (
                    "model_to_body maps the HEART into the body and stays rigid at scale exactly "
                    "1; body-context/v0 pins it to literal 1 and rigidProblem() refuses a scale, "
                    "a shear and a reflection. A scale there would silently resize the anatomy "
                    "the learner is reading. Baking the fit into the chest asset keeps the one "
                    "thing that must not be resized unresized."
                ),
                "uniform_scale_factor": scale,
                "uniform_not_per_axis": (
                    "One factor on all three axes. Per-axis factors would invent proportions no "
                    "measurement in this repository supports: the source is one man's thorax and "
                    "there is no second body here to say how a chest that is deeper is also "
                    "wide. The uniform fit clears the ribs, the sternum and the spine with "
                    "positive margin on every heart point, so no per-axis fit was needed or "
                    "considered."
                ),
                "rule": (
                    "Scale uniformly until the bound pack's heart occupies the same fraction of "
                    "the thorax that BodyParts3D's own heart occupies in its own thorax, "
                    "measuring the cardiothoracic ratio exactly as the existing composite "
                    "measures it."
                ),
                "ratio_method": (
                    "Transverse cardiac width is the heart's own extent along body +X. The "
                    "denominator is the pleural span — left lung maximum +X minus right lung "
                    "minimum +X — taken in the z band the heart itself occupies, which is the "
                    "radiographic internal thoracic diameter. Identical to the method "
                    "composite_validation reports."
                ),
                "target_cardiothoracic_ratio": scaling["target_cardiothoracic_ratio"],
                "achieved_cardiothoracic_ratio": scaling["achieved_cardiothoracic_ratio"],
                "transverse_cardiac_width_mm": scaling["transverse_cardiac_width_mm"],
                "internal_thoracic_width_mm": scaling["internal_thoracic_width_mm"],
                "cardiothoracic_ratio_at_native_chest_size": (
                    scaling["at_each_scale"][0]["cardiothoracic_ratio"]
                ),
                "scaled_whole_body_skin_height_mm": scaled_body_height_mm,
                "direction_of_the_fit": (
                    f"The factor is greater than 1: the chest was made LARGER, by "
                    f"{(scale - 1) * 100:.1f} percent. This heart is wider than the one "
                    "BodyParts3D's thorax was built around, which is partly that BodyParts3D's "
                    "own heart is undersized for its body and partly that this pack's right "
                    "atrial and right ventricular lumens are larger than expected. The fitted "
                    "thorax is therefore bigger than the adult source it came from, not smaller."
                ),
                "owner_decision_date": FITTED_OWNER_DECISION_DATE,
                "owner_decision": (
                    "Reuse BodyParts3D 4.0 rather than sourcing a new body; scale the chest to "
                    "fit THIS HEART rather than to an age; keep both contexts, one per pack, "
                    "with adult-reference-chest-bp3d unchanged and still bound to normal-rodero."
                ),
            },
            "rigid_validation": rigid,
            "anatomy_checks": anatomy["checks"],
            "heart_inside_the_rib_cage": containment["structures"],
        },
        "context_assets": context_assets,
        "provenance": {
            "creator": (
                "The Database Center for Life Science (DBCLS), Research Organization of "
                "Information and Systems"
            ),
            "source": (
                "BodyParts3D 4.0, partof_BP3D_4.0_obj_99.zip and partof_element_parts.txt, "
                "LSDB Archive"
            ),
            "source_urls": {
                "description": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/desc.html",
                "download": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html",
                "license": "https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html",
                "paper": "https://academic.oup.com/nar/article/37/suppl_1/D782/1000752",
                "source_cautions": "https://lifesciencedb.jp/bp3d/info_en/index.html",
            },
            "source_sha256": verified,
            "copyright": "Copyright (c) 2008 Life Science Integrated Database Center",
            "license": "CC-BY-SA-2.1-JP",
            "license_url": "https://creativecommons.org/licenses/by-sa/2.1/jp/",
            "license_state": "confirmed",
            "attribution": (
                "BodyParts3D, Copyright (c) 2008 Life Science Integrated Database Center "
                "licensed under CC Attribution-Share Alike 2.1 Japan"
            ),
            "modified": (
                f"YES. The thoracic geometry in chest.gltf is the BodyParts3D source scaled "
                f"uniformly by {scale} about the body-frame origin, then selected by concept, "
                "merged per display group, cropped (skin only) and decimated to a triangle "
                "budget. No per-axis scaling, no reshaping, no invented surface, and no cap on "
                "the skin crop."
            ),
            "derivation": [
                "partof_BP3D_4.0_obj_99.zip and partof_element_parts.txt, verified by SHA-256",
                "pipeline/body_context.py build_fitted(): measure the body axes, measure the "
                "native pair's cardiothoracic ratio, solve one uniform scale by bisection, "
                "build the chest from the scaled source, then fit the pack rigidly into it",
                f"public/packs/{FITTED_BOUND_PACK_ID}/pack.json and its shipped glTF",
            ],
            "share_alike_consequence": (
                "The scaled mesh is a DERIVATIVE of a share-alike source and ships under the "
                "same licence. Anything further derived from chest.gltf or chest.bin carries "
                "the same obligation."
            ),
            "license_history_caveat": (
                "The licensing history for this source is NOT consistent, and this context and "
                "adult-reference-chest-bp3d record different readings of it on purpose. The "
                "rights holder's current licence page states CC Attribution 4.0 International "
                "and is what adult-reference-chest-bp3d records; older project pages for the "
                "same data state CC BY-SA 2.1 Japan, which is what the owner directed for this "
                "derivative on "
                f"{FITTED_OWNER_DECISION_DATE} and what is recorded here. Share-alike is the "
                "more restrictive of the two, so honouring it satisfies either reading. The "
                "disagreement is recorded rather than resolved; resolving it is an owner "
                "decision about both contexts, not a pipeline change."
            ),
            "what_this_is": (
                "AN ADULT MALE BodyParts3D THORAX, SCALED UNIFORMLY TO MATCH THIS HEART'S "
                "CARDIOTHORACIC RATIO. It is not a scan or a model of an adolescent, and no "
                "age is claimed for it anywhere. The bound pack is a 14-year-old's heart; this "
                "chest around it is an adult male's, resized."
            ),
            "age_correctness_caveat": (
                "RIB OBLIQUITY, INTERCOSTAL SPACING AND COSTAL CARTILAGE ARE THE ADULT SOURCE'S "
                "AND ARE NOT AGE-CORRECT. A uniform scale changes every distance by one factor "
                "and changes no angle and no proportion at all, so the ribs still run at adult "
                "angles and the spaces between them are adult spaces, merely larger. A PROBE "
                "WINDOW INDEXED TO AN INTERCOSTAL SPACE ON THIS CHEST IS APPROXIMATE. Authoring "
                "or migrating echo view angles against it is deferred and depends on this "
                "context being signed off first."
            ),
            "fit_inherits_the_pack_s_own_defect": (
                "The scale factor was solved against this heart's transverse width, and this "
                "pack's right ventricular lumen is 148.3 mL against an expected 60-100 mL and "
                "is recorded as unresolved. A heart that is wider than it should be demands a "
                "wider thorax to reach the same ratio, so the factor carries that error. If the "
                "right ventricular lumen is resolved, this context has to be rebuilt."
            ),
            "subject": (
                "A living adult male. BodyParts3D describes itself as a three-dimensional "
                "whole-body model for an adult human male, and the underlying whole-body "
                "reference is an MRI volunteer (the NICT/TARO adult male reference), NOT a "
                "cadaver and NOT a post-mortem specimen. Whole-body skin height measured from "
                "the source is 1719 mm; uniformly scaled by this context's factor that becomes "
                f"{scaled_body_height_mm} mm, which is a CONSEQUENCE of fitting a chest to one "
                "heart and is not an anthropometric claim about anybody."
            ),
            "source_cautions": (
                "The publisher's own notice states there could be many errors for use as "
                "anatomical education, and that some parts were made from scratch by artists "
                "or distorted to fit into the environment. It also warns that OBJ sets are "
                "versioned per organ and that sets differing in the one's place of their "
                "version number do not necessarily share body coordinates."
            ),
            "not_published": (
                "DEVELOPMENT ONLY. The bound pack derives from a CC BY-NC 4.0 source and its "
                "license_state is non_commercial, so neither the pack nor this context reaches "
                "the deployed site. Enforced at build time and asserted by "
                "npm run check:published-packs."
            ),
            "not_a_patient": (
                "One adult male reference thorax, uniformly resized, around one 14-year-old's "
                "observer-labelled heart. A teaching composite: not a patient, not a matched "
                "pair, not an age-appropriate body, and not clinical ground truth."
            ),
        },
    }

    evidence = {
        "context_id": FITTED_CONTEXT_ID,
        "body_axis_measurement": axes.evidence,
        "bodyparts_to_body_rotation_row_major": to_body.reshape(-1).tolist(),
        "chest_scaling": scaling,
        "landmarks_body_mm": {
            "chambers": {k: (v * scale).tolist() for k, v in body_landmarks["chambers"].items()},
            "base": (body_landmarks["base"] * scale).tolist(),
            "apex": (body_landmarks["apex"] * scale).tolist(),
        },
        "landmarks_pack_model_mm": {
            "chambers": {k: v.tolist() for k, v in pack_landmarks["chambers"].items()},
            "base": pack_landmarks["base"].tolist(),
            "apex": pack_landmarks["apex"].tolist(),
        },
        "published_seed_centroids_against_lumen_centroids":
            seed_centroid_comparison(pack, pack_landmarks),
        "fit": {k: v for k, v in report.items() if k not in ("rotation", "translation")},
        "chest": chest_report,
        "rigid_validation": rigid,
        "anatomy": anatomy,
        "composite_validation": composite_validation(
            cache, by_concept, heart_body, to_body_scaled
        ),
    }
    return descriptor, evidence


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--check", action="store_true",
                        help="derive and compare against what is committed, writing nothing")
    parser.add_argument(
        "--context", choices=("all", CONTEXT_ID, FITTED_CONTEXT_ID), default="all",
        help="which context to derive; the default is every context in this repository",
    )
    args = parser.parse_args()

    #: Every context this module owns: how to derive it, and where it lands.
    contexts = [
        (CONTEXT_ID, build, CONTEXT_DIR, EVIDENCE_DIR),
        (FITTED_CONTEXT_ID, build_fitted, FITTED_CONTEXT_DIR, FITTED_EVIDENCE_DIR),
    ]
    selected = [c for c in contexts if args.context in ("all", c[0])]

    problems: list[str] = []
    for context_id, derive, context_dir, evidence_dir in selected:
        descriptor, evidence = derive(args.cache)

        context_path = context_dir / "context.json"
        evidence_path = evidence_dir / "registration-report.json"
        rendered = json.dumps(descriptor, indent=2, sort_keys=False) + "\n"
        rendered_evidence = json.dumps(evidence, indent=2, sort_keys=False) + "\n"

        if args.check:
            for path, text in ((context_path, rendered), (evidence_path, rendered_evidence)):
                if not path.exists():
                    problems.append(f"{path.relative_to(REPO)}: missing")
                elif path.read_text() != text:
                    problems.append(f"{path.relative_to(REPO)}: differs from a fresh derivation")
            continue

        context_dir.mkdir(parents=True, exist_ok=True)
        evidence_dir.mkdir(parents=True, exist_ok=True)
        context_path.write_text(rendered)
        evidence_path.write_text(rendered_evidence)

        fit = descriptor["registration"]
        print(f"body context written to {context_path.relative_to(REPO)}")
        print(f"  scheme      {fit['scheme']}")
        print(f"  RMS         {fit['rms_residual_mm']:.3f} mm")
        print(f"  max         {fit['max_residual_mm']:.3f} mm")
        print(f"  long axis   {fit['long_axis_disagreement_deg']:.3f} deg")
        print(f"  determinant {fit['rigid_validation']['determinant']:.12f}")
        scaling = fit.get("chest_scaling")
        if scaling is not None:
            print(f"  chest scale {scaling['uniform_scale_factor']} (uniform)")
            print(f"  CTR         {scaling['achieved_cardiothoracic_ratio']:.4f} "
                  f"against a target of {scaling['target_cardiothoracic_ratio']:.4f}")

    if args.check:
        if problems:
            raise SystemExit("\n".join(problems))
        names = ", ".join(c[0] for c in selected)
        print(f"body context: committed files match a fresh derivation ({names})")


if __name__ == "__main__":
    main()
