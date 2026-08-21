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

from bodyparts3d import read_element_map
from meshlib import read_gltf_surfaces, read_obj

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

#: Thoracic context groups. Read here so the selection is one declaration for
#: both the registration report and the later asset build.
CHEST_CONCEPTS = {
    "skin": ("FMA7163",),
    "ribs": ("FMA7480",),
    "sternum": ("FMA7485",),
    "spine": ("FMA9140",),
    "lungs": ("FMA7309", "FMA7310"),
    "diaphragm": ("FMA13295",),
}

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


def bodyparts_landmarks(cache: Path, by_concept: dict[str, set[str]]) -> dict:
    """The jig's landmarks, in BodyParts3D source millimetres."""
    valves = {
        name: concept_vertices(cache, by_concept, concept).mean(axis=0)
        for name, concept in VALVE_CONCEPTS.items()
    }
    base = np.mean(list(valves.values()), axis=0)

    cavity = concept_vertices(cache, by_concept, LV_CAVITY_CONCEPT)
    centre = cavity.mean(axis=0)
    _, _, right = np.linalg.svd(cavity - centre, full_matrices=False)
    axis = right[0]
    # Point it apex-ward: away from the valve plane.
    if float((base - centre) @ axis) > 0:
        axis = -axis
    projection = cavity @ axis
    apex = cavity[projection >= np.percentile(projection, APEX_PERCENTILE)].mean(axis=0)

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


def fit_registration(rodero: dict, bodyparts: dict) -> dict:
    """
    Rodero model space -> body frame, and every number needed to judge it.

    Three schemes are computed. One is USED; the other two are recorded so the
    trade-off the chosen one makes is visible in the evidence rather than
    asserted in a comment.
    """
    names = ["mitral", "tricuspid", "aortic", "pulmonary"]
    source_valves = np.array([rodero["valves"][n] for n in names])
    target_valves = np.array([bodyparts["valves"][n] for n in names])

    rodero_length = float(np.linalg.norm(rodero["apex"] - rodero["base"]))
    bodyparts_length = float(np.linalg.norm(bodyparts["apex"] - bodyparts["base"]))
    shared = bodyparts_length

    source_direction = direction_landmark(rodero["base"], rodero["apex"], shared)
    target_direction = direction_landmark(bodyparts["base"], bodyparts["apex"], shared)

    schemes = {
        "valve_centres_and_apex_direction": (
            np.vstack([source_valves, source_direction]),
            np.vstack([target_valves, target_direction]),
            np.ones(5),
            names + ["apex_direction"],
        ),
        "valve_centres_only": (
            source_valves, target_valves, np.ones(4), names,
        ),
        "valve_centres_and_apex_point": (
            np.vstack([source_valves, rodero["apex"]]),
            np.vstack([target_valves, bodyparts["apex"]]),
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

    chosen = "valve_centres_and_apex_direction"
    report = reports[chosen]
    report["scheme"] = chosen
    report["shared_direction_length_mm"] = shared
    report["rodero_base_to_apex_mm"] = rodero_length
    report["bodyparts_base_to_apex_mm"] = bodyparts_length
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
# output                                                                       #
# --------------------------------------------------------------------------- #


def build(cache: Path = CACHE) -> tuple[dict, dict]:
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

    gltf_agreement = check_against_gltf(pack_dir, rodero)
    report = fit_registration(rodero, bodyparts)
    rotation, translation = report["rotation"], report["translation"]
    rigid = validate_rigid(rotation, translation)
    anatomy = anatomy_checks(rotation, translation, rodero, pack_dir)

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
        "context_assets": [],
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
        "rigid_validation": rigid,
        "anatomy": anatomy,
    }
    return descriptor, evidence


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--check", action="store_true",
                        help="derive and compare against what is committed, writing nothing")
    args = parser.parse_args()

    descriptor, evidence = build(args.cache)

    context_path = CONTEXT_DIR / "context.json"
    evidence_path = EVIDENCE_DIR / "registration-report.json"
    rendered = json.dumps(descriptor, indent=2, sort_keys=False) + "\n"
    rendered_evidence = json.dumps(evidence, indent=2, sort_keys=False) + "\n"

    if args.check:
        problems = []
        for path, text in ((context_path, rendered), (evidence_path, rendered_evidence)):
            if not path.exists():
                problems.append(f"{path.relative_to(REPO)}: missing")
            elif path.read_text() != text:
                problems.append(f"{path.relative_to(REPO)}: differs from a fresh derivation")
        if problems:
            raise SystemExit("\n".join(problems))
        print("body context: committed files match a fresh derivation")
        return

    CONTEXT_DIR.mkdir(parents=True, exist_ok=True)
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    context_path.write_text(rendered)
    evidence_path.write_text(rendered_evidence)

    fit = descriptor["registration"]
    print(f"body context written to {context_path.relative_to(REPO)}")
    print(f"  scheme      {fit['scheme']}")
    print(f"  RMS         {fit['rms_residual_mm']:.3f} mm")
    print(f"  max         {fit['max_residual_mm']:.3f} mm")
    print(f"  long axis   {fit['long_axis_disagreement_deg']:.3f} deg")
    print(f"  determinant {fit['rigid_validation']['determinant']:.12f}")


if __name__ == "__main__":
    main()
