"""
One ingest pipeline, run over every candidate substrate.

    python pipeline/ingest.py --source rodero
    python pipeline/ingest.py --source alberta --resolution 160
    python pipeline/ingest.py --source all --report

Steps, per `docs/build_plan.md` ("Model prep pipeline"):
acquire -> pose-normalise -> split/label structures -> decimate -> glTF export
-> labelled voxelisation -> pack.json with complete provenance.

The pipeline is source-shaped in exactly two places, both unavoidable and both
explicit:

* **Structure splitting.** A tetrahedral mesh with per-element tissue tags splits
  by tag. A glTF splits by the creator's own named groups. A single STL does not
  split at all, and the pipeline says so rather than inventing a division.
* **Voxelisation.** A volumetric source is sampled from its elements, which is
  exact. A surface-only source is filled by ray parity along scanlines, which is
  exact for a watertight surface and honest about it when the surface is not.

Everything after that — decimation, export, budget accounting, provenance — is
shared, so the three candidates are measured on the same ruler.
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import trimesh
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fast_simplification  # noqa: E402

from anatomy import CardiacFrame, derive_cardiac_frame, frame_record  # noqa: E402
from meshlib import Surface, TetMesh, read_binary_stl, read_gltf_surfaces, read_vtk_tets, write_gltf  # noqa: E402
from sources import SOURCES, Source  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".cache"

#: Total triangle budget after decimation (`build_plan.md`: "~150-300k triangles").
DEFAULT_TRIANGLE_BUDGET = 220_000
#: Voxels per axis for the label volume. See `budget_table()` for the size curve.
DEFAULT_RESOLUTION = 192


# --------------------------------------------------------------------------- #
# structure naming                                                             #
# --------------------------------------------------------------------------- #

#: The Rodero/CEMRG per-element tag map. Only the six tags whose identity is
#: documented are named. Tags 7-24 are valve rings, veins and the left atrial
#: appendage; which is which is a CLINICAL reading, not something this pipeline
#: may assert, so they are carried through with honest generic labels and their
#: centroids are printed for the vetter to name at the slice review.
RODERO_NAMED = {
    1: ("lv-myocardium", "Left ventricular myocardium", False),
    2: ("rv-myocardium", "Right ventricular myocardium", False),
    3: ("la-myocardium", "Left atrial myocardium", False),
    4: ("ra-myocardium", "Right atrial myocardium", False),
    5: ("aortic-wall", "Aortic wall", False),
    6: ("pulmonary-artery-wall", "Pulmonary artery wall", False),
}


@dataclass
class Structure:
    """One labelled piece of anatomy on its way into a pack."""

    slug: str
    label: str
    surface: Surface
    blood_pool: bool
    stylized: bool
    #: Relative acoustic authoring values consumed by the echo renderer.
    echogenicity: float
    attenuation: float
    label_id: int = 0
    centroid: tuple[float, float, float] = (0.0, 0.0, 0.0)


@dataclass
class IngestResult:
    source: Source
    out_dir: Path
    published: bool
    structures: list[Structure]
    triangles_before: int
    triangles_after: int
    resolution: int
    voxel_mm: float
    sizes: dict[str, int] = field(default_factory=dict)
    timings: dict[str, float] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# step 1 — split and label                                                     #
# --------------------------------------------------------------------------- #


def tet_group_surface(mesh: TetMesh, selector: np.ndarray) -> Surface:
    """
    Boundary surface of a subset of tetrahedra.

    A face on the boundary of the group belongs to exactly one selected tet;
    an interior face belongs to two. Counting face occurrences therefore yields
    the group's full closed boundary — which, for a myocardial tag, is both its
    epicardial and its endocardial surface. That is the property that makes this
    substrate volumetric rather than a cast: the inner surface is not
    reconstructed, it is already there.
    """
    tets = mesh.tets[selector]
    faces = np.vstack([
        tets[:, [0, 2, 1]],
        tets[:, [0, 1, 3]],
        tets[:, [0, 3, 2]],
        tets[:, [1, 2, 3]],
    ])
    keys = np.sort(faces, axis=1)
    _, index, counts = np.unique(keys, axis=0, return_index=True, return_counts=True)
    boundary = faces[index[counts == 1]]

    used = np.unique(boundary)
    remap = np.full(mesh.points.shape[0], -1, dtype=np.int64)
    remap[used] = np.arange(used.size)
    return Surface(
        name="group",
        vertices=mesh.points[used].astype(np.float32),
        faces=remap[boundary].astype(np.int32),
    )


def split_rodero(source: Source, mesh: TetMesh) -> list[Structure]:
    """
    Split the tetrahedral mesh by its per-element tissue tag.

    The mesh arrives ALREADY rotated into the derived cardiac frame. Rotating
    inside this function, as an earlier revision did, meant reading the 187 MB
    ASCII source twice — once to split and once to voxelise — and left two
    copies of the geometry that could in principle disagree about their frame.
    """
    structures: list[Structure] = []
    for tag in np.unique(mesh.tags):
        selector = mesh.tags == tag
        surface = tet_group_surface(mesh, selector)
        if surface.triangle_count == 0:
            continue
        slug, label, stylized = RODERO_NAMED.get(
            int(tag),
            (f"tagged-region-{int(tag)}", f"Tagged region {int(tag)} (unnamed pending vetting)", False),
        )
        centroid = mesh.points[np.unique(mesh.tets[selector])].mean(axis=0)
        structures.append(Structure(
            slug=slug,
            label=label,
            surface=surface,
            blood_pool=False,   # every tag in this source is tissue, not lumen
            stylized=stylized,
            echogenicity=0.55 if int(tag) <= 4 else 0.7,
            attenuation=0.45 if int(tag) <= 4 else 0.6,
            centroid=tuple(float(v) for v in centroid),
        ))
    return structures


def split_gltf_groups(source: Source, path: Path) -> list[Structure]:
    """
    Split a Sketchfab glTF by the creator's own named groups.

    Sketchfab chunks a single object across many primitives to stay inside a
    16-bit index limit, so primitives are regrouped by their parent node name —
    the chunk boundary is a buffer artefact and carries no anatomy.
    """
    doc = json.loads(path.read_text())
    parent: dict[int, int] = {}
    for index, node in enumerate(doc["nodes"]):
        for child in node.get("children", []):
            parent[child] = index

    def group_name(node_index: int) -> str:
        cursor = node_index
        name = doc["nodes"][cursor].get("name") or f"node{cursor}"
        while cursor in parent:
            cursor = parent[cursor]
            candidate = doc["nodes"][cursor].get("name") or ""
            if candidate and candidate not in {"Sketchfab_model", "root", "GLTF_SceneRootNode"}:
                name = candidate
        return name

    groups: dict[str, list[Surface]] = {}
    for surface, _material, node_index in read_gltf_surfaces(path):
        groups.setdefault(group_name(node_index), []).append(surface)

    structures: list[Structure] = []
    for name, chunk in groups.items():
        merged = weld(chunk)
        slug = slugify(name)
        is_pool = "blood" in name.lower() or "pool" in name.lower()
        structures.append(Structure(
            slug=slug,
            label=name.strip(),
            surface=merged,
            blood_pool=is_pool,
            stylized=False,
            echogenicity=0.05 if is_pool else 0.6,
            attenuation=0.05 if is_pool else 0.5,
            centroid=tuple(float(v) for v in merged.vertices.mean(axis=0)),
        ))
    return structures


def split_single_stl(source: Source, path: Path) -> list[Structure]:
    """
    A single STL does not split.

    The pipeline deliberately does not run connected-component splitting here:
    the components of this mesh are trabecular islands and segmentation debris,
    not chambers, and naming them would manufacture anatomy the source does not
    contain.
    """
    surface = read_binary_stl(path)
    return [Structure(
        slug="myocardial-tissue",
        label="Myocardial tissue (undivided)",
        surface=surface,
        blood_pool=False,
        stylized=False,
        echogenicity=0.6,
        attenuation=0.5,
        centroid=tuple(float(v) for v in surface.vertices.mean(axis=0)),
    )]


def weld(chunk: list[Surface]) -> Surface:
    """Merge chunked primitives and weld coincident vertices at the seams."""
    vertices, faces, offset = [], [], 0
    for surface in chunk:
        vertices.append(surface.vertices)
        faces.append(surface.faces + offset)
        offset += surface.vertex_count
    stacked = np.vstack(vertices)
    combined = np.vstack(faces)
    unique, inverse = np.unique(np.round(stacked.astype(np.float64), 5), axis=0, return_inverse=True)
    return Surface(
        name="merged",
        vertices=unique.astype(np.float32),
        faces=inverse[combined].astype(np.int32),
    )


def slugify(name: str) -> str:
    out = "".join(character.lower() if character.isalnum() else "-" for character in name)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-") or "structure"


# --------------------------------------------------------------------------- #
# step 2 — decimate                                                            #
# --------------------------------------------------------------------------- #


def repair(surface: Surface) -> tuple[Surface, dict[str, int]]:
    """
    Tidy what decimation leaves behind, and MEASURE what it leaves behind.

    `tet_group_surface` emits a closed boundary by construction — a face on the
    boundary of a tag group belongs to exactly one selected tetrahedron — and
    `fast_simplification` does not preserve that exactly. What it actually
    breaks is worth being precise about, because the two failure modes have
    opposite consequences for the stencil caps:

    * **boundary edges** (an edge used by ONE face) are real holes. They break
      the front/back face parity the caps count, so the cut face speckles at
      them. `fill_holes` triangulates each boundary loop and closes them.
    * **non-manifold edges** (an edge used by more than two faces) are pinches,
      where the decimator has welded two sheets along a shared edge. The surface
      is still closed and its winding is still consistent, so the parity is
      unaffected and the caps are correct.

    On the Rodero pack the residue is entirely the second kind: zero boundary
    edges, and three to thirteen edges per structure carrying four faces. An
    earlier revision of this pipeline reported those with a single "open edges"
    count and concluded the caps were at risk. They are not — but the number is
    still reported, because a count that rises means the decimator has started
    doing something new.
    """
    mesh = trimesh.Trimesh(
        vertices=surface.vertices.astype(np.float64),
        faces=surface.faces.astype(np.int64),
        process=False,
    )
    mesh.merge_vertices()
    mesh.fill_holes()
    mesh.fix_normals()

    edges = mesh.edges_sorted
    _, counts = np.unique(edges, axis=0, return_counts=True)
    report = {
        "boundary_edges": int(np.count_nonzero(counts == 1)),
        "nonmanifold_edges": int(np.count_nonzero(counts > 2)),
        "winding_consistent": int(bool(mesh.is_winding_consistent)),
    }
    return (
        Surface(
            name=surface.name,
            vertices=np.ascontiguousarray(mesh.vertices, dtype=np.float32),
            faces=np.ascontiguousarray(mesh.faces, dtype=np.int32),
        ),
        report,
    )


def decimate(structures: list[Structure], budget: int) -> list[str]:
    """
    Reduce to a total triangle budget, in place, then close what that opened.

    The budget is shared out in proportion to each structure's current triangle
    count, with a floor: a valve ring is small but decimating it into nothing
    would delete a structure the pack still references. Structures already under
    the floor are left untouched.

    Any structure left with a real hole, or with inconsistent winding, is
    REPORTED rather than silently shipped: those are the two conditions under
    which a stencil cap cannot be trusted. Pinched edges are counted separately
    because they are harmless — see `repair`.
    """
    total = sum(s.surface.triangle_count for s in structures)
    floor = 800
    notes: list[str] = []
    pinches: list[str] = []

    for structure in structures:
        if total > budget:
            share = structure.surface.triangle_count / total
            target = max(floor, int(budget * share))
            current = structure.surface.triangle_count
            if current > target and current > floor:
                reduction = 1.0 - (target / current)
                points, faces = fast_simplification.simplify(
                    structure.surface.vertices.astype(np.float32),
                    structure.surface.faces.astype(np.int32),
                    min(max(reduction, 0.0), 0.98),
                )
                structure.surface = Surface(
                    name=structure.surface.name,
                    vertices=np.ascontiguousarray(points, dtype=np.float32),
                    faces=np.ascontiguousarray(faces, dtype=np.int32),
                )
        structure.surface, report = repair(structure.surface)
        # A boundary edge is a hole and breaks the caps; report it loudly. A
        # non-manifold edge is a pinch and does not, so it is reported only in
        # aggregate, and only to make a regression visible.
        if report["boundary_edges"]:
            notes.append(
                f"{structure.slug}: {report['boundary_edges']} boundary edges remain after "
                "hole-filling; its stencil cap will speckle there"
            )
        if not report["winding_consistent"]:
            notes.append(
                f"{structure.slug}: inconsistent winding after decimation; face parity is "
                "unreliable and its stencil cap cannot be trusted"
            )
        pinched = report["nonmanifold_edges"]
        if pinched:
            pinches.append(f"{structure.slug}:{pinched}")
    if pinches:
        notes.append(
            "non-manifold (pinched) edges after decimation, which leave the surfaces closed and "
            "the caps correct: " + ", ".join(pinches)
        )
    return notes


# step 3 — labelled voxelisation                                               #
# --------------------------------------------------------------------------- #


def grid_axes(low: np.ndarray, high: np.ndarray, resolution: int) -> tuple[np.ndarray, float, np.ndarray]:
    """Cube grid covering the model bounds with a one-voxel margin."""
    span = (high - low).max()
    pitch = span / (resolution - 2)
    centre = (low + high) / 2.0
    origin = centre - (resolution * pitch) / 2.0
    return origin, float(pitch), np.arange(resolution)


def voxelize_tets(
    mesh: TetMesh, tag_to_label: dict[int, int], resolution: int
) -> tuple[np.ndarray, np.ndarray, float]:
    """
    Sample a tetrahedral mesh onto a label grid — exact, element-wise.

    Each voxel centre is tested for containment against its nearest tetrahedra
    using barycentric coordinates. A voxel inside no tetrahedron is background,
    which is the correct answer rather than a failure: the space outside the
    heart genuinely has no tissue label.
    """
    low, high = mesh.points.min(axis=0), mesh.points.max(axis=0)
    origin, pitch, axis = grid_axes(low, high, resolution)

    corners = mesh.points[mesh.tets]                     # (M, 4, 3)
    base = corners[:, 0, :]
    edges = np.transpose(corners[:, 1:, :] - base[:, None, :], (0, 2, 1))  # (M, 3, 3)
    inverse = np.linalg.inv(edges.astype(np.float64))
    centroids = corners.mean(axis=1)
    tree = cKDTree(centroids)

    volume = np.zeros((resolution, resolution, resolution), dtype=np.uint8)
    label_of = np.zeros(int(mesh.tags.max()) + 1, dtype=np.uint8)
    for tag, label in tag_to_label.items():
        label_of[tag] = label

    neighbours = 24
    chunk = 150_000
    grid = (origin[None, :] + (np.stack(np.meshgrid(axis, axis, axis, indexing="ij"), -1)
                               .reshape(-1, 3) + 0.5) * pitch)

    for start in range(0, grid.shape[0], chunk):
        points = grid[start:start + chunk]
        _, candidates = tree.query(points, k=neighbours, workers=-1)
        assigned = np.zeros(points.shape[0], dtype=np.uint8)
        remaining = np.ones(points.shape[0], dtype=bool)

        for slot in range(neighbours):
            if not remaining.any():
                break
            index = candidates[remaining, slot]
            offset = points[remaining] - base[index]
            bary = np.einsum("nij,nj->ni", inverse[index], offset)
            inside = (
                (bary >= -1e-9).all(axis=1)
                & (bary.sum(axis=1) <= 1 + 1e-9)
            )
            hit = np.flatnonzero(remaining)[inside]
            assigned[hit] = label_of[mesh.tags[index[inside]]]
            remaining[hit] = False

        volume.reshape(-1)[start:start + points.shape[0]] = assigned

    return volume, origin, pitch


def voxelize_surfaces(
    structures: list[Structure], resolution: int
) -> tuple[np.ndarray, np.ndarray, float, list[str]]:
    """
    Fill surface-only structures by ray parity along grid scanlines.

    For each grid line along `+x` the surface's crossings are sorted and the
    spans between alternate crossings are filled. This is exact for a watertight,
    consistently wound surface. Where a scanline returns an odd number of hits
    the surface is locally open or self-intersecting there; those lines are
    skipped and counted, so a leaky source shows up as a number rather than as
    silently missing tissue.
    """
    low = np.min([s.surface.vertices.min(axis=0) for s in structures], axis=0)
    high = np.max([s.surface.vertices.max(axis=0) for s in structures], axis=0)
    origin, pitch, axis = grid_axes(low, high, resolution)

    volume = np.zeros((resolution, resolution, resolution), dtype=np.uint8)
    notes: list[str] = []

    coordinates = origin[None, 1:] + (np.stack(
        np.meshgrid(axis, axis, indexing="ij"), -1).reshape(-1, 2) + 0.5) * pitch
    origins = np.column_stack([
        np.full(coordinates.shape[0], origin[0] - pitch),
        coordinates[:, 0],
        coordinates[:, 1],
    ])
    directions = np.tile(np.array([1.0, 0.0, 0.0]), (coordinates.shape[0], 1))

    for structure in structures:
        mesh = trimesh.Trimesh(
            vertices=structure.surface.vertices.astype(np.float64),
            faces=structure.surface.faces.astype(np.int64),
            process=False,
        )
        locations, ray_indices, _ = mesh.ray.intersects_location(
            ray_origins=origins, ray_directions=directions, multiple_hits=True
        )
        odd = 0
        order = np.argsort(ray_indices, kind="stable")
        ray_indices, locations = ray_indices[order], locations[order]
        boundaries = np.flatnonzero(np.diff(ray_indices)) + 1
        for piece, ray in zip(
            np.split(locations[:, 0], boundaries), ray_indices[np.r_[0, boundaries]]
        ):
            xs = np.sort(piece)
            if xs.size % 2:
                odd += 1
                continue
            iy, iz = divmod(int(ray), resolution)
            starts = np.ceil((xs[0::2] - origin[0]) / pitch - 0.5).astype(int)
            stops = np.floor((xs[1::2] - origin[0]) / pitch - 0.5).astype(int)
            for begin, end in zip(starts, stops):
                if end >= begin:
                    volume[max(begin, 0):end + 1, iy, iz] = structure.label_id
        if odd:
            notes.append(
                f"{structure.slug}: {odd} of {coordinates.shape[0]} scanlines returned an odd "
                "hit count (locally open or self-intersecting surface) and were skipped"
            )
    return volume, origin, pitch, notes


# --------------------------------------------------------------------------- #
# step 4 — pack.json                                                           #
# --------------------------------------------------------------------------- #

TODAY = "2026-08-18"


def provenance_block(source: Source, *, note: str, chain: list[str]) -> dict:
    """
    Provenance for the pack, generated from the source registry.

    `vetted.status` is `draft` and `vetters` is empty, without exception. Nothing
    in this pipeline has been read by a clinician, and `check-provenance.ts`
    exists precisely so that an unvetted pack cannot claim otherwise.
    """
    return {
        "creator": source.creator,
        "source": source.source_text,
        "source_url": source.source_url,
        "license": source.license,
        "license_url": source.license_url,
        "modified": {"flag": True, "note": note},
        "derivation_chain": chain,
        "vetted": {"status": "draft", "vetters": [], "last_reviewed": None},
    }


def reference_view(structures: list[Structure], bounds: tuple[np.ndarray, np.ndarray], source: Source) -> dict:
    """
    One ingest reference pose, so the pack satisfies `views[].min(1)`.

    This is NOT a clinical view and does not pretend to be. Schema v0 requires at
    least one view; wave 1a authors no clinical content, and vetted probe poses
    are wave 1d's job with a clinical vetter. The pose is derived mechanically
    from the model bounds — an anterior probe aimed at the model centre — and is
    named, flagged, and provenance-stamped as a pipeline artefact.
    """
    low, high = bounds
    centre = (low + high) / 2.0
    origin_v = np.array([centre[0], centre[1], high[2] + (high[2] - low[2]) * 0.12])

    # Depth is measured, not guessed: the distance from the probe to the
    # farthest corner of the model, plus a small margin. Deriving it from the
    # bounding-box DIAGONAL instead (an earlier attempt) overshot by roughly
    # three times, and the anatomy rendered into the top third of the sector
    # with two thirds of the fan empty.
    corners = np.array([[x, y, z] for x in (low[0], high[0])
                        for y in (low[1], high[1]) for z in (low[2], high[2])])
    reach = float(np.linalg.norm(corners - origin_v, axis=1).max())
    depth_cm = round(reach * 1.05 / 10.0, 2)
    origin = [float(v) for v in origin_v]
    return {
        "family": "INGEST",
        "view_id": "ingest-reference-pose",
        "name": "Ingest reference pose — not a clinical view",
        "aliases": [],
        "placement_landmark": (
            "Derived from model bounds by the ingest pipeline; carries no anatomical landmark "
            "and no clinical meaning"
        ),
        "indicator_clock": "12:00",
        "probe": {
            "origin": origin,
            "beam_axis": [0.0, 0.0, -1.0],
            "lateral_axis": [1.0, 0.0, 0.0],
            "fan": {
                "angle_deg": 75.0,
                "depth_cm": depth_cm,
                "focus_cm": round(depth_cm * 0.55, 2),
            },
            "display": {"vertex": "down", "flip_lr": False, "marker_side": "right"},
        },
        "sweep": {
            # A mechanical tilt about the pose's own lateral axis, so the
            # end-to-end sweep path (pack -> loader -> poseAt -> renderer) is
            # exercised against a real pack. It is NOT the A3 subcostal coronal
            # sweep or any other clinical sweep, and `structures_in_order` is
            # deliberately EMPTY: naming the structures a sweep crosses is a
            # clinical reading, and an empty list claims nothing.
            "mode": "tilt",
            "axis": {"direction": [1.0, 0.0, 0.0]},
            "range": {"unit": "deg", "from": -22.0, "to": 22.0},
            "interpolation": "slerp",
            "structures_in_order": [],
        },
        "structures": [s.slug for s in structures],
        "measurements": [],
        "lesion_attachments": [],
        "show_hide_preset": {"visible": [s.slug for s in structures], "hidden": []},
        "echo_tuning": {},
        "real_clip_slot": None,
        "emphasis": None,
        "provenance": provenance_block(
            source,
            note=(
                "Pose generated mechanically from model bounds by pipeline/ingest.py. Not a "
                "clinical view, not vetted, and not derived from any imaging protocol."
            ),
            chain=["pipeline/ingest.py"],
        ),
    }


def apical_four_chamber(
    structures: list[Structure], frame: CardiacFrame, source: Source
) -> dict:
    """
    The first clinical view: apical four-chamber, `docs/view_canon.md` B1. DRAFT.

    ## Why this view first, on this substrate

    The mesh is an adult population average with valve RINGS but no leaflets,
    no papillary muscles, no coronaries and no chest wall. That rules out most
    of the canon as a first view, and picks this one out:

    * **It is the derived frame, rendered.** The probe sits at the apex and
      looks along the long axis at the base — both of which are exactly what
      `derive_cardiac_frame` measures. The view is not placed against the frame
      by hand; it falls out of it.
    * **Its teaching payload survives the missing leaflets.** Chamber sizes,
      both septa, and the relationship of the two atrioventricular rings at the
      crux. PLAX (C1) leans on mitral-aortic leaflet continuity and root
      detail; PSAX (C2) at the papillary level has no papillary muscles to show.
    * **It is the strongest test of the cut.** Align the free cutter with this
      plane and the stencil caps reproduce the echo panel's cross-section, so a
      disagreement between the two panels is visible rather than arguable.

    ## What is NOT claimed

    The pose is geometry derived from measured landmarks, not a reading of an
    imaging protocol. Nobody clinical has looked at it. In particular: the mesh
    has no chest wall, so the transducer stands off the epicardium in empty
    space rather than sitting in an intercostal space; and the indicator clock
    and marker side are the canon's values for B1 carried across unverified.
    `structures_in_order` is left EMPTY — naming the structures a sweep crosses
    is teaching content and a clinical reading, and this pipeline may not assert
    it. Everything here is draft-flagged and must survive vetting before it
    means anything.
    """
    apex = frame.rotation @ frame.apex
    base = frame.rotation @ frame.base
    rings = {tag: frame.rotation @ centroid for tag, centroid in frame.ring_centroids.items()}
    mitral, tricuspid = rings[7], rings[8]

    def unit(vector: np.ndarray) -> np.ndarray:
        return vector / np.linalg.norm(vector)

    # THE defining property of this view: the imaging plane passes through the
    # apex and both atrioventricular rings. So that plane is built first and
    # everything else is derived inside it.
    #
    # Building the beam along the long axis instead and merely *using* this
    # normal for the sweep — an earlier revision — produced a plane 12 degrees
    # off, which missed both rings by about 17 mm. The pose looked entirely
    # reasonable and was not a four-chamber view.
    normal = unit(np.cross(mitral - apex, tricuspid - apex))
    if normal[2] < 0:
        normal = -normal

    # The beam looks from the apex at the middle of the atrioventricular valve
    # plane. Both endpoints lie in the plane above, so the beam does too.
    target = (mitral + tricuspid) / 2.0
    axis = unit(target - apex)

    # Stand the transducer off outside the apical epicardium. Measured, not
    # assumed: how far the model extends past the apex against the beam, plus a
    # small gap for the transducer face.
    everything = np.vstack([s.surface.vertices.astype(np.float64) for s in structures])
    beyond = float(np.max((apex - everything) @ axis))
    origin_v = apex - axis * (max(beyond, 0.0) + 8.0)
    beam = unit(target - origin_v)

    # Lateral completes the plane. Its sign points toward the patient's left —
    # toward the mitral ring — so that rightward structures fall on the opposite
    # side of the sector, per the canon's anatomically-correct orientation rule.
    lateral = unit(np.cross(normal, beam))
    if np.dot(lateral, mitral - tricuspid) < 0:
        lateral = -lateral

    # Depth: to the far side of the atria, which are the deepest structures in
    # this view, plus a margin.
    #
    # Measured over the tissue this fan actually IMAGES — the slab about the
    # imaging plane — not over every vertex in the model. Measuring over all of
    # them lets a pulmonary-vein stub sitting well out of plane set the depth,
    # which put 4 cm of empty sector under the heart and pushed the anatomy into
    # the top of the frame.
    half_angle = np.radians(80.0 / 2.0)
    offsets = everything - origin_v
    in_slab = np.abs(offsets @ normal) <= 12.0
    imaged = offsets[in_slab] if in_slab.any() else offsets
    reach = float(np.max(np.linalg.norm(imaged, axis=1)))
    depth_cm = round(reach * 1.08 / 10.0, 2)

    # The view has to actually contain what it is named for. Both rings, and the
    # apex, must fall inside the sector this pose describes.
    for label, point in (("mitral ring", mitral), ("tricuspid ring", tricuspid), ("apex", apex)):
        offset = point - origin_v
        elevation = abs(float(np.dot(offset, normal)))
        in_plane = offset - np.dot(offset, normal) * normal
        angle = abs(float(np.arctan2(np.dot(in_plane, lateral), np.dot(in_plane, beam))))
        if elevation > 6.0 or angle > half_angle or np.linalg.norm(in_plane) > depth_cm * 10.0:
            raise ValueError(
                f"apical four-chamber pose does not contain the {label}: "
                f"{elevation:.1f} mm off plane, {np.degrees(angle):.1f} deg off axis"
            )

    # Positive sweep tilts the plane ANTERIORLY. For a rotation about axis `a`,
    # the beam moves toward `a x beam`; choosing `a = beam x normal` makes that
    # product the anterior normal exactly, so the declared range reads the way
    # the canon describes the sweep.
    sweep_axis = unit(np.cross(beam, normal))

    return {
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
        # docs/view_canon.md B1: indicator 3:00. Carried across unverified.
        "indicator_clock": "3:00",
        "probe": {
            "origin": [float(v) for v in origin_v],
            "beam_axis": [float(v) for v in beam],
            "lateral_axis": [float(v) for v in lateral],
            "fan": {
                "angle_deg": 80.0,
                "depth_cm": depth_cm,
                "focus_cm": round(depth_cm * 0.55, 2),
            },
            # Family B renders vertex-down — the paediatric convention in
            # docs/view_canon.md, unlike most adult labs.
            "display": {"vertex": "down", "flip_lr": False, "marker_side": "right"},
        },
        "sweep": {
            "mode": "tilt",
            "axis": {
                "direction": [float(v) for v in sweep_axis],
                "origin": [float(v) for v in origin_v],
            },
            # Posterior (toward the coronary sinus) through the reference plane
            # to anterior (toward the outflow tract, the "five-chamber").
            "range": {"unit": "deg", "from": -18.0, "to": 22.0},
            "interpolation": "slerp",
            "structures_in_order": [],
        },
        "structures": [s.slug for s in structures],
        "measurements": [],
        "lesion_attachments": [],
        "show_hide_preset": {"visible": [s.slug for s in structures], "hidden": []},
        "echo_tuning": {},
        "real_clip_slot": None,
        "emphasis": None,
        "provenance": provenance_block(
            source,
            note=(
                "Probe pose DERIVED from the cardiac frame measured in meshes.anatomical_frame: "
                "origin at the left-ventricular apex standing off the epicardium along the long "
                "axis, beam toward the valve-plane centroid, imaging plane through the apex and "
                "both atrioventricular ring centroids. Geometry only — not read from an imaging "
                "protocol, not reviewed by a clinician, and not a claim that this is a reachable "
                "window on a real patient. structures_in_order is deliberately empty because "
                "naming the structures a sweep crosses is a clinical reading."
            ),
            chain=[
                "pipeline/ingest.py (view derived from the measured cardiac frame)",
                "docs/view_canon.md B1 (family, indicator clock, display convention)",
            ],
        ),
    }


def build_pack(
    source: Source,
    structures: list[Structure],
    resolution: int,
    origin: np.ndarray,
    pitch: float,
    frame: CardiacFrame | None,
) -> dict:
    low = np.min([s.surface.vertices.min(axis=0) for s in structures], axis=0)
    high = np.max([s.surface.vertices.max(axis=0) for s in structures], axis=0)

    # Model space -> volume space, 4x4 column-major, as schema v0 requires.
    scale = 1.0 / pitch
    mesh_to_volume = [
        scale, 0.0, 0.0, 0.0,
        0.0, scale, 0.0, 0.0,
        0.0, 0.0, scale, 0.0,
        float(-origin[0] * scale), float(-origin[1] * scale), float(-origin[2] * scale), 1.0,
    ]

    if frame is not None:
        orientation_note = (
            "Pose normalised into a CARDIAC frame measured from this mesh: +y from the "
            "left-ventricular apex (located by the source's universal ventricular coordinate) to "
            "the centroid of the four valve rings, +x from the right-atrial to the left-atrial "
            "centroid orthogonalised against it, +z completing a right-handed basis. The axes are "
            "cardiac, not the patient's: a heart-only mesh carries no spine, diaphragm or chest "
            "wall, and three defensible proxies for body superior-inferior disagree by up to 46 "
            "degrees on this mesh, so no body frame is claimed. "
            f"{frame_record(frame)['checks_passed']} of {frame_record(frame)['checks_total']} "
            "independent anatomical checks pass; the full derivation is in "
            "meshes.anatomical_frame."
        )
    else:
        orientation_note = (
            "ORIENTATION UNVERIFIED. This source carries no chamber labels, so anterior and "
            "patient-left cannot be derived from the geometry. The declared convention is the "
            "glTF default (+y up) with the remaining axes unconfirmed, and must be set at vetting "
            "before any clinical use."
        )

    # Licence caveats travel WITH the pack, not just in the repository. A pack
    # whose grant is contested, or whose grant binds the whole application, has
    # to say so on the attribution surface the credits screen renders — that is
    # what makes the owner's decision auditable rather than merely recorded in a
    # commit message.
    caveats = " ".join(
        note for note in source.notes
        if note.startswith(("LICENCE CONFLICT", "NON-COMMERCIAL"))
    )
    # A rejected candidate says so in its own provenance. The verdict has to
    # survive being read years later by someone holding only the pack.
    if source.rejection:
        caveats = f"{source.rejection} {caveats}".strip()

    return {
        "meta": {
            "id": source.pack_id,
            "display_name": source.display_name,
            "anatomy": source.anatomy,
            "canonical_variant": source.canonical_variant,
            "pack_version": "0.1.0",
            "schema_version": "0",
        },
        "provenance": provenance_block(
            source,
            note=(
                "Ingested by pipeline/ingest.py: structures split and labelled, pose normalised, "
                "decimated for interactive display, exported to glTF, and voxelised to a labelled "
                f"echo volume at {resolution}^3. No geometry was added, sculpted, or invented. "
                + orientation_note
                + (f" {caveats}" if caveats else "")
            ),
            chain=[
                source.source_url,
                "pipeline/fetch.py (checksum-verified acquisition)",
                "pipeline/ingest.py (split, pose-normalise, decimate, voxelise)",
            ],
        ),
        "meshes": {
            "gltf": "assets/model.gltf",
            "structures": [
                {
                    "id": s.slug,
                    "mesh_node": s.slug,
                    "display_label": s.label,
                    "parent": None,
                    "blood_pool": s.blood_pool,
                    "stylized": s.stylized,
                }
                for s in structures
            ],
            "canonical_pose": {
                "position": [0.0, 0.0, 0.0],
                "rotation_euler_xyz_deg": [0.0, 0.0, 0.0],
                "scale": 1.0,
            },
            "units": "mm",
            "orientation": {
                # `up` is the cardiac basal direction where a frame was derived:
                # apex at -y, valve plane at +y. See meshes.anatomical_frame for
                # what that is and is not a claim about.
                "up": "+y", "anterior": "+z", "patient_left": "+x", "handedness": "right",
            },
            **({"anatomical_frame": frame_record(frame)} if frame is not None else {}),
        },
        "interaction": {
            "pivot": [float(v) for v in (low + high) / 2.0],
            # Seed the free cutter on the four-chamber plane where the frame is
            # known: normal along the derived anterior axis, through the pivot.
            # A pack that opens on load shows the learner what the cutter is for;
            # `offset: 0` puts the plane on the pivot, which is where the camera
            # is already aimed. Where no frame was derived the cutter stays off,
            # because an arbitrary plane through an unmeasured model teaches
            # nothing.
            **({"free_cut": {"normal": [0.0, 0.0, 1.0], "offset": 0.0}}
               if frame is not None else {}),
        },
        "echo_volume": {
            "asset": "assets/echo-volume.raw",
            "format": "raw-u8",
            "resolution": [resolution, resolution, resolution],
            "mesh_to_volume": mesh_to_volume,
            "labels": [
                {
                    "id": s.label_id,
                    "structure": s.slug,
                    "echogenicity": s.echogenicity,
                    "attenuation": s.attenuation,
                }
                for s in structures if s.label_id > 0
            ],
            "scatterer_seed": 20260818,
        },
        # The derived clinical view leads where there is a frame to derive it
        # from, so the app opens on anatomy rather than on a pipeline artefact.
        # The reference pose stays behind it: it is mechanically generated and
        # says so, and it exercises a second sweep mode against a real pack.
        "views": (
            ([apical_four_chamber(structures, frame, source)] if frame is not None else [])
            + [reference_view(structures, (low, high), source)]
        ),
        "display_flags": {
            "pediatric_vertex_convention": True,
            "plax_apex_left_exception": True,
            "dextrocardia_indicator_profile": {"enabled": False, "profile": None},
        },
    }


# --------------------------------------------------------------------------- #
# driver                                                                       #
# --------------------------------------------------------------------------- #


def ingest(source: Source, *, resolution: int, budget: int) -> IngestResult:
    from fetch import acquire

    timings: dict[str, float] = {}
    notes: list[str] = []

    clock = time.time()
    path = acquire(source)
    timings["acquire_s"] = time.time() - clock

    clock = time.time()
    tet_mesh: TetMesh | None = None
    frame: CardiacFrame | None = None
    if source.key == "rodero":
        tet_mesh = read_vtk_tets(path)
        # Derive the frame from the SOURCE coordinates, then carry the mesh into
        # it. Deriving after rotating would measure the frame against itself.
        frame = derive_cardiac_frame(tet_mesh)
        notes.extend(frame.notes)
        tet_mesh.points = tet_mesh.points @ frame.rotation.T
        structures = split_rodero(source, tet_mesh)
    elif path.suffix.lower() == ".gltf":
        structures = split_gltf_groups(source, path)
    else:
        structures = split_single_stl(source, path)
    timings["split_s"] = time.time() - clock

    structures.sort(key=lambda s: -s.surface.triangle_count)
    for index, structure in enumerate(structures, start=1):
        if index > 255:
            raise ValueError("more than 255 structures: label ids would overflow raw-u8")
        structure.label_id = index

    triangles_before = sum(s.surface.triangle_count for s in structures)

    clock = time.time()
    notes.extend(decimate(structures, budget))
    timings["decimate_s"] = time.time() - clock
    triangles_after = sum(s.surface.triangle_count for s in structures)

    clock = time.time()
    if tet_mesh is not None:
        tag_to_label: dict[int, int] = {}
        for structure in structures:
            for tag, (slug, _label, _stylized) in RODERO_NAMED.items():
                if slug == structure.slug:
                    tag_to_label[tag] = structure.label_id
            if structure.slug.startswith("tagged-region-"):
                tag_to_label[int(structure.slug.rsplit("-", 1)[1])] = structure.label_id
        volume, origin, pitch = voxelize_tets(tet_mesh, tag_to_label, resolution)
    else:
        volume, origin, pitch, surface_notes = voxelize_surfaces(structures, resolution)
        notes.extend(surface_notes)
    timings["voxelize_s"] = time.time() - clock

    # A declared label that never appears, or a value present but undeclared,
    # both fail `npm run validate:packs`. Reconcile here rather than shipping a
    # pack that CI will reject.
    present = set(np.unique(volume).tolist()) - {0}
    for structure in structures:
        if structure.label_id not in present:
            notes.append(
                f"{structure.slug}: no voxels at {resolution}^3 (too thin to sample); "
                "carried as geometry but not declared as an echo label"
            )
            structure.label_id = 0

    out_dir = (REPO / "public" / "packs" / source.pack_id) if source.publishable \
        else (REPO / "build" / "packs" / source.pack_id)
    assets = out_dir / "assets"
    assets.mkdir(parents=True, exist_ok=True)

    for structure in structures:
        structure.surface.name = structure.slug
    gltf_bytes, bin_bytes = write_gltf(
        assets / "model.gltf", [s.surface for s in structures], bin_name="model.bin"
    )
    (assets / "echo-volume.raw").write_bytes(volume.tobytes())

    pack = build_pack(source, structures, resolution, origin, pitch, frame)
    (out_dir / "pack.json").write_text(json.dumps(pack, indent=2) + "\n")

    raw_bytes = volume.size
    sizes = {
        "gltf": gltf_bytes,
        "bin": bin_bytes,
        "volume_raw": raw_bytes,
        "volume_gzip": len(gzip.compress(volume.tobytes(), 6)),
        "pack_json": len((out_dir / "pack.json").read_bytes()),
    }
    sizes["total_raw"] = sizes["gltf"] + sizes["bin"] + sizes["volume_raw"] + sizes["pack_json"]
    sizes["total_wire"] = sizes["gltf"] + sizes["bin"] + sizes["volume_gzip"] + sizes["pack_json"]

    if not source.publishable:
        notes.append(f"NOT PUBLISHED: {source.unpublishable_reason}")

    return IngestResult(
        source=source, out_dir=out_dir, published=source.publishable, structures=structures,
        triangles_before=triangles_before, triangles_after=triangles_after,
        resolution=resolution, voxel_mm=pitch, sizes=sizes, timings=timings, notes=notes,
    )


def report(result: IngestResult) -> None:
    source = result.source
    print(f"\n{'=' * 78}\n{source.display_name}\n{'=' * 78}")
    print(f"  pack id           {source.pack_id}")
    print(f"  licence           {source.license}")
    print(f"  published         {'yes' if result.published else 'NO'} -> {result.out_dir.relative_to(REPO)}")
    print(f"  triangles         {result.triangles_before:,} -> {result.triangles_after:,}")
    print(f"  structures        {len(result.structures)}")
    print(f"  echo labels       {sum(1 for s in result.structures if s.label_id > 0)}")
    print(f"  volume            {result.resolution}^3 @ {result.voxel_mm:.3f} mm/voxel")
    sizes = result.sizes
    print(f"  size on disk      glTF {sizes['gltf'] / 1e6:.2f} MB + bin {sizes['bin'] / 1e6:.2f} MB "
          f"+ volume {sizes['volume_raw'] / 1e6:.2f} MB = {sizes['total_raw'] / 1e6:.2f} MB")
    print(f"  size on the wire  {sizes['total_wire'] / 1e6:.2f} MB (volume gzips to "
          f"{sizes['volume_gzip'] / 1e6:.2f} MB)")
    budget = "WITHIN" if sizes["total_raw"] <= 20e6 else "OVER"
    print(f"  15-20 MB budget   {budget}")
    print("  timings           " + ", ".join(f"{k}={v:.1f}s" for k, v in result.timings.items()))
    print("  structures:")
    for structure in result.structures:
        marker = f"label {structure.label_id}" if structure.label_id else "no label"
        print(f"    - {structure.slug:28s} {structure.surface.triangle_count:>8,} tris  {marker}")
    for note in result.notes:
        print(f"  note: {note}")


def budget_table() -> None:
    print("\nLabel volume size against resolution (raw-u8, uncompressed):")
    for resolution in (96, 128, 160, 192, 224, 256):
        size = resolution ** 3
        print(f"  {resolution:3d}^3  {size / 1e6:6.2f} MB")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="all", choices=[*SOURCES, "all"])
    parser.add_argument("--resolution", type=int, default=DEFAULT_RESOLUTION)
    parser.add_argument("--triangles", type=int, default=DEFAULT_TRIANGLE_BUDGET)
    parser.add_argument("--budget-table", action="store_true")
    args = parser.parse_args()

    if args.budget_table:
        budget_table()

    keys = list(SOURCES) if args.source == "all" else [args.source]
    for key in keys:
        report(ingest(SOURCES[key], resolution=args.resolution, budget=args.triangles))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
