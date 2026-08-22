"""Build the hand-labelled Visible Heart Labs Heart0102 derivative pack.

This recipe is intentionally separate from :mod:`ingest`.  The acquired VHL
substrate is one untagged STL, while this pack is derived from an observer's
384^3 lumen and myocardium labels.  Treating it as an ordinary STL ingest would
erase the authored identities and reproduce the rejected undivided pack.

The source STL and the exact build-input copies live under ``pipeline/.cache``
and are not committed.  The experiment history retains small compressed label
snapshots as evidence, but this recipe consumes only the checksum-pinned cache
inputs so a file with the right name cannot silently produce a different
public-Git derivative.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import shutil
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
from scipy import ndimage

# These are existing project modules, imported rather than copied.  In
# particular, anatomy.py supplies the shared vector normalisation rule and
# view_candidates.py supplies the probe-basis gate.  We deliberately do NOT run
# anatomy.derive_cardiac_frame: Heart0102 has neither valve-ring geometry nor
# cavae, and fabricating those inputs would turn its nine checks into theatre.
from anatomy import _unit as anatomy_unit
from geometry import measure
from ingest import raw_volume_bytes
from meshlib import Surface, _vertex_normals
from sources import PUBLIC_GIT_LICENSE_STATES, VHL
from vhl_seed_partition import derive_frame, load_seeds
from vhl_surface_nets import extract
from view_candidates import pose_math_check


REPO = Path(__file__).resolve().parent.parent
PACK_ID = "normal-vhl-heart0102-chambers"
RESOLUTION = 192
GITHUB_BLOB_LIMIT = 100_000_000

EDUCATIONAL_RESEARCH_DISCLAIMER = (
    "SIMULATED ECHO: the echo volume is generated from observer-authored wall labels, not "
    "acquired patient echocardiography. This CC BY-NC 4.0 pack is for non-commercial "
    "educational and research/development proof-of-concept use only. It is not for "
    "diagnosis, treatment, or clinical decision-making."
)

SOURCE_PATH = Path("pipeline/.cache/vhl/Heart102_Tissue.stl")
LABEL_DIR = Path("pipeline/.cache/vhl/labels")
INPUT_SHA256 = {
    SOURCE_PATH: "5843eb9619ff9644c1ded5dd2911d9bbdfd3e5e43c8d622ff753b83272f41402",
    LABEL_DIR / "grid.npz": "04aac2c04e1adf912e84c6595ad2f49598f1a7db2ee037ad9a070141195a80d3",
    LABEL_DIR / "tissue-clean.npz": "1fba36bbc5b278a009fb52d9e0d4b786cb9a8a63f6f66aa49f342fa8f49b51ab",
    LABEL_DIR / "round6-labels.npz": "d29a1cec28eb5f8b350635c32571f7bdb681ddc9439e59ea239999d4ef4531b2",
    LABEL_DIR / "wall-labels-current.npz": "7414ee196263ed80a93720e37cb4dd49b86346c747ece5f2ac4a9aaf2dd9ea72",
}

EXPECTED_LUMEN_ML = (82.1, 148.3, 37.0, 75.0, 11.6, 20.7)
EXPECTED_WALL_ML = (150.0, 137.3, 24.9, 32.3, 8.8, 10.8)

# The rows carry source coordinates into pack coordinates
# (x = patient-left, y = cardiac basal, z = cardiac anterior).  They are
# re-derived from the committed observer seeds below and compared to these
# recorded values rather than trusted as an unexplained pose.
EXPECTED_ROTATION = np.array([
    [0.7920507442286407, -0.48842602466877577, -0.36619071123270275],
    [0.5139748304843037, 0.20990598219700565, 0.8317267293207197],
    [-0.32937135910016146, -0.8469825836840842, 0.4172948726504385],
], dtype=np.float64)

TAG_DETAILS = {
    1: {
        "short": "LV",
        "lumen_slug": "lv-lumen",
        "lumen_label": "Left ventricular lumen",
        "wall_slug": "lv-myocardium",
        "wall_label": "Left ventricular myocardium",
    },
    2: {
        "short": "RV",
        "lumen_slug": "rv-lumen",
        "lumen_label": "Right ventricular lumen",
        "wall_slug": "rv-myocardium",
        "wall_label": "Right ventricular myocardium",
    },
    3: {
        "short": "LA",
        "lumen_slug": "la-lumen",
        "lumen_label": "Left atrial lumen",
        "wall_slug": "la-myocardium",
        "wall_label": "Left atrial myocardium",
    },
    4: {
        "short": "RA",
        "lumen_slug": "ra-lumen",
        "lumen_label": "Right atrial lumen",
        "wall_slug": "ra-myocardium",
        "wall_label": "Right atrial myocardium",
    },
    5: {
        "short": "Aorta",
        "lumen_slug": "aorta-lumen",
        "lumen_label": "Aortic lumen",
        "wall_slug": "aortic-wall",
        "wall_label": "Aortic wall",
    },
    6: {
        "short": "PA",
        "lumen_slug": "pulmonary-artery-lumen",
        "lumen_label": "Pulmonary artery lumen",
        "wall_slug": "pulmonary-artery-wall",
        "wall_label": "Pulmonary artery wall",
    },
}


def sha256_file(path: Path) -> str:
    """Digest a potentially large input without reading it all at once."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require(condition: bool, message: str) -> None:
    """Fail closed before writing a derivative."""
    if not condition:
        raise SystemExit(message)


def verify_input_files(repo: Path) -> None:
    """Pin every uncommitted input by content, not by filename."""
    for relative, expected in INPUT_SHA256.items():
        path = repo / relative
        require(path.is_file(), f"missing required input: {relative}")
        actual = sha256_file(path)
        require(actual == expected, f"{relative}: sha256 {actual}, expected {expected}")


def boundary_nonzero(labels: np.ndarray) -> int:
    """Number of labelled samples on the six faces of the source grid."""
    return sum(int(np.count_nonzero(face)) for face in (
        labels[0], labels[-1], labels[:, 0], labels[:, -1], labels[:, :, 0], labels[:, :, -1],
    ))


def dominant_nonzero_downsample(labels: np.ndarray) -> np.ndarray:
    """Reduce 384^3 to 192^3 without erasing one-voxel myocardium.

    Every 2^3 block takes its most frequent NONZERO tag.  An all-zero block
    remains blood/background; equal counts deterministically favour the lower
    tag because tags are visited in ascending order and only a strict increase
    replaces the winner.
    """
    require(labels.shape == (RESOLUTION * 2,) * 3, "wall label grid is not 384^3")
    blocks = labels.reshape(RESOLUTION, 2, RESOLUTION, 2, RESOLUTION, 2)
    best_count = np.zeros((RESOLUTION,) * 3, dtype=np.uint8)
    reduced = np.zeros((RESOLUTION,) * 3, dtype=np.uint8)
    for tag in TAG_DETAILS:
        count = np.sum(blocks == tag, axis=(1, 3, 5), dtype=np.uint8)
        better = count > best_count
        reduced[better] = tag
        best_count[better] = count[better]
    return reduced


def cropped_binary(mask: np.ndarray, grid_origin: np.ndarray, pitch: float) -> tuple[np.ndarray, np.ndarray]:
    """Crop an active mask with one existing zero layer and preserve coordinates."""
    active = np.nonzero(mask)
    require(bool(active[0].size), "cannot extract an empty label")
    low = np.array([int(axis.min()) for axis in active], dtype=np.int64)
    high = np.array([int(axis.max()) for axis in active], dtype=np.int64)
    require(bool(np.all(low > 0) and np.all(high < np.array(mask.shape) - 1)),
            "label touches the source-grid boundary; a closing surface would be fabricated")
    start = low - 1
    stop = high + 2
    cropped = mask[
        start[0]:stop[0],
        start[1]:stop[1],
        start[2]:stop[2],
    ]
    require(boundary_nonzero(cropped) == 0, "cropped label has no zero border")
    return cropped, grid_origin + start * pitch


def extract_surface(
    labels: np.ndarray,
    tag: int,
    name: str,
    grid_origin: np.ndarray,
    pitch: float,
    rotation: np.ndarray,
) -> Surface:
    """Extract one exact authored label, with no cross-label geometry changes."""
    cropped, crop_origin = cropped_binary(labels == tag, grid_origin, pitch)
    vertices, faces = extract(
        cropped,
        crop_origin,
        pitch,
        blur_voxels=0.0,
        smooth_iterations=0,
    )
    require(bool(len(vertices) and len(faces)), f"tag {tag} ({name}) produced no surface")
    vertices = np.ascontiguousarray(vertices @ rotation.T, dtype=np.float32)
    faces = np.ascontiguousarray(faces, dtype=np.int32)
    return Surface(name=name, vertices=vertices, faces=faces)


def topology_record(surface: Surface, label_kind: str) -> dict[str, Any]:
    """Measure the exact surface being shipped and declare every limitation."""
    measured = measure(surface)
    record: dict[str, Any] = {
        "watertight": bool(measured["watertight"]),
        "components": int(measured["components"]),
        "boundary_edges": int(measured["boundary_edges"]),
        "nonmanifold_edges": int(measured["nonmanifold_edges"]),
    }
    clean = (
        record["watertight"]
        and record["components"] == 1
        and record["boundary_edges"] == 0
        and record["nonmanifold_edges"] == 0
    )
    if not clean:
        record["declared_reason"] = (
            f"Measured as shipped from the observer-authored 384^3 {label_kind} partition: "
            f"{record['components']} surface component(s), {record['boundary_edges']} boundary "
            f"edge(s), and {record['nonmanifold_edges']} non-manifold edge(s). No component was "
            "merged, no opening was filled, and no geometry was invented to make this clean."
        )
    return record


def write_multibuffer_gltf(path: Path, surfaces: list[Surface]) -> dict[str, int]:
    """Write one glTF with one sub-100-MB external buffer per structure."""
    path.parent.mkdir(parents=True, exist_ok=True)
    buffer_views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []
    buffers: list[dict[str, Any]] = []
    meshes: list[dict[str, Any]] = []
    nodes: list[dict[str, Any]] = []
    sizes: dict[str, int] = {}

    for buffer_index, surface in enumerate(surfaces):
        vertices = np.ascontiguousarray(surface.vertices, dtype=np.float32)
        normals = _vertex_normals(vertices, surface.faces)
        faces = np.ascontiguousarray(surface.faces, dtype=np.uint32)

        blob = bytearray(vertices.tobytes())
        while len(blob) % 4:
            blob.append(0)
        normal_offset = len(blob)
        blob.extend(normals.tobytes())
        while len(blob) % 4:
            blob.append(0)
        index_offset = len(blob)
        blob.extend(faces.tobytes())

        uri = f"model.{surface.name}.bin"
        require(len(blob) < GITHUB_BLOB_LIMIT,
                f"{uri} is {len(blob):,} bytes, over the public-Git blob limit")
        (path.parent / uri).write_bytes(bytes(blob))
        sizes[uri] = len(blob)
        buffers.append({"uri": uri, "byteLength": len(blob)})

        position_view = len(buffer_views)
        buffer_views.append({
            "buffer": buffer_index,
            "byteOffset": 0,
            "byteLength": int(vertices.nbytes),
            "target": 34962,
        })
        normal_view = len(buffer_views)
        buffer_views.append({
            "buffer": buffer_index,
            "byteOffset": normal_offset,
            "byteLength": int(normals.nbytes),
            "target": 34962,
        })
        index_view = len(buffer_views)
        buffer_views.append({
            "buffer": buffer_index,
            "byteOffset": index_offset,
            "byteLength": int(faces.nbytes),
            "target": 34963,
        })

        position_accessor = len(accessors)
        accessors.append({
            "bufferView": position_view,
            "componentType": 5126,
            "count": int(vertices.shape[0]),
            "type": "VEC3",
            "min": vertices.min(axis=0).astype(float).tolist(),
            "max": vertices.max(axis=0).astype(float).tolist(),
        })
        normal_accessor = len(accessors)
        accessors.append({
            "bufferView": normal_view,
            "componentType": 5126,
            "count": int(normals.shape[0]),
            "type": "VEC3",
        })
        index_accessor = len(accessors)
        accessors.append({
            "bufferView": index_view,
            "componentType": 5125,
            "count": int(faces.size),
            "type": "SCALAR",
        })
        meshes.append({
            "name": surface.name,
            "primitives": [{
                "attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor},
                "indices": index_accessor,
                "mode": 4,
            }],
        })
        nodes.append({"name": surface.name, "mesh": len(meshes) - 1})

        del normals, faces, blob
        gc.collect()

    document = {
        "asset": {
            "version": "2.0",
            "generator": "Cardiology app labelled VHL builder (pipeline/vhl_pack.py)",
        },
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": buffers,
    }
    text = json.dumps(document, indent=1, sort_keys=True) + "\n"
    path.write_text(text)
    sizes[path.name] = len(text.encode())
    return sizes


def mesh_to_volume(rotation: np.ndarray, origin: np.ndarray, pitch: float) -> list[float]:
    """Column-major affine from rotated pack millimetres to 192^3 voxels."""
    output_pitch = pitch * 2.0
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = rotation.T / output_pitch
    matrix[:3, 3] = -origin / output_pitch
    return matrix.T.reshape(-1).astype(float).tolist()


def apply_column_major(matrix: list[float], point: np.ndarray) -> np.ndarray:
    """Apply a schema column-major affine; used for a fail-closed self-check."""
    mathematical = np.asarray(matrix, dtype=np.float64).reshape(4, 4).T
    return (mathematical @ np.r_[point, 1.0])[:3]


def seed_frame(repo: Path) -> tuple[np.ndarray, dict[str, Any]]:
    """Re-derive the hand-seeded cardiac frame and its complete evidence record."""
    seed_path = repo / "output/vhl-partition/seeds.observer-A.json"
    seeds = load_seeds(seed_path)
    chamber_seeds = [seed for seed in seeds if 1 <= int(seed["tag"]) <= 6]
    require(len(chamber_seeds) == 27, f"frame seed count is {len(chamber_seeds)}, expected 27")
    frame = derive_frame(chamber_seeds)

    # Use anatomy.py's established vector normaliser, but do not invoke its nine
    # anatomical checks with invented valve rings/cavae.
    rotation = np.vstack([anatomy_unit(row) for row in (
        frame.patient_left, frame.base, frame.anterior,
    )])
    require(np.allclose(rotation, EXPECTED_ROTATION, atol=1e-12),
            "frame re-derived from observer seeds differs from the recorded basis")
    require(np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-12),
            "observer-seeded cardiac basis is not orthonormal")
    require(float(np.linalg.det(rotation)) > 0.0, "observer-seeded cardiac basis is left-handed")

    centres: dict[str, list[float]] = {}
    names = {1: "left_ventricle", 2: "right_ventricle", 3: "left_atrium",
             4: "right_atrium", 5: "aorta"}
    counts: dict[str, int] = {}
    for tag, name in names.items():
        points = np.asarray([
            seed["model_point_mm"] for seed in chamber_seeds if int(seed["tag"]) == tag
        ], dtype=np.float64)
        require(bool(len(points)), f"frame carries no observer seed for {name}")
        centres[name] = points.mean(axis=0).astype(float).tolist()
        counts[name] = int(len(points))

    disagreements = frame.declared_disagreement()
    checks = {name: bool(result[0]) for name, result in frame.checks.items()}
    margins = {name: round(float(result[1]), 1) for name, result in frame.checks.items()}
    require(checks == {
        "LA posterior to RA": True,
        "RA right of LA": False,
        "aorta basal to ventricles": True,
    }, f"observer-seeded frame checks changed: {checks}")

    record = {
        "method": "observer-seed-centroids-v1",
        "description": (
            "CARDIAC basis re-derived by pipeline/vhl_seed_partition.py from 27 chamber marks "
            "placed and named by one observer. Patient-left is the right-ventricle to "
            "left-ventricle seed-centroid direction; basal is the ventricular midpoint to the "
            "atrial midpoint, orthogonalised against it; anterior completes a right-handed "
            "basis. The identities are authored, not source tags, and this was one unreplicated "
            "observer round. This is not a patient/body frame: the heart-only source has no "
            "spine, diaphragm, or chest wall, so no body superior-inferior direction is claimed."
        ),
        "inputs": {
            "source": "output/vhl-partition/seeds.observer-A.json",
            "observer_count": 1,
            "replicated": False,
            "seed_counts": counts,
            "patient_left": "right-ventricular to left-ventricular seed centroid",
            "basal": "ventricular midpoint to atrial midpoint, orthogonalised",
            "anterior": "right-handed cross product of patient-left and basal",
            "not_run": (
                "pipeline/anatomy.py's nine substrate checks: the source has no valve-ring "
                "geometry or separately tagged cavae, and those inputs were not fabricated"
            ),
        },
        "landmarks_source_mm": {"observer_seed_centroids": centres},
        "basis_source_to_pack": {
            "patient_left": rotation[0].astype(float).tolist(),
            "basal": rotation[1].astype(float).tolist(),
            "anterior": rotation[2].astype(float).tolist(),
        },
        "measurements": {
            "raw_left_right_vs_basal_deg": round(float(frame.raw_axis_angle_deg), 2),
            "declared_axis_disagreement_deg": {
                name: round(float(value), 1) for name, value in disagreements.items()
            },
            "check_margins_mm": margins,
        },
        "checks": checks,
        "checks_passed": int(sum(checks.values())),
        "checks_total": len(checks),
    }
    return rotation, record


def source_provenance(note: str, chain: list[str]) -> dict[str, Any]:
    """Draft provenance from the same source registry that governs acquisition."""
    return {
        "creator": VHL.creator,
        "source": VHL.source_text,
        "source_url": VHL.source_url,
        "license": VHL.license,
        "license_url": VHL.license_url,
        "license_state": VHL.license_state,
        "modified": {"flag": True, "note": note},
        "derivation_chain": chain,
        "vetted": {"status": "draft", "vetters": [], "last_reviewed": None},
    }


def reference_view(
    structures: list[dict[str, Any]],
    bounds: tuple[np.ndarray, np.ndarray],
) -> dict[str, Any]:
    """A bounds-derived reference pose that makes no clinical-view claim."""
    low, high = bounds
    centre = (low + high) / 2.0
    radius = float(np.linalg.norm((high - low) / 2.0))
    half_angle = math.radians(75.0 / 2.0)
    standoff = 1.12 * radius / math.sin(half_angle)
    depth_cm = float(math.ceil((standoff + radius) / 10.0))
    origin = centre + np.array([0.0, 0.0, standoff])
    slugs = [structure["id"] for structure in structures]
    probe = {
        "origin": origin.astype(float).tolist(),
        "beam_axis": [0.0, 0.0, -1.0],
        "lateral_axis": [1.0, 0.0, 0.0],
        "fan": {"angle_deg": 75.0, "depth_cm": depth_cm, "focus_cm": round(depth_cm * 0.55, 2)},
        "display": {"vertex": "down", "flip_lr": False, "marker_side": "right"},
    }
    # Call the shared candidate-pose gate.  It raises rather than returning a
    # failing record, so a malformed probe can never reach pack.json.
    pose_math_check(f"{PACK_ID}.ingest-reference-pose", probe)
    require(depth_cm * 10.0 >= standoff + radius,
            "reference view depth does not reach the measured bounding sphere")

    return {
        "family": "INGEST",
        "view_id": "ingest-reference-pose",
        "name": "Ingest reference pose — not a clinical view",
        "aliases": [],
        "placement_landmark": (
            "Derived mechanically from the rotated model bounds; carries no anatomical "
            "landmark, imaging window, or clinical meaning"
        ),
        "indicator_clock": "12:00",
        "probe": probe,
        "sweep": {
            "mode": "tilt",
            "axis": {"direction": [1.0, 0.0, 0.0]},
            "range": {"unit": "deg", "from": -22.0, "to": 22.0},
            "interpolation": "slerp",
            "structures_in_order": [],
        },
        "structures": slugs,
        "measurements": [],
        "lesion_attachments": [],
        "show_hide_preset": {"visible": slugs, "hidden": []},
        "echo_tuning": {},
        "real_clip_slot": None,
        "emphasis": None,
        "provenance": source_provenance(
            note=(
                "Pose generated mechanically from the labelled pack's rotated bounding sphere "
                "by pipeline/vhl_pack.py. It is not a clinical view, not derived from an imaging "
                "protocol, and not vetted. structures_in_order is empty because no clinical "
                "sweep reading was authored. "
                + EDUCATIONAL_RESEARCH_DISCLAIMER
            ),
            chain=["pipeline/vhl_pack.py (bounds-derived non-clinical reference pose)"],
        ),
    }


def structure_record(
    tag: int,
    kind: str,
    topology: dict[str, Any],
) -> dict[str, Any]:
    """One authored lumen or myocardium structure."""
    details = TAG_DETAILS[tag]
    is_lumen = kind == "lumen"
    slug = details["lumen_slug" if is_lumen else "wall_slug"]
    display = details["lumen_label" if is_lumen else "wall_label"]
    evidence = (
        f"One observer authored tag {tag} as {display.lower()} in "
        f"{'round6-labels.npz' if is_lumen else 'wall-labels-current.npz'}. The source STL "
        "contains no chamber tags or named groups; this identity and the decision that the "
        f"structure is {'a lumen cast' if is_lumen else 'tissue rather than a lumen cast'} "
        "come from those marks."
    )
    return {
        "id": slug,
        "mesh_node": slug,
        "display_label": display,
        "parent": None,
        "identified": True,
        "blood_pool": is_lumen,
        "blood_pool_decision": {"basis": "authored", "evidence": evidence},
        "topology": topology,
        # These are direct surfaces of the authored segmentation, not shelled,
        # sculpted, or interface-only replacement anatomy.  Authorship is
        # recorded above and in provenance; it does not make geometry stylized.
        "stylized": False,
    }


def build_pack(
    surfaces: list[Surface],
    topology: dict[str, dict[str, Any]],
    rotation: np.ndarray,
    frame_record: dict[str, Any],
    grid_origin: np.ndarray,
    pitch: float,
) -> dict[str, Any]:
    """Assemble the schema-v0.1 pack document."""
    structures: list[dict[str, Any]] = []
    for kind in ("lumen", "wall"):
        for tag in TAG_DETAILS:
            slug = TAG_DETAILS[tag]["lumen_slug" if kind == "lumen" else "wall_slug"]
            structures.append(structure_record(tag, kind, topology[slug]))

    low = np.min([surface.vertices.min(axis=0) for surface in surfaces], axis=0).astype(np.float64)
    high = np.max([surface.vertices.max(axis=0) for surface in surfaces], axis=0).astype(np.float64)
    transform = mesh_to_volume(rotation, grid_origin, pitch)

    # Independent arithmetic check of the rotated registration, on a point not
    # tied to any mesh centroid or test fixture.
    source_point = np.array([12.5, -7.25, 31.75], dtype=np.float64)
    pack_point = rotation @ source_point
    expected_voxel = (source_point - grid_origin) / (pitch * 2.0)
    require(np.allclose(apply_column_major(transform, pack_point), expected_voxel, atol=1e-10),
            "mesh_to_volume does not invert the source-to-pack rotation")

    modification_note = (
        "HAND-SEEDED DERIVATIVE. Built by pipeline/vhl_pack.py from the CC BY-NC 4.0 source "
        "STL and two 384^3 label fields authored by one observer: 27 chamber seeds, 553 barrier "
        "marks, approximately 11,000 manual corrections, two traced valve rims, 375 groove "
        "strokes, and 1,076 region points. Every one of the twelve structure identities is the "
        "observer's interpretation, not a tag or group in the source. Six lumen and six "
        "per-chamber myocardium surfaces were extracted at the authored grid resolution with "
        "no cross-label blur, smoothing, thin-structure absorption, decimation, hole filling, "
        "or invented geometry. The wall labels were reduced to a 192^3 echo volume by dominant "
        "nonzero tag in each 2^3 block, with lower tag winning exact ties; zero is blood or "
        "outside. ORIENTATION MEASURED, NOT VETTED: the cardiac frame comes from the same one "
        "observer's chamber marks. It is a cardiac basis only; no patient/body frame is claimed. "
        "The source has no valve-ring geometry and no separately tagged cavae, so neither was "
        "invented and pipeline/anatomy.py's nine checks were deliberately not run on fabricated "
        "inputs. CAVEATS: RV lumen is 148.3 mL against an expected 60–100 mL; its 384^3 label "
        "is one face-connected volume, while the extracted boundary topology is reported "
        "separately, and the excess volume is unresolved. RA lumen is 75.0 mL against 25–45 mL and "
        "includes the caval stubs and atrial appendage. LV wall : RV wall is 1.09 : 1, against "
        "about 2.6 : 1 for normal-rodero; three independent measurements agree this model carries "
        "no left-right wall asymmetry, so it must not be used to teach wall thickness. "
        "NOT PUBLISHED: license_state is non_commercial and CC BY-NC 4.0 remains binding. This new "
        "derivative does not alter the 2026-08-19 substrate rejection of normal-vhl-heart0102, "
        "which remains retained evidence. "
        + EDUCATIONAL_RESEARCH_DISCLAIMER
    )
    chain = [
        VHL.source_url,
        f"{SOURCE_PATH} (sha256 {INPUT_SHA256[SOURCE_PATH]})",
        "pipeline/labeller/ and pipeline/vhl_* (one-observer authoring and 384^3 partition)",
        f"{LABEL_DIR / 'round6-labels.npz'} (sha256 {INPUT_SHA256[LABEL_DIR / 'round6-labels.npz']})",
        f"{LABEL_DIR / 'wall-labels-current.npz'} (sha256 {INPUT_SHA256[LABEL_DIR / 'wall-labels-current.npz']})",
        (
            "pipeline/vhl_pack.py (exact label surfaces, measured cardiac rotation, "
            "dominant-nonzero 192^3 wall volume, glTF/raw-u8 export)"
        ),
    ]

    return {
        "meta": {
            "id": PACK_ID,
            "display_name": "Healthy Pediatric Heart — Heart0102, chamber-labelled",
            "anatomy": "Normal paediatric heart, observer-labelled chambers and myocardium",
            "canonical_variant": (
                "Single 14-year-old specimen, MR-segmented tissue, no known cardiac history; "
                "six lumen and six wall identities hand-seeded by one observer"
            ),
            "pack_version": "0.1.0",
            "schema_version": "0.1",
        },
        "provenance": source_provenance(modification_note, chain),
        "meshes": {
            "gltf": "assets/model.gltf",
            "structures": structures,
            "canonical_pose": {
                "position": [0.0, 0.0, 0.0],
                "rotation_euler_xyz_deg": [0.0, 0.0, 0.0],
                "scale": 1.0,
            },
            "units": "mm",
            "orientation": {
                "up": "+y",
                "anterior": "+z",
                "patient_left": "+x",
                "handedness": "right",
            },
            "anatomical_frame": frame_record,
        },
        "interaction": {
            "pivot": ((low + high) / 2.0).astype(float).tolist(),
            "free_cut": {"normal": [0.0, 0.0, 1.0], "offset": 0.0},
        },
        "echo_volume": {
            "asset": "assets/echo-volume.raw",
            "format": "raw-u8",
            "resolution": [RESOLUTION, RESOLUTION, RESOLUTION],
            "mesh_to_volume": transform,
            "labels": [
                {
                    "id": tag,
                    "structure": TAG_DETAILS[tag]["wall_slug"],
                    "echogenicity": 0.55 if tag <= 4 else 0.7,
                    "attenuation": 0.45 if tag <= 4 else 0.6,
                }
                for tag in TAG_DETAILS
            ],
            "scatterer_seed": 20260822,
        },
        "views": [reference_view(structures, (low, high))],
        "display_flags": {
            "pediatric_vertex_convention": True,
            "plax_apex_left_exception": True,
            "dextrocardia_indicator_profile": {"enabled": False, "profile": None},
        },
    }


def build(repo: Path, output: Path) -> None:
    """Validate the authored state, build in a temp directory, then copy once."""
    require(PACK_ID in VHL.derived_packs, f"{PACK_ID} is not registered on the VHL source")
    require(VHL.public_repo_eligible and VHL.license_state in PUBLIC_GIT_LICENSE_STATES,
            "source policy does not permit this derivative in public Git")
    require(not output.exists(), f"refusing to overwrite existing output: {output}")
    verify_input_files(repo)
    print("verified source and four current label inputs by SHA-256", flush=True)

    grid_path = repo / LABEL_DIR / "grid.npz"
    with np.load(grid_path) as grid:
        require(grid["tissue"].shape == (384, 384, 384), "grid tissue is not 384^3")
        require(grid["tissue"].dtype == np.bool_, "grid tissue is not boolean")
        pitch = float(grid["pitch"])
        voxel_mm3 = float(grid["voxel_mm3"])
        origin = np.asarray(grid["origin"], dtype=np.float64)

    with np.load(repo / LABEL_DIR / "round6-labels.npz") as archive:
        lumen = np.asarray(archive["labels"], dtype=np.uint8)
    with np.load(repo / LABEL_DIR / "wall-labels-current.npz") as archive:
        wall = np.asarray(archive["labels"], dtype=np.uint8)
    with np.load(repo / LABEL_DIR / "tissue-clean.npz") as archive:
        tissue = np.asarray(archive["tissue"], dtype=bool)

    for name, labels in (("lumen", lumen), ("wall", wall)):
        require(labels.shape == (384, 384, 384), f"{name} labels are not 384^3")
        require(labels.dtype == np.uint8, f"{name} labels are not uint8")
        require(set(np.unique(labels).tolist()) == set(range(7)),
                f"{name} labels are not exactly tags 0..6")
        require(boundary_nonzero(labels) == 0, f"{name} labels touch the source-grid boundary")
    require(np.array_equal(wall > 0, tissue), "wall labels do not exactly cover tissue-clean")
    require(not bool(np.any((lumen > 0) & (wall > 0))), "lumen and wall labels overlap")

    connectivity = ndimage.generate_binary_structure(3, 1)
    lumen_ml: list[float] = []
    wall_ml: list[float] = []
    for tag in TAG_DETAILS:
        components = int(ndimage.label(lumen == tag, structure=connectivity)[1])
        require(components == 1, f"lumen tag {tag} has {components} connected components")
        lumen_ml.append(round(float(np.count_nonzero(lumen == tag) * voxel_mm3 / 1000.0), 1))
        wall_ml.append(round(float(np.count_nonzero(wall == tag) * voxel_mm3 / 1000.0), 1))
    require(tuple(lumen_ml) == EXPECTED_LUMEN_ML,
            f"lumen volumes changed: {lumen_ml}, expected {EXPECTED_LUMEN_ML}")
    require(tuple(wall_ml) == EXPECTED_WALL_ML,
            f"wall volumes changed: {wall_ml}, expected {EXPECTED_WALL_ML}")
    ratio = float(np.count_nonzero(wall == 1) / np.count_nonzero(wall == 2))
    require(round(ratio, 2) == 1.09, f"LV:RV wall ratio changed to {ratio:.4f}")
    print(f"validated lumen mL {lumen_ml}; wall mL {wall_ml}; LV:RV wall {ratio:.4f}:1", flush=True)

    rotation, frame = seed_frame(repo)
    print("re-derived observer-seeded cardiac frame; 2/3 recorded checks pass", flush=True)

    surfaces: list[Surface] = []
    topologies: dict[str, dict[str, Any]] = {}
    for kind, labels in (("lumen", lumen), ("wall", wall)):
        for tag, details in TAG_DETAILS.items():
            slug = details["lumen_slug" if kind == "lumen" else "wall_slug"]
            surface = extract_surface(labels, tag, slug, origin, pitch, rotation)
            topology = topology_record(surface, f"{kind} tag {tag}")
            surfaces.append(surface)
            topologies[slug] = topology
            print(
                f"{slug}: {surface.vertex_count:,} vertices, {surface.triangle_count:,} triangles; "
                f"topology {topology['components']} component(s), "
                f"{topology['boundary_edges']} boundary, {topology['nonmanifold_edges']} non-manifold",
                flush=True,
            )
            gc.collect()

    reduced = dominant_nonzero_downsample(wall)
    require(set(np.unique(reduced).tolist()) == set(range(7)),
            "192^3 wall volume does not carry every label 1..6")
    del tissue, lumen, wall
    gc.collect()

    stage_parent = repo / "build" / "packs"
    stage_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{PACK_ID}-", dir=stage_parent) as temporary:
        stage = Path(temporary) / PACK_ID
        assets = stage / "assets"
        assets.mkdir(parents=True)
        sizes = write_multibuffer_gltf(assets / "model.gltf", surfaces)
        raw = raw_volume_bytes(reduced)
        require(len(raw) == RESOLUTION ** 3, "raw volume byte count is not 192^3")
        (assets / "echo-volume.raw").write_bytes(raw)
        sizes["echo-volume.raw"] = len(raw)

        pack = build_pack(surfaces, topologies, rotation, frame, origin, pitch)
        pack_text = json.dumps(pack, indent=2) + "\n"
        (stage / "pack.json").write_text(pack_text)
        sizes["pack.json"] = len(pack_text.encode())

        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(stage, output)

    print(f"wrote {output}", flush=True)
    print(f"assets: {sum(sizes.values()):,} bytes total", flush=True)
    for name, size in sorted(sizes.items()):
        print(f"  {name}: {size:,}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO / "public" / "packs" / PACK_ID,
        help="new output directory; existing directories are never overwritten",
    )
    args = parser.parse_args()
    output = args.output if args.output.is_absolute() else REPO / args.output
    build(REPO, output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
