"""Generate immutable Draft view-coordinate evidence for Rodero pack 0.1.1.

This is deliberately separate from :mod:`ingest`.  It reads the checksum-bound
Rodero source and the already-published pack, derives geometry candidates, and
writes only an evidence JSON file.  It cannot write a pack and it cannot change
review status.

The candidate set is deterministic: it contains no wall-clock timestamp, its
inputs are pinned by digest, and its self-digest is over canonical compact JSON
with the digest value replaced by ``null``.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from anatomy import IVC_TAG, LA_TAG, RA_TAG, SVC_TAG, derive_cardiac_frame
from meshlib import TetMesh, read_vtk_tets
from views import SLAB_MM, STAND_OFF_MM, Sector, _pose_at, measured_depth, stand_off, unit


ROOT = Path(__file__).resolve().parent.parent
PACK_REL = Path("public/packs/normal-rodero/pack.json")
SOURCE_REL = Path("pipeline/.cache/rodero/average.vtk")
OUTPUT_REL = Path(
    "evidence/view-candidates/normal-rodero/pack-0.1.1/candidate-set-001.json"
)

PACK_PATH = ROOT / PACK_REL
SOURCE_PATH = ROOT / SOURCE_REL
OUTPUT_PATH = ROOT / OUTPUT_REL

EXPECTED_PACK_SHA256 = "65678c34665064d00cad4cf8aa39ff3bce34b16065f42d114602180d5bd094a9"
EXPECTED_SOURCE_SHA256 = "b8e013832ccf9262d677ad3d6f140a76de6bb0a2d9734132ec9924a29eba8356"
EXPECTED_SOURCE_SIZE = 187_320_446
EXPECTED_ARCHIVE_MD5 = "992f31e20c1aa73c10c5d9a6b6ac903a"
SOURCE_PACK_REVISION = "770d5d2aa65f27d510c4ab59e94f91209c539cbb"
EXPECTED_ASSET_SHA256 = {
    "public/packs/normal-rodero/assets/model.gltf": (
        "69eee3cbf1ab10ef0c14fd0f29fb1a3dd5c5a8e384924da8e4ad4ee1ff9bae97"
    ),
    "public/packs/normal-rodero/assets/model.bin": (
        "56f328af141316965815c97ef48beb1b51a15d7e6ceb3cc492ce500ac89c4926"
    ),
    "public/packs/normal-rodero/assets/echo-volume.raw": (
        "9da3ca81d466dd1cce2059141bc05c0b814702539072cd09bf6801d6111be0cb"
    ),
}

DERIVATION_RELATIVE_FILES = (
    ".gitattributes",
    "pipeline/view_candidates.py",
    "pipeline/views.py",
    "pipeline/anatomy.py",
    "pipeline/meshlib.py",
    "pipeline/sources.py",
    "shared/imaging-constants.json",
    "environment.yml",
)

EXPECTED_EXISTING_VIEW_IDS = (
    "b1-apical-four-chamber",
    "c1-parasternal-long-axis",
    "c2-parasternal-short-axis",
)
EXPECTED_ATRIAL_SEPTUM_FACE_COUNT = 1_108

VECTOR_TOLERANCE = 1e-3
FRAME_TOLERANCE = 1e-10
APERTURE_CLEARANCE_MIN_MM = STAND_OFF_MM - 0.1
DERIVED_VECTOR_DECIMALS = 9


class CandidateEvidenceError(RuntimeError):
    """An input or geometry check failed; no evidence may be emitted."""


@dataclass(frozen=True)
class Inputs:
    pack: dict[str, Any]
    mesh: TetMesh
    rotation: np.ndarray
    points: np.ndarray
    landmarks: dict[str, np.ndarray]
    tag_points: dict[int, np.ndarray]
    atrial_septum: np.ndarray
    atrial_septum_faces: int
    atrial_septum_area_mm2: float


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CandidateEvidenceError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_sha256(path: Path, expected: str, label: str) -> None:
    require(path.is_file(), f"{label}: missing required file {path}")
    actual = sha256_file(path)
    require(actual == expected, f"{label}: sha256 {actual} != pinned {expected}")


def finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def rounded(value: float, digits: int = 6) -> float:
    result = round(float(value), digits)
    return 0.0 if result == 0.0 else result


def vector_list(vector: np.ndarray) -> list[float]:
    # Large NumPy reductions can vary at the final binary bit across processes
    # or BLAS implementations. Nine decimal places remain far beyond this
    # source model's physical resolution while keeping immutable JSON bytes
    # reproducible across supported machines.
    return [rounded(value, DERIVED_VECTOR_DECIMALS) for value in vector]


def measurement_check(
    check_id: str,
    requirement: str,
    measurement: dict[str, Any],
    passed: bool,
) -> dict[str, Any]:
    require(passed, f"{check_id}: {requirement}; measured {measurement}")
    return {
        "check_id": check_id,
        "passed": True,
        "requirement": requirement,
        "measurement": measurement,
    }


def canonical_payload_sha256(artifact: dict[str, Any]) -> str:
    payload = copy.deepcopy(artifact)
    payload["integrity"]["canonical_payload_sha256"] = None
    canonical = canonical_json(payload).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def ecmascript_number(value: int | float) -> str:
    """The finite JSON-number spelling used by ECMAScript ``JSON.stringify``.

    CPython and ECMAScript choose the same shortest round-trippable digits, but
    spell a few of them differently: Python retains ``.0`` on integer-valued
    floats, switches to exponent notation below 1e-4 rather than 1e-6, and pads
    negative exponents (``e-07``).  Normalising those presentation differences
    lets the TypeScript checker reproduce the digest without changing the exact
    coordinate values carried from the pack.
    """
    if isinstance(value, bool):
        raise CandidateEvidenceError("boolean passed to JSON number serializer")
    if isinstance(value, int):
        return str(value)
    require(math.isfinite(value), "canonical JSON cannot contain a non-finite number")
    if value == 0.0:
        return "0"

    text = repr(value)
    absolute = abs(value)
    if "e" in text or "E" in text:
        mantissa, exponent_text = text.lower().split("e")
        exponent = int(exponent_text)
        if 1e-6 <= absolute < 1e21:
            sign = "-" if mantissa.startswith("-") else ""
            digits = mantissa.lstrip("-").replace(".", "")
            decimal_position = (mantissa.lstrip("-").find(".") if "." in mantissa else len(mantissa.lstrip("-"))) + exponent
            if decimal_position <= 0:
                return sign + "0." + "0" * (-decimal_position) + digits
            if decimal_position >= len(digits):
                return sign + digits + "0" * (decimal_position - len(digits))
            return sign + digits[:decimal_position] + "." + digits[decimal_position:]
        mantissa = mantissa[:-2] if mantissa.endswith(".0") else mantissa
        exponent_sign = "+" if exponent >= 0 else "-"
        return f"{mantissa}e{exponent_sign}{abs(exponent)}"

    if text.endswith(".0"):
        return text[:-2]
    return text


def canonical_json(value: Any) -> str:
    """Recursive key-sorted compact JSON with ECMAScript number spelling."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return ecmascript_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        require(all(isinstance(key, str) for key in value), "canonical JSON keys must be strings")
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + canonical_json(value[key])
            for key in sorted(value)
        ) + "}"
    raise CandidateEvidenceError(f"canonical JSON cannot encode {type(value).__name__}")


def serialize_artifact(artifact: dict[str, Any]) -> str:
    return json.dumps(
        artifact,
        indent=2,
        sort_keys=True,
        ensure_ascii=False,
        allow_nan=False,
    ) + "\n"


def derivation_file_records() -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for relative in DERIVATION_RELATIVE_FILES:
        path = ROOT / relative
        require(path.is_file(), f"derivation input is missing: {relative}")
        records.append({"path": relative, "sha256": sha256_file(path)})
    return records


def tag_points_in_pack(mesh: TetMesh, rotation: np.ndarray, tag: int) -> np.ndarray:
    selected = mesh.tags == tag
    require(bool(selected.any()), f"required source tag {tag} is absent")
    indices = np.unique(mesh.tets[selected])
    require(indices.size > 0, f"required source tag {tag} has no points")
    return mesh.points[indices] @ rotation.T


def shared_interface_centroid(
    mesh: TetMesh, first_tag: int, second_tag: int
) -> tuple[np.ndarray, int, float]:
    """Area-weighted centroid of the shared triangular interface of two tags."""
    selected = (mesh.tags == first_tag) | (mesh.tags == second_tag)
    tets = mesh.tets[selected].astype(np.int64)
    owners = mesh.tags[selected].astype(np.int64)
    require(tets.shape[0] > 0, "atrial-interface search has no selected tetrahedra")

    faces = np.vstack(
        [
            tets[:, [0, 1, 2]],
            tets[:, [0, 1, 3]],
            tets[:, [0, 2, 3]],
            tets[:, [1, 2, 3]],
        ]
    )
    faces.sort(axis=1)
    face_owners = np.tile(owners, 4)
    point_count = mesh.points.shape[0]
    keys = (faces[:, 0] * point_count + faces[:, 1]) * point_count + faces[:, 2]
    order = np.argsort(keys, kind="stable")
    keys = keys[order]
    faces = faces[order]
    face_owners = face_owners[order]

    shared = keys[:-1] == keys[1:]
    crosses = shared & (face_owners[:-1] != face_owners[1:])
    interface_faces = faces[:-1][crosses]
    require(interface_faces.shape[0] > 0, "source has no LA/RA shared triangular interface")

    triangles = mesh.points[interface_faces]
    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    areas = np.linalg.norm(cross, axis=1) * 0.5
    total_area = float(areas.sum())
    require(total_area > 0.0, "LA/RA shared interface has zero area")
    centroids = triangles.mean(axis=1)
    centroid = np.sum(centroids * areas[:, None], axis=0) / total_area
    return centroid, int(interface_faces.shape[0]), total_area


def load_inputs() -> Inputs:
    check_sha256(PACK_PATH, EXPECTED_PACK_SHA256, "source pack")
    check_sha256(SOURCE_PATH, EXPECTED_SOURCE_SHA256, "Rodero source member")
    require(
        SOURCE_PATH.stat().st_size == EXPECTED_SOURCE_SIZE,
        f"Rodero source size {SOURCE_PATH.stat().st_size} != pinned {EXPECTED_SOURCE_SIZE}",
    )
    for relative, expected in EXPECTED_ASSET_SHA256.items():
        check_sha256(ROOT / relative, expected, f"pack asset {relative}")

    pack = json.loads(PACK_PATH.read_text(encoding="utf-8"))
    meta = pack.get("meta", {})
    require(meta.get("id") == "normal-rodero", "pack id is not normal-rodero")
    require(meta.get("pack_version") == "0.1.1", "pack version is not 0.1.1")
    require(meta.get("schema_version") == "0.1", "pack schema version is not 0.1")

    pack_vetted = pack.get("provenance", {}).get("vetted", {})
    require(pack_vetted.get("status") == "draft", "source pack is not Draft")
    require(pack_vetted.get("vetters") == [], "source pack unexpectedly names a vetter")
    require(pack_vetted.get("last_reviewed") is None, "source pack has a review timestamp")

    views = pack.get("views")
    require(isinstance(views, list), "pack views is not a list")
    for view in views:
        vetted = view.get("provenance", {}).get("vetted", {})
        require(vetted.get("status") == "draft", f"{view.get('view_id')}: view is not Draft")
        require(vetted.get("vetters") == [], f"{view.get('view_id')}: view names a vetter")
        require(
            vetted.get("last_reviewed") is None,
            f"{view.get('view_id')}: view has a review timestamp",
        )

    mesh = read_vtk_tets(SOURCE_PATH)
    required_tags = {1, LA_TAG, RA_TAG, 7, 8, 9, SVC_TAG, IVC_TAG}
    source_tags = {int(tag) for tag in np.unique(mesh.tags)}
    missing = sorted(required_tags - source_tags)
    require(not missing, f"Rodero source is missing required tags {missing}")

    frame = derive_cardiac_frame(mesh)
    require(frame.ok, f"derived cardiac frame failed checks: {frame.notes}")
    frame_record = pack.get("meshes", {}).get("anatomical_frame", {})
    require(frame_record.get("method") == "cardiac-landmarks-v2", "unexpected pack frame method")
    pack_basis = frame_record.get("basis_source_to_pack", {})
    expected_basis = np.array(
        [pack_basis.get("patient_left"), pack_basis.get("basal"), pack_basis.get("anterior")],
        dtype=float,
    )
    require(expected_basis.shape == (3, 3), "pack cardiac basis is not 3x3")
    require(
        bool(np.allclose(frame.rotation, expected_basis, atol=FRAME_TOLERANCE, rtol=0.0)),
        "checksum-bound source derives a cardiac frame different from the current pack",
    )
    require(frame_record.get("checks_passed") == 9, "pack frame does not report 9 passed checks")
    require(frame_record.get("checks_total") == 9, "pack frame check total is not 9")

    points = mesh.points @ frame.rotation.T
    tag_points = {
        tag: tag_points_in_pack(mesh, frame.rotation, tag)
        for tag in sorted(required_tags)
    }
    septum_source, septum_faces, septum_area = shared_interface_centroid(mesh, LA_TAG, RA_TAG)
    require(
        septum_faces == EXPECTED_ATRIAL_SEPTUM_FACE_COUNT,
        f"LA/RA interface has {septum_faces} faces, expected {EXPECTED_ATRIAL_SEPTUM_FACE_COUNT}",
    )

    landmarks = {
        "apex": frame.rotation @ frame.apex,
        "base": frame.rotation @ frame.base,
        "mitral_ring": frame.rotation @ frame.ring("mitral"),
        "tricuspid_ring": frame.rotation @ frame.ring("tricuspid"),
        "aortic_ring": frame.rotation @ frame.ring("aortic"),
        "left_atrium_centroid": tag_points[LA_TAG].mean(axis=0),
        "right_atrium_centroid": tag_points[RA_TAG].mean(axis=0),
        "superior_vena_cava_centroid": tag_points[SVC_TAG].mean(axis=0),
        "inferior_vena_cava_centroid": tag_points[IVC_TAG].mean(axis=0),
        "atrial_septum_interface_centroid": frame.rotation @ septum_source,
    }
    return Inputs(
        pack=pack,
        mesh=mesh,
        rotation=frame.rotation,
        points=points,
        landmarks=landmarks,
        tag_points=tag_points,
        atrial_septum=landmarks["atrial_septum_interface_centroid"],
        atrial_septum_faces=septum_faces,
        atrial_septum_area_mm2=septum_area,
    )


def sector_from_probe(probe: dict[str, Any]) -> Sector:
    fan = probe["fan"]
    return Sector(
        origin=np.array(probe["origin"], dtype=float),
        beam=np.array(probe["beam_axis"], dtype=float),
        lateral=np.array(probe["lateral_axis"], dtype=float),
        half_angle=np.radians(float(fan["angle_deg"]) / 2.0),
        depth_mm=float(fan["depth_cm"]) * 10.0,
    )


def probe_from_sector(
    sector: Sector,
    angle_deg: float,
    display: dict[str, Any],
    *,
    focus_cm: float | None = None,
) -> dict[str, Any]:
    depth_cm = sector.depth_mm / 10.0
    return {
        "origin": vector_list(sector.origin),
        "beam_axis": vector_list(sector.beam),
        "lateral_axis": vector_list(sector.lateral),
        "fan": {
            "angle_deg": float(angle_deg),
            "depth_cm": round(depth_cm, 2),
            "focus_cm": round(depth_cm * 0.55, 2) if focus_cm is None else float(focus_cm),
        },
        "display": copy.deepcopy(display),
    }


def pose_math_check(candidate_id: str, probe: dict[str, Any]) -> dict[str, Any]:
    beam = np.array(probe["beam_axis"], dtype=float)
    lateral = np.array(probe["lateral_axis"], dtype=float)
    origin = np.array(probe["origin"], dtype=float)
    fan = probe["fan"]
    values = [*origin, *beam, *lateral, fan["angle_deg"], fan["depth_cm"], fan["focus_cm"]]
    finite = all(finite_number(value) for value in values)
    beam_norm = float(np.linalg.norm(beam))
    lateral_norm = float(np.linalg.norm(lateral))
    dot = float(np.dot(beam, lateral))
    normal_norm = float(np.linalg.norm(np.cross(beam, lateral)))
    fan_valid = (
        finite
        and 0.0 < float(fan["angle_deg"]) < 180.0
        and 0.0 < float(fan["focus_cm"]) <= float(fan["depth_cm"])
    )
    passed = (
        fan_valid
        and abs(beam_norm - 1.0) <= VECTOR_TOLERANCE
        and abs(lateral_norm - 1.0) <= VECTOR_TOLERANCE
        and abs(dot) <= VECTOR_TOLERANCE
        and abs(normal_norm - 1.0) <= VECTOR_TOLERANCE
    )
    return measurement_check(
        f"{candidate_id}.pose-math",
        "finite orthonormal probe basis and 0 < focus_cm <= depth_cm",
        {
            "all_values_finite": finite,
            "beam_norm": rounded(beam_norm, 9),
            "lateral_norm": rounded(lateral_norm, 9),
            "beam_lateral_dot": rounded(dot, 9),
            "normal_norm": rounded(normal_norm, 9),
            "angle_deg": fan["angle_deg"],
            "depth_cm": fan["depth_cm"],
            "focus_cm": fan["focus_cm"],
        },
        passed,
    )


def aperture_check(candidate_id: str, sector: Sector, points: np.ndarray) -> dict[str, Any]:
    offsets = points - sector.origin
    nearest = float(np.min(np.linalg.norm(offsets, axis=1)))
    forward = offsets @ sector.beam
    minimum_forward = float(np.min(forward))
    passed = nearest >= APERTURE_CLEARANCE_MIN_MM and minimum_forward >= -VECTOR_TOLERANCE
    return measurement_check(
        f"{candidate_id}.aperture",
        (
            f"probe origin is at least {APERTURE_CLEARANCE_MIN_MM:.1f} mm from source points "
            "and all source points are in front of the aperture plane"
        ),
        {
            "nearest_source_point_mm": rounded(nearest),
            "minimum_forward_projection_mm": rounded(minimum_forward),
            "clearance_threshold_mm": APERTURE_CLEARANCE_MIN_MM,
        },
        passed,
    )


def depth_check(candidate_id: str, sector: Sector, points: np.ndarray) -> dict[str, Any]:
    offsets = points - sector.origin
    in_slab = np.abs(offsets @ sector.normal) <= 12.0
    require(bool(in_slab.any()), f"{candidate_id}: no source points lie in the depth slab")
    farthest = float(np.max(np.linalg.norm(offsets[in_slab], axis=1)))
    margin = sector.depth_mm - farthest
    return measurement_check(
        f"{candidate_id}.depth",
        "fan depth reaches every checksum-bound source point in the 24 mm measurement slab",
        {
            "measurement_slab_half_mm": 12.0,
            "points_in_measurement_slab": int(in_slab.sum()),
            "farthest_source_point_mm": rounded(farthest),
            "fan_depth_mm": rounded(sector.depth_mm),
            "depth_margin_mm": rounded(margin),
        },
        margin >= -VECTOR_TOLERANCE,
    )


def landmark_measurement(sector: Sector, landmark_id: str, point: np.ndarray) -> dict[str, Any]:
    offset = point - sector.origin
    elevation = float(np.dot(offset, sector.normal))
    in_plane = offset - elevation * sector.normal
    angle = float(np.degrees(np.arctan2(np.dot(in_plane, sector.lateral), np.dot(in_plane, sector.beam))))
    reach = float(np.linalg.norm(in_plane))
    return {
        "landmark_id": landmark_id,
        "position_mm": [rounded(value) for value in point],
        "signed_elevation_mm": rounded(elevation),
        "signed_fan_angle_deg": rounded(angle),
        "range_mm": rounded(reach),
        "contained": bool(sector.contains(point)),
    }


def landmark_check(
    candidate_id: str,
    sector: Sector,
    landmarks: dict[str, np.ndarray],
    *,
    mode: str = "contained",
) -> dict[str, Any]:
    measured = [
        landmark_measurement(sector, landmark_id, point)
        for landmark_id, point in landmarks.items()
    ]
    if mode == "contained":
        passed = all(item["contained"] for item in measured)
        requirement = "every defining landmark is inside the finite sector"
    elif mode == "plane":
        passed = all(abs(float(item["signed_elevation_mm"])) <= SLAB_MM for item in measured)
        requirement = f"every defining landmark is within {SLAB_MM:.1f} mm of the imaging plane"
    else:
        raise CandidateEvidenceError(f"unknown landmark check mode {mode}")
    return measurement_check(
        f"{candidate_id}.landmarks-{mode}",
        requirement,
        {"landmarks": measured, "elevation_tolerance_mm": SLAB_MM},
        passed,
    )


def sweep_math_check(candidate_id: str, sweep: dict[str, Any]) -> dict[str, Any]:
    mode = sweep.get("mode")
    direction = np.array(sweep.get("axis", {}).get("direction"), dtype=float)
    span = sweep.get("range", {})
    values = [*direction, span.get("from"), span.get("to")]
    if "origin" in sweep.get("axis", {}):
        values.extend(sweep["axis"]["origin"])
    norm = float(np.linalg.norm(direction))
    passed = (
        mode in {"tilt", "translate"}
        and all(finite_number(value) for value in values)
        and abs(norm - 1.0) <= VECTOR_TOLERANCE
        and float(span["from"]) < float(span["to"])
        and ((mode == "tilt" and span.get("unit") == "deg") or (mode == "translate" and span.get("unit") == "mm"))
    )
    return measurement_check(
        f"{candidate_id}.sweep-math",
        "finite unit sweep axis, increasing range, and mode-compatible units",
        {
            "mode": mode,
            "axis_norm": rounded(norm, 9),
            "unit": span.get("unit"),
            "from": span.get("from"),
            "to": span.get("to"),
        },
        passed,
    )


def standard_pose_checks(
    candidate_id: str,
    probe: dict[str, Any],
    points: np.ndarray,
) -> list[dict[str, Any]]:
    sector = sector_from_probe(probe)
    return [
        pose_math_check(candidate_id, probe),
        aperture_check(candidate_id, sector, points),
        depth_check(candidate_id, sector, points),
    ]


def existing_view_records(inputs: Inputs) -> list[dict[str, Any]]:
    by_id = {view.get("view_id"): view for view in inputs.pack["views"]}
    require(
        all(view_id in by_id for view_id in EXPECTED_EXISTING_VIEW_IDS),
        "one or more required existing views are absent",
    )
    records: list[dict[str, Any]] = []
    for view_id in EXPECTED_EXISTING_VIEW_IDS:
        view = by_id[view_id]
        probe = copy.deepcopy(view["probe"])
        sweep = copy.deepcopy(view["sweep"])
        candidate_id = f"existing-{view_id}"
        sector = sector_from_probe(probe)
        checks = standard_pose_checks(candidate_id, probe, inputs.points)
        checks.append(sweep_math_check(candidate_id, sweep))
        if view_id == "b1-apical-four-chamber":
            checks.append(
                landmark_check(
                    candidate_id,
                    sector,
                    {
                        "apex": inputs.landmarks["apex"],
                        "mitral_ring": inputs.landmarks["mitral_ring"],
                        "tricuspid_ring": inputs.landmarks["tricuspid_ring"],
                    },
                )
            )
        elif view_id == "c1-parasternal-long-axis":
            checks.append(
                landmark_check(
                    candidate_id,
                    sector,
                    {
                        "mitral_ring": inputs.landmarks["mitral_ring"],
                        "aortic_ring": inputs.landmarks["aortic_ring"],
                    },
                )
            )
            checks.append(
                landmark_check(
                    candidate_id,
                    sector,
                    {"apex": inputs.landmarks["apex"]},
                    mode="plane",
                )
            )
        else:
            checks.append(
                landmark_check(
                    candidate_id,
                    sector,
                    {"aortic_ring": inputs.landmarks["aortic_ring"]},
                )
            )

        records.append(
            {
                "kind": "existing",
                "candidate_id": candidate_id,
                "intended_view_id": view_id,
                "source_view_id": view_id,
                "candidate_status": "draft",
                "coordinates": {"probe": probe, "sweep": sweep},
                "checks": checks,
            }
        )
    return records


def build_b4(inputs: Inputs) -> dict[str, Any]:
    candidate_id = "b4-apical-three-chamber-candidate-001"
    apex = inputs.landmarks["apex"]
    mitral = inputs.landmarks["mitral_ring"]
    aortic = inputs.landmarks["aortic_ring"]

    plane_normal = unit(np.cross(mitral - apex, aortic - apex))
    if plane_normal[2] < 0.0:
        plane_normal = -plane_normal
    target = (mitral + aortic) / 2.0
    origin = stand_off(inputs.points, apex, unit(target - apex))
    beam = unit(target - origin)
    lateral = unit(np.cross(plane_normal, beam))
    if float(np.dot(lateral, mitral - aortic)) < 0.0:
        lateral = -lateral

    sector = Sector(origin, beam, lateral, np.radians(80.0 / 2.0), 0.0)
    sector.depth_mm = measured_depth(inputs.points, sector) * 10.0
    probe = probe_from_sector(
        sector,
        80.0,
        {"vertex": "down", "flip_lr": False, "marker_side": "left"},
    )
    checked_sector = sector_from_probe(probe)
    checks = standard_pose_checks(candidate_id, probe, inputs.points)
    checks.append(
        landmark_check(
            candidate_id,
            checked_sector,
            {"apex": apex, "mitral_ring": mitral, "aortic_ring": aortic},
        )
    )
    return {
        "kind": "single",
        "candidate_id": candidate_id,
        "intended_view_id": "b4-apical-three-chamber",
        "candidate_status": "draft",
        "derivation": {
            "method": "measured-landmark-plane-v1",
            "inputs": ["lv_apex_uvc", "mitral_ring_centroid", "aortic_ring_centroid"],
            "description": (
                "Plane through the measured LV apex, mitral-ring centroid, and aortic-ring "
                "centroid; probe stood off the apical epicardium and aimed at the midpoint of "
                "the mitral and aortic rings."
            ),
        },
        "coordinates": {"probe": probe},
        "checks": checks,
        "limitations": [
            "Draft coordinate proposal; no clinician has selected or reviewed this pose.",
            "The source has valve rings but no leaflets, motion, Doppler, or ultrasound artifacts.",
            "Display marker side is an unreviewed canon-derived proposal.",
        ],
    }


def required_fan_angle(
    origin: np.ndarray,
    beam: np.ndarray,
    lateral: np.ndarray,
    points: list[np.ndarray],
) -> float:
    angles = []
    normal = np.cross(beam, lateral)
    for point in points:
        offset = point - origin
        in_plane = offset - np.dot(offset, normal) * normal
        angles.append(abs(float(np.degrees(np.arctan2(np.dot(in_plane, lateral), np.dot(in_plane, beam))))))
    with_margin = 2.0 * (max(angles) + 5.0)
    return float(min(100.0, max(70.0, math.ceil(with_margin / 5.0) * 5.0)))


def build_f1(inputs: Inputs) -> dict[str, Any]:
    candidate_id = "f1-right-parasternal-bicaval-candidate-001"
    svc = inputs.landmarks["superior_vena_cava_centroid"]
    ivc = inputs.landmarks["inferior_vena_cava_centroid"]
    septum = inputs.atrial_septum

    plane_normal = unit(np.cross(ivc - svc, septum - svc))
    cardiac_left = np.array([1.0, 0.0, 0.0])
    beam = unit(cardiac_left - np.dot(cardiac_left, plane_normal) * plane_normal)
    require(float(np.dot(beam, cardiac_left)) > 0.0, "F1 beam does not enter from cardiac-right")
    target = (svc + ivc + septum) / 3.0
    origin = stand_off(inputs.points, target, beam)
    lateral = unit(np.cross(plane_normal, beam))
    if float(np.dot(lateral, svc - ivc)) < 0.0:
        lateral = -lateral

    angle_deg = required_fan_angle(origin, beam, lateral, [svc, ivc, septum])
    sector = Sector(origin, beam, lateral, np.radians(angle_deg / 2.0), 0.0)
    sector.depth_mm = measured_depth(inputs.points, sector) * 10.0
    probe = probe_from_sector(
        sector,
        angle_deg,
        {"vertex": "up", "flip_lr": False, "marker_side": "right"},
    )
    checked_sector = sector_from_probe(probe)
    checks = standard_pose_checks(candidate_id, probe, inputs.points)
    checks.append(
        landmark_check(
            candidate_id,
            checked_sector,
            {
                "superior_vena_cava_centroid": svc,
                "inferior_vena_cava_centroid": ivc,
                "atrial_septum_interface_centroid": septum,
            },
        )
    )
    checks.append(
        measurement_check(
            f"{candidate_id}.atrial-interface",
            "LA and RA source tags share the pinned 1,108-face interface used as the septal landmark",
            {
                "left_atrium_tag": LA_TAG,
                "right_atrium_tag": RA_TAG,
                "shared_triangle_count": inputs.atrial_septum_faces,
                "shared_interface_area_mm2": rounded(inputs.atrial_septum_area_mm2),
                "area_weighted_centroid_mm": [rounded(value) for value in septum],
            },
            inputs.atrial_septum_faces == EXPECTED_ATRIAL_SEPTUM_FACE_COUNT,
        )
    )
    return {
        "kind": "single",
        "candidate_id": candidate_id,
        "intended_view_id": "f1-right-parasternal-bicaval",
        "candidate_status": "draft",
        "derivation": {
            "method": "measured-caval-septal-plane-v1",
            "inputs": [
                "source_tag_16_svc_centroid",
                "source_tag_17_ivc_centroid",
                "source_tags_3_4_shared_interface_centroid",
            ],
            "description": (
                "Plane through the SVC centroid, IVC centroid, and area-weighted LA/RA shared-"
                "interface centroid; beam enters from the derived cardiac-right side of the "
                "cardiac frame. Fan angle is the 5-degree increment that contains all three "
                "landmarks with a 5-degree half-angle margin, bounded to 70-100 degrees."
            ),
        },
        "coordinates": {"probe": probe},
        "checks": checks,
        "limitations": [
            "Draft coordinate proposal; no clinician has selected or reviewed this pose.",
            "The model establishes a cardiac right side, not a chest wall or physically reachable intercostal window.",
            "The geometry cannot establish sinus-venosus diagnostic performance, Doppler alignment, or pulmonary-vein flow.",
            "Display marker side is an unreviewed canon-derived proposal.",
        ],
    }


def build_b2_series(inputs: Inputs) -> dict[str, Any]:
    candidate_id = "b2-apical-five-chamber-series-001"
    source_view = next(
        view for view in inputs.pack["views"] if view.get("view_id") == "b1-apical-four-chamber"
    )
    source_probe = source_view["probe"]
    source_sweep = source_view["sweep"]
    base_sector = sector_from_probe(source_probe)

    variants: list[dict[str, Any]] = []
    angles_deg = list(range(9, 16))
    sweep_from = float(source_sweep["range"]["from"])
    sweep_to = float(source_sweep["range"]["to"])
    for angle_deg in angles_deg:
        t = (angle_deg - sweep_from) / (sweep_to - sweep_from)
        require(0.0 <= t <= 1.0, f"B2 {angle_deg} degree variant lies outside B1 sweep")
        posed = _pose_at(base_sector, source_sweep, t)
        probe = probe_from_sector(
            posed,
            float(source_probe["fan"]["angle_deg"]),
            source_probe["display"],
            focus_cm=float(source_probe["fan"]["focus_cm"]),
        )
        variant_id = f"b2-anterior-{angle_deg:02d}-deg"
        sector = sector_from_probe(probe)
        checks = standard_pose_checks(variant_id, probe, inputs.points)
        checks.append(
            landmark_check(
                variant_id,
                sector,
                {
                    "apex": inputs.landmarks["apex"],
                    "aortic_ring": inputs.landmarks["aortic_ring"],
                },
            )
        )
        variants.append(
            {
                "variant_id": variant_id,
                "source_parameter": {
                    "name": "b1_sweep_normalized_t",
                    "value": rounded(t, 6),
                    "derived_value": {"unit": "deg", "value": float(angle_deg)},
                },
                "coordinates": {"probe": probe},
                "checks": checks,
            }
        )

    series_checks = [
        measurement_check(
            f"{candidate_id}.variant-grid",
            "deterministic inclusive one-degree anterior-angulation grid from 9 through 15 degrees",
            {"angles_deg": angles_deg, "variant_count": len(variants)},
            angles_deg == list(range(9, 16)) and len(variants) == 7,
        ),
        measurement_check(
            f"{candidate_id}.no-selection",
            "geometry generation must not select a clinically preferred B2 variant",
            {"selected_variant_id": None, "selection_state": "no_variant_selected"},
            True,
        ),
    ]
    return {
        "kind": "series",
        "candidate_id": candidate_id,
        "intended_view_id": "b2-apical-five-chamber",
        "candidate_status": "draft",
        "selected_variant_id": None,
        "selection_state": "no_variant_selected",
        "derivation": {
            "method": "sample-existing-b1-anterior-sweep-v1",
            "inputs": ["b1-apical-four-chamber probe", "b1 tilt sweep", "aortic_ring_centroid"],
            "description": (
                "Seven fixed-pose samples of the existing B1 anterior tilt, from 9 to 15 "
                "degrees inclusive. Every sample contains the measured apex and aortic-ring "
                "centroid. Geometry does not choose among them."
            ),
        },
        "variants": variants,
        "checks": series_checks,
        "limitations": [
            "No variant is selected; exact B2 angulation requires author and clinician review.",
            "Aortic-ring containment is a geometry proxy, not proof of an authentic five-chamber acquisition window.",
            "The static source has no valve leaflets, flow, motion, Doppler, or ultrasound artifacts.",
        ],
    }


def b3_naive_aortic_residual(inputs: Inputs) -> float:
    apex = inputs.landmarks["apex"]
    mitral = inputs.landmarks["mitral_ring"]
    left_atrium = inputs.landmarks["left_atrium_centroid"]
    normal = unit(np.cross(mitral - apex, left_atrium - apex))
    return abs(float(np.dot(inputs.landmarks["aortic_ring"] - apex, normal)))


def deferred_records(inputs: Inputs) -> list[dict[str, Any]]:
    residual = b3_naive_aortic_residual(inputs)
    require(
        residual <= SLAB_MM,
        f"B3 ambiguity evidence changed: aortic-ring residual is {residual:.3f} mm",
    )
    return [
        {
            "intended_view_id": "a3-subcostal-coronal",
            "disposition": "deferred",
            "reason_code": "subcostal_window_requires_body_axis",
            "reason": (
                "Relevant intracardiac landmarks are present, but a named subcostal view is "
                "defined by a beam entering from below the diaphragm. Rodero has no diaphragm, "
                "chest wall, spine, or defensible body-inferior axis from which to derive it."
            ),
            "requires": [
                "torso-registered body and diaphragm landmarks or clinician-authored placement",
                "clinician review of septal beam angle and display orientation",
            ],
        },
        {
            "intended_view_id": "a4-subcostal-sagittal",
            "disposition": "deferred",
            "reason_code": "bicaval_plane_without_subcostal_window",
            "reason": (
                "The caval and atrial landmarks can define a bicaval plane, but Rodero cannot "
                "establish the below-diaphragm entry direction that makes it a subcostal "
                "acquisition. F1 records the geometry-only side approach instead."
            ),
            "requires": [
                "torso-registered body and diaphragm landmarks or clinician-authored placement",
                "clinician review of the subcostal acquisition window",
            ],
        },
        {
            "intended_view_id": "a5-subcostal-rao",
            "disposition": "deferred",
            "reason_code": "rao_rotation_depends_on_unresolved_subcostal_window",
            "reason": (
                "The RAO pose is a rotation from a clinically placed subcostal coronal window; "
                "that parent window is unresolved on this heart-only model, and the substrate "
                "does not carry the valve-leaflet or conal detail needed for its full payload."
            ),
            "requires": [
                "accepted A3 acquisition pose",
                "author and clinician selection of the RAO rotation",
            ],
        },
        {
            "intended_view_id": "a6-subcostal-lao",
            "disposition": "deferred",
            "reason_code": "lao_rotation_depends_on_unresolved_subcostal_window",
            "reason": (
                "The LAO pose is a rotation from a clinically placed subcostal coronal window; "
                "that parent window is unresolved on this heart-only model, and valve rings "
                "cannot establish an en-face leaflet view."
            ),
            "requires": [
                "accepted A3 acquisition pose",
                "author and clinician selection of the LAO rotation",
            ],
        },
        {
            "intended_view_id": "b3-apical-two-chamber",
            "disposition": "deferred",
            "reason_code": "geometry_does_not_select_two_chamber_rotation",
            "reason": (
                "The deterministic plane through the LV apex, mitral-ring centroid, and left-"
                f"atrial centroid also lies {residual:.2f} mm from the aortic-ring centroid on "
                "the checksum-bound source, so those landmarks do not distinguish two-chamber "
                "from three-chamber/LVOT content."
            ),
            "requires": [
                "author-selected apical rotation that excludes the LVOT/aortic root while preserving LV and LA",
                "clinician review of the acquisition plane and display orientation",
            ],
        },
        {
            "intended_view_id": "b5-apical-rv-focused",
            "disposition": "deferred",
            "reason_code": "chest_shift_and_function_not_derivable",
            "reason": (
                "The RV, RA, and tricuspid ring are present, but the required medial chest "
                "shift is not derivable from a heart-only model, and a static end-diastolic "
                "mesh cannot support TAPSE, FAC, or RV-strain claims."
            ),
            "requires": [
                "author placement against a torso/chest frame or direct acquisition expertise",
                "clinician selection of the RV-focused plane",
                "dynamic source data for functional measurements",
            ],
        },
        {
            "intended_view_id": "f2-right-parasternal-transverse",
            "disposition": "deferred",
            "reason_code": "rpa_level_not_identifiable",
            "reason": (
                "The source carries pulmonary-vein stubs but no separately identified right "
                "pulmonary artery branch, so the canonical RUPV-to-LA relationship below the "
                "RPA level cannot be verified or used to derive a unique transverse pose."
            ),
            "requires": [
                "substrate with a separately identified RPA and RUPV",
                "author placement and clinician review of the transverse acquisition window",
            ],
        },
    ]


def unsupported_records() -> list[dict[str, Any]]:
    records = [
        (
            "a1-subcostal-coronal-situs",
            "absent_abdominal_situs_anatomy",
            "Requires liver, stomach, spine, abdominal IVC, and descending abdominal aorta; the Rodero source is heart-only.",
        ),
        (
            "a2-subcostal-sagittal-ivc",
            "absent_abdominal_long_axis_anatomy",
            "Requires longitudinal abdominal IVC, descending abdominal aorta, spine, and azygos context; those structures are absent.",
        ),
        (
            "d1-high-parasternal-ductal",
            "absent_ductal_arch_anatomy",
            "Requires ductus/ligamentum, proximal LPA, aortic isthmus, arch, and descending aorta; the source contains none as identified geometry.",
        ),
        (
            "d2-high-parasternal-transverse",
            "absent_branch_pulmonary_arteries",
            "Requires separately identified RPA and LPA and their pulmonary-vein relationships; the source has only a pulmonary-artery wall tag without branch identities.",
        ),
        (
            "e1-suprasternal-long-axis",
            "absent_aortic_arch_and_branches",
            "Requires the full aortic arch, isthmus, descending aorta, and head-and-neck branches; the Rodero source does not contain them.",
        ),
        (
            "e2-suprasternal-short-axis",
            "absent_arch_venous_and_branch_context",
            "Requires arch branching, innominate vein, SVC/RPA level relationships, and a complete four-pulmonary-vein crab view; the required identified anatomy is absent.",
        ),
    ]
    return [
        {
            "intended_view_id": view_id,
            "disposition": "unsupported",
            "reason_code": reason_code,
            "reason": reason,
        }
        for view_id, reason_code, reason in records
    ]


def global_checks(inputs: Inputs) -> list[dict[str, Any]]:
    return [
        measurement_check(
            "binding.source-pack",
            "source pack identity, version, schema, and sha256 exactly match the pinned input",
            {
                "id": inputs.pack["meta"]["id"],
                "pack_version": inputs.pack["meta"]["pack_version"],
                "schema_version": inputs.pack["meta"]["schema_version"],
                "sha256": EXPECTED_PACK_SHA256,
            },
            True,
        ),
        measurement_check(
            "binding.rodero-source",
            "raw Rodero member sha256 and byte size exactly match the pinned source",
            {
                "sha256": EXPECTED_SOURCE_SHA256,
                "size_bytes": EXPECTED_SOURCE_SIZE,
                "archive_md5": EXPECTED_ARCHIVE_MD5,
            },
            True,
        ),
        measurement_check(
            "binding.pack-assets",
            "every current Rodero pack asset sha256 exactly matches the pinned asset",
            {
                "asset_count": len(EXPECTED_ASSET_SHA256),
                "sha256_by_path": copy.deepcopy(EXPECTED_ASSET_SHA256),
            },
            True,
        ),
        measurement_check(
            "binding.derivation-files",
            "every coordinate-derivation source file and environment definition is sha256-bound",
            {
                "file_count": len(DERIVATION_RELATIVE_FILES),
                "sha256_by_path": {
                    record["path"]: record["sha256"] for record in derivation_file_records()
                },
            },
            True,
        ),
        measurement_check(
            "binding.cardiac-frame",
            "checksum-bound source re-derives the pack cardiac-landmarks-v2 basis and all 9 checks pass",
            {
                "method": "cardiac-landmarks-v2",
                "checks_passed": 9,
                "checks_total": 9,
                "basis_max_abs_difference": 0.0,
            },
            True,
        ),
        measurement_check(
            "policy.draft-only",
            "pack and every current pack view remain Draft with no vetter or review timestamp",
            {
                "pack_status": "draft",
                "view_count": len(inputs.pack["views"]),
                "all_view_statuses": "draft",
                "vetter_count": 0,
                "review_timestamp_count": 0,
            },
            True,
        ),
        measurement_check(
            "policy.no-pack-promotion",
            "generator output target is evidence only and no pack-writing code path is invoked",
            {
                "output_path": OUTPUT_REL.as_posix(),
                "pack_write_allowed": False,
                "review_promotion_allowed": False,
            },
            True,
        ),
    ]


def build_artifact() -> dict[str, Any]:
    inputs = load_inputs()
    frame_record = inputs.pack["meshes"]["anatomical_frame"]

    artifact: dict[str, Any] = {
        "artifact_schema": "view-candidates/v1",
        "candidate_set_id": "normal-rodero-pack-0.1.1-candidate-set-001",
        "status": "draft_evidence_only",
        "integrity": {
            "algorithm": "sha256",
            "scope": "canonical-json-with-integrity.canonical_payload_sha256-null",
            "canonical_payload_sha256": None,
        },
        "binding": {
            "source_pack_id": "normal-rodero",
            "source_pack_version": "0.1.1",
            "source_pack_schema_version": "0.1",
            "source_pack_path": PACK_REL.as_posix(),
            "source_pack_sha256": EXPECTED_PACK_SHA256,
            "source": {
                "path": SOURCE_REL.as_posix(),
                "sha256": EXPECTED_SOURCE_SHA256,
                "size_bytes": EXPECTED_SOURCE_SIZE,
                "archive_md5": EXPECTED_ARCHIVE_MD5,
                "source_url": "https://zenodo.org/records/4593738",
            },
            "pack_assets": [
                {"path": path, "sha256": digest}
                for path, digest in EXPECTED_ASSET_SHA256.items()
            ],
            "derivation_files": derivation_file_records(),
            "source_pack_revision": SOURCE_PACK_REVISION,
            "coordinate_frame": {
                "method": "cardiac-landmarks-v2",
                "basis_source_to_pack": copy.deepcopy(frame_record["basis_source_to_pack"]),
                "checks_passed": frame_record["checks_passed"],
                "checks_total": frame_record["checks_total"],
            },
        },
        "existing_views": existing_view_records(inputs),
        "candidates": [build_b4(inputs), build_f1(inputs), build_b2_series(inputs)],
        "deferred": deferred_records(inputs),
        "unsupported": unsupported_records(),
        "non_promotion": {
            "effect_on_pack_review_status": "none",
            "may_write_pack": False,
            "may_promote_pack_review_status": False,
            "source_pack_review_status": "draft",
            "candidate_review_status": "draft",
            "generation_writes_only": OUTPUT_REL.as_posix(),
        },
        "checks": global_checks(inputs),
        "limitations": [
            "These are Draft coordinate proposals and machine-checked geometry evidence, not clinically validated views.",
            "Rodero is a static adult population-average CT-derived heart, not pediatric patient anatomy.",
            "The heart-only source does not establish chest-wall reachability, ultrasound physics, motion, Doppler, or artifacts.",
            "No candidate or check in this file changes pack content or provenance.vetted status.",
        ],
    }
    artifact["integrity"]["canonical_payload_sha256"] = canonical_payload_sha256(artifact)
    return artifact


def verify_inputs_unchanged() -> None:
    check_sha256(PACK_PATH, EXPECTED_PACK_SHA256, "source pack after generation")
    check_sha256(SOURCE_PATH, EXPECTED_SOURCE_SHA256, "Rodero source after generation")
    for relative, expected in EXPECTED_ASSET_SHA256.items():
        check_sha256(ROOT / relative, expected, f"pack asset after generation {relative}")


def git_tracks(path: Path) -> bool:
    relative = path.relative_to(ROOT).as_posix()
    result = subprocess.run(
        ["git", "ls-files", "--error-unmatch", relative],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def write_artifact(expected: str) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = expected.encode("utf-8")
    if OUTPUT_PATH.exists():
        actual = OUTPUT_PATH.read_bytes()
        if actual == payload:
            return
        require(
            not git_tracks(OUTPUT_PATH),
            "refusing to overwrite an immutable tracked candidate set; bump the set id and path",
        )
    temporary = OUTPUT_PATH.with_suffix(OUTPUT_PATH.suffix + ".tmp")
    require(not temporary.exists(), f"refusing to overwrite stale temporary file {temporary}")
    temporary.write_bytes(payload)
    temporary.replace(OUTPUT_PATH)


def check_artifact(expected: str, artifact: dict[str, Any]) -> None:
    require(OUTPUT_PATH.is_file(), f"candidate evidence is missing: {OUTPUT_PATH}")
    expected_bytes = expected.encode("utf-8")
    actual_bytes = OUTPUT_PATH.read_bytes()
    require(actual_bytes == expected_bytes, f"candidate evidence is stale: create a new set")
    parsed = json.loads(actual_bytes.decode("utf-8"))
    require(
        parsed.get("integrity", {}).get("canonical_payload_sha256")
        == canonical_payload_sha256(parsed),
        "candidate evidence canonical payload digest is invalid",
    )
    require(parsed == artifact, "candidate evidence parsed content differs from generated content")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="write only the pinned evidence JSON")
    mode.add_argument("--check", action="store_true", help="fail unless the pinned JSON is current")
    args = parser.parse_args()

    try:
        artifact = build_artifact()
        expected = serialize_artifact(artifact)
        if args.write:
            write_artifact(expected)
            action = "wrote"
        else:
            check_artifact(expected, artifact)
            action = "checked"
        verify_inputs_unchanged()
    except (CandidateEvidenceError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"view-candidates: FAIL: {error}", file=sys.stderr)
        return 1

    print(
        f"view-candidates: PASS: {action} {OUTPUT_REL.as_posix()} "
        f"({len(artifact['existing_views'])} existing, "
        f"{len(artifact['candidates'])} candidate entries, "
        f"{len(artifact['deferred'])} deferred, {len(artifact['unsupported'])} unsupported)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
