"""
Ingest for GEOMETRY-ONLY sources: plain surfaces in, an Explore-only pack out.

    python pipeline/ingest.py --source cardiac-motion

`ingest.py` handles substrates that carry an anatomical reading — tagged
volumes, named glTF groups — and derives a cardiac frame, clinical views and a
labelled echo volume from them. Most of the material worth looking at carries
none of that. It is a surface, or a folder of surfaces, with no labels, no tags,
no frame, and often no documentation. Schema v0.1 exists so those can still be
packs; this module is what builds them.

What it does, and nothing more:

* reads OBJ, STL, VTK PolyData and VTU;
* normalises units to millimetres, by MEASURING the model and saying so;
* centres on the model bounds — on the bounds of ALL frames together where the
  source moves, because centring each frame on itself would subtract exactly the
  translation that makes it move;
* emits one unnamed structure where the source has no labels, and one structure
  per file where the source is a directory of parts;
* decimates to the triangle budget;
* writes `assets/model.gltf` and, for a moving source, one glTF per frame.

What it deliberately does NOT do:

* **derive or claim an anatomical frame.** No labels means no landmarks means no
  measurable superior or patient-left. The pack declares the source's own axes
  and states in its provenance that they are unverified.
* **fill holes.** `ingest.py` closes what decimation opens, because a tag-group
  boundary is closed by construction and a hole there is damage. A geometry-only
  surface may be genuinely open — a biventricular surface truncated at the valve
  plane is open on purpose — and closing it would fabricate anatomy. Openness is
  MEASURED and reported instead.
* **produce an echo volume or any view.** There are no labels to give acoustic
  properties to, so an echo would be one uniform material, which teaches nothing
  and would claim more than the source supports.
"""
from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

import fast_simplification

from meshlib import (
    Surface,
    read_stl,
    read_obj,
    read_ply,
    read_vtk,
    read_vtu,
    write_gltf,
)
from sources import GeometrySource, PUBLIC_GIT_LICENSE_STATES

REPO = Path(__file__).resolve().parent.parent

#: Derived assets per pack, in bytes. `docs/build_plan.md` budgets 15-20 MB for a
#: full pack including its echo volume; an Explore-only pack is geometry alone,
#: so it is held to the lower end. Exceeding it aborts the ingest rather than
#: committing an oversized pack to a public repository.
GEOMETRY_BUDGET_BYTES = 15_000_000

#: Triangle budget for the whole pack, matching `ingest.py`.
TRIANGLE_BUDGET = 220_000


# --------------------------------------------------------------------------- #
# reading                                                                      #
# --------------------------------------------------------------------------- #

READERS = {
    ".obj": read_obj,
    ".ply": read_ply,
    ".stl": read_stl,
    ".vtk": read_vtk,
    ".vtu": read_vtu,
    ".vtp": read_vtk,
}


def read_surface(path: Path) -> Surface:
    """One surface from any format the geometry path accepts."""
    reader = READERS.get(path.suffix.lower())
    if reader is None:
        raise ValueError(
            f"{path.name}: geometry ingest reads {', '.join(sorted(READERS))}, not "
            f"{path.suffix!r}"
        )
    return reader(path)


def resolve_members(cache_dir: Path, patterns: tuple[str, ...]) -> list[Path]:
    """
    Files to read, in the order the source registry names them.

    Order is the registry's, not the filesystem's: for a moving source the file
    order IS the time axis, and `sorted(glob)` would silently reorder frames
    whose names do not sort the way they were numbered.
    """
    resolved: list[Path] = []
    for pattern in patterns:
        matches = sorted(cache_dir.rglob(pattern))
        if not matches:
            raise SystemExit(f"no file in {cache_dir} matches {pattern!r}")
        resolved.extend(matches)
    return resolved


# --------------------------------------------------------------------------- #
# welding                                                                      #
# --------------------------------------------------------------------------- #


def weld(surface: Surface) -> tuple[Surface, np.ndarray]:
    """
    Drop unreferenced vertices and merge EXACTLY coincident ones.

    Returns the welded surface and the map from old vertex index to new, so a
    keyframed pack can weld every frame through one mapping.

    Both halves are lossless. Dropping a vertex no face references removes
    nothing that renders — a tetrahedral source hands over every point in the
    volume and only its boundary is drawn, which was a third of the STRAUS
    pack's bytes. Merging vertices whose float32 coordinates are BIT-IDENTICAL
    moves no surface: the two vertices are the same point, written twice.

    Exact equality, with no tolerance, deliberately. A tolerance would be a
    judgement about how close is close enough, and a wrong one welds a real gap
    shut. Everything this fixes is an exact duplicate anyway.

    NOT welding was a real defect and it looked like bad source data. BodyParts3D
    OBJs duplicate a vertex per adjacent face along their seams, so unwelded they
    report 1,826 boundary edges and 124 connected components on a surface that is
    actually closed and single-piece — and the free cutter's stencil caps, which
    count front and back faces to decide what is inside, then paint solid over
    the cavities instead of capping the cut. The pack looked like segmentation
    debris. It was this function missing.
    """
    used = np.unique(surface.faces)
    vertices = surface.vertices[used]
    faces = np.searchsorted(used, surface.faces)
    unique, inverse = np.unique(vertices, axis=0, return_inverse=True)

    mapping = np.full(surface.vertex_count, -1, dtype=np.int64)
    mapping[used] = inverse.reshape(-1)
    return (
        Surface(
            name=surface.name,
            vertices=np.ascontiguousarray(unique, dtype=np.float32),
            faces=np.ascontiguousarray(inverse.reshape(-1)[faces], dtype=np.int32),
        ),
        mapping,
    )


def weld_frames(surfaces: list[Surface]) -> tuple[list[Surface], bool]:
    """
    Weld a keyframe sequence, and say whether vertex correspondence survived.

    Correspondence means every frame shares one vertex ordering, so welding each
    frame independently would destroy it: `np.unique` sorts by COORDINATE, and
    the coordinates are exactly what differs between frames.

    Where the frames share connectivity — identical face arrays, which is what a
    deforming mesh has — one mapping derived from frame 0 is valid for all of
    them, and applying it keeps the ordering identical by construction. Where
    they do not, each frame is welded on its own and the caller is told the
    claim no longer holds.
    """
    shared = all(np.array_equal(surfaces[0].faces, other.faces) for other in surfaces[1:])
    if not shared:
        return [weld(surface)[0] for surface in surfaces], False

    welded_first, mapping = weld(surfaces[0])
    welded = [welded_first]
    for surface in surfaces[1:]:
        kept = mapping >= 0
        vertices = np.zeros((int(mapping.max()) + 1, 3), dtype=np.float32)
        # Duplicates of one welded vertex hold the same coordinates in every
        # frame, so writing them all and letting the last win is exact.
        vertices[mapping[kept]] = surface.vertices[kept]
        welded.append(Surface(name=surface.name, vertices=vertices,
                              faces=welded_first.faces))
    return welded, True

# --------------------------------------------------------------------------- #
# units and centring                                                           #
# --------------------------------------------------------------------------- #

#: Plausible span of a whole human heart, in millimetres, generously bounded:
#: a neonatal heart is about 40 mm across and a dilated adult heart with great
#: vessels attached about 250 mm. A model whose largest extent falls in this
#: window is already in millimetres.
HEART_SPAN_MM = (30.0, 400.0)


def unit_scale(extent: np.ndarray) -> tuple[float, str]:
    """
    Factor carrying this model into millimetres, and the reasoning behind it.

    Nothing in an OBJ or an STL states its units, and VTK states them no more
    often. The only evidence available is the size of the thing, so that is what
    is used — and it is REPORTED, not applied silently, because the inference is
    exactly the kind that looks right until the day a model of an isolated valve
    leaflet arrives and gets scaled up by ten.
    """
    span = float(np.max(extent))
    low, high = HEART_SPAN_MM
    for factor, unit in ((1.0, "mm"), (10.0, "cm"), (1000.0, "m"), (0.001, "um")):
        if low <= span * factor <= high:
            reasoning = (
                f"largest extent {span:.4g} source units; read as {unit} because "
                f"{span * factor:.1f} mm falls inside the {low:.0f}-{high:.0f} mm range a "
                "whole heart can plausibly span"
            )
            return factor, reasoning
    raise SystemExit(
        f"cannot infer units: largest extent {span:.4g} is not a whole heart at any of "
        "mm, cm, m or um. Declare the scale in the source registry rather than guessing."
    )


@dataclass
class Placement:
    """The one similarity transform applied to every surface in a pack."""

    scale: float
    #: Subtracted AFTER scaling, in millimetres.
    centre: np.ndarray
    note: str

    def apply(self, surface: Surface) -> Surface:
        return Surface(
            name=surface.name,
            vertices=np.ascontiguousarray(
                surface.vertices.astype(np.float64) * self.scale - self.centre,
                dtype=np.float32,
            ),
            faces=surface.faces,
        )


def measure_placement(surfaces: list[Surface]) -> Placement:
    """
    One scale and one centre for the whole pack, measured over everything.

    Both are deliberately global. Per-part centring would pull a folder of
    separate organ parts into a heap at the origin, and per-FRAME centring would
    remove the bulk translation of a beating heart — which is a component of the
    motion, not an error in it.
    """
    low = np.min([s.vertices.min(axis=0) for s in surfaces], axis=0).astype(np.float64)
    high = np.max([s.vertices.max(axis=0) for s in surfaces], axis=0).astype(np.float64)
    scale, reasoning = unit_scale(high - low)
    centre = (low + high) / 2.0 * scale
    return Placement(
        scale=scale,
        centre=centre,
        note=(
            f"Units normalised to mm ({reasoning}); centred on the bounds of all "
            f"{len(surfaces)} input surface(s) together, a single translation of "
            f"({-centre[0]:.1f}, {-centre[1]:.1f}, {-centre[2]:.1f}) mm."
        ),
    )


# --------------------------------------------------------------------------- #
# measurement                                                                  #
# --------------------------------------------------------------------------- #


def measure(surface: Surface) -> dict[str, int]:
    """
    What is actually wrong with this surface, counted rather than repaired.

    Boundary edges mean the surface is open, which makes the free cutter's
    stencil caps speckle where the cut crosses the opening. That is a real
    limitation of an open source and belongs in the observations, not behind a
    hole-filling pass that would invent a valve plane.
    """
    mesh = trimesh.Trimesh(
        vertices=surface.vertices.astype(np.float64),
        faces=surface.faces.astype(np.int64),
        process=False,
    )
    _, counts = np.unique(mesh.edges_sorted, axis=0, return_counts=True)
    return {
        "vertices": surface.vertex_count,
        "triangles": surface.triangle_count,
        "boundary_edges": int(np.count_nonzero(counts == 1)),
        "nonmanifold_edges": int(np.count_nonzero(counts > 2)),
        "components": component_count(surface),
        "watertight": int(bool(mesh.is_watertight)),
    }


def component_count(surface: Surface) -> int:
    """
    Connected components, counted over the face-adjacency graph.

    Not `trimesh.split`: that pulls in networkx, which this environment does not
    carry, and it FILLS HOLES on each piece as a side effect of deciding whether
    the piece is watertight. Measuring a surface must not modify it — this
    pipeline's whole claim is that it adds nothing — so the count is computed
    directly from the edges instead.

    Faces are the nodes and a shared edge is a link, which matches what a viewer
    actually renders as one piece: two shells touching at a single vertex are two
    pieces to the eye and two pieces here.
    """
    faces = surface.faces.astype(np.int64)
    edges = np.sort(
        np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1
    )
    owner = np.tile(np.arange(len(faces)), 3)
    order = np.lexsort((edges[:, 1], edges[:, 0]))
    edges, owner = edges[order], owner[order]

    # Consecutive equal edges belong to faces that share that edge.
    same = np.all(edges[1:] == edges[:-1], axis=1)
    links = np.flatnonzero(same)
    graph = coo_matrix(
        (np.ones(len(links)), (owner[links], owner[links + 1])),
        shape=(len(faces), len(faces)),
    )
    return int(connected_components(graph, directed=False)[0])


def decimate_to(surfaces: list[Surface], budget: int) -> list[str]:
    """Reduce to a shared triangle budget in place, proportionally, with a floor."""
    total = sum(s.triangle_count for s in surfaces)
    if total <= budget:
        return []
    notes = [f"decimated: {total:,} triangles over the {budget:,} budget"]
    floor = 400
    for index, surface in enumerate(surfaces):
        target = max(floor, int(budget * surface.triangle_count / total))
        if surface.triangle_count <= target or surface.triangle_count <= floor:
            continue
        reduction = min(max(1.0 - target / surface.triangle_count, 0.0), 0.98)
        points, faces = fast_simplification.simplify(
            surface.vertices.astype(np.float32), surface.faces.astype(np.int32), reduction
        )
        surfaces[index] = Surface(
            name=surface.name,
            vertices=np.ascontiguousarray(points, dtype=np.float32),
            faces=np.ascontiguousarray(faces, dtype=np.int32),
        )
    return notes


# --------------------------------------------------------------------------- #
# the pack                                                                     #
# --------------------------------------------------------------------------- #

def slugify(name: str) -> str:
    """A schema `Slug` from a filename: lowercase, and separators collapsed."""
    kept = [character.lower() if character.isalnum() else "-" for character in name]
    slug = "".join(kept).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "surface"


def is_blood_pool(label: str, patterns: tuple[str, ...]) -> bool:
    """Whether a structure is a cast of the lumen rather than tissue."""
    lowered = label.lower()
    return any(pattern.lower() in lowered for pattern in patterns)


def blood_pool_decision(label: str, source: GeometrySource) -> tuple[bool, dict]:
    """
    The blood-pool flag AND the basis it was decided on, for one label.

    Never a default. `pipeline/geometry.py` used to write `blood_pool: False`
    for every structure it emitted, so no geometry-only pack had ever set the
    flag and four solid chamber casts rendered as tissue — and nothing in the
    pack could tell that apart from a pipeline that had looked and said no.
    Returning the reasoning with the answer is what closes that.
    """
    matched = [
        pattern for pattern in source.blood_pool_match
        if pattern.lower() in label.lower()
    ]
    if matched:
        return True, {
            "basis": "label_match",
            "evidence": (
                f"the source's own label {label!r} contains "
                + ", ".join(repr(pattern) for pattern in matched)
                + ", declared for this source as marking a cast of the lumen"
            ),
        }
    return False, {
        "basis": "label_no_match",
        "evidence": (
            f"the source's own label {label!r} matches none of "
            + (", ".join(repr(p) for p in source.blood_pool_match) or "(no cast patterns)")
            + ". " + source.blood_pool_basis
        ),
    }


def topology_block(measured: dict[str, int], slug: str, source: GeometrySource) -> dict:
    """
    One structure's measured topology, with its declaration where it needs one.

    The pipeline REFUSES to write a pack whose surfaces are unclean and
    undeclared, and equally one carrying a declaration for a surface that
    measures clean. Both directions matter: the first ships a defect nobody
    stated, and the second leaves an excuse lying around for a defect that has
    gone, ready to wave through the next one.
    """
    block = {
        "watertight": bool(measured["watertight"]),
        "components": measured["components"],
        "boundary_edges": measured["boundary_edges"],
        "nonmanifold_edges": measured["nonmanifold_edges"],
    }
    clean = (
        block["watertight"]
        and block["components"] == 1
        and block["boundary_edges"] == 0
        and block["nonmanifold_edges"] == 0
    )
    declared = source.open_surfaces.get(slug)
    if not clean and declared is None:
        raise SystemExit(
            f"{source.key}: {slug!r} is not manifold, closed and single-component "
            f"(watertight {block['watertight']}, {block['components']} component(s), "
            f"{block['boundary_edges']} boundary and {block['nonmanifold_edges']} non-manifold "
            "edge(s)) and the source declares no reason. Declare it in "
            "GeometrySource.open_surfaces, with what is actually wrong with it, or fix it."
        )
    if clean and declared is not None:
        raise SystemExit(
            f"{source.key}: {slug!r} declares a reason for being unclean and measures clean. "
            "Remove the declaration: one that outlives its defect is how the next real one "
            "gets waved through."
        )
    if declared is not None:
        block["declared_reason"] = declared
    return block


def group_structures(
    source: GeometrySource,
    cache_dir: Path,
    stems: list[str],
    taken: set[str],
) -> tuple[list[dict], dict[str, str]]:
    """
    The pack's group nodes, and which group each input file belongs to.

    A group is a structure with no mesh: a name in the hierarchy over its
    children. GROUPING COMES FROM THE PACK. This function asks the source for
    its own tree and slugifies it; it knows no anatomy, names no chamber, and a
    source with no `hierarchy` produces no groups at all and a flat list, which
    is every source here but one.
    """
    if source.hierarchy is None:
        return [], {}
    groups, of_stem = source.hierarchy(cache_dir)

    slug_of: dict[str, str] = {}
    for name, _ in groups:
        slug = slugify(name)
        while slug in taken or slug in slug_of.values():
            slug = f"{slug}-group"
        slug_of[name] = slug

    entries = [
        {
            "id": slug_of[name],
            "mesh_node": None,
            "display_label": name,
            "parent": slug_of[parent] if parent else None,
            "identified": True,
            "blood_pool": False,
            "stylized": False,
        }
        for name, parent in groups
    ]
    parent_of_stem = {
        stem: slug_of[name] for stem, name in of_stem.items()
        if stem in set(stems) and name in slug_of
    }
    return entries, parent_of_stem


def explore_pack(
    source: GeometrySource,
    structures: list[tuple[str, str, Surface]],
    entries: list[dict],
    placement: Placement,
    frames: list[tuple[str, str]],
    measurements: dict[str, dict[str, int]],
    correspondence: bool,
) -> dict:
    """
    The pack document for a geometry-only source.

    Everything the pipeline could not establish is stated as not established.
    That is the whole discipline of this function: an Explore-only pack has no
    frame, no labels and often no documentation behind it, and the only thing
    worse than shipping one is shipping one that reads as though it did.
    """
    unlabelled = len(structures) == 1 and structures[0][0] == "surface"

    honesty = [
        "NO ANATOMICAL FRAME. This source carries no chamber labels or tags, so superior, "
        "anterior and patient-left cannot be derived from the geometry and none is claimed. "
        "The declared orientation is the SOURCE's own axis order, unverified, and must be "
        "established at vetting before any clinical use.",
        "EXPLORE-ONLY. There is no labelled echo volume and correspondingly no views: with a "
        "single unlabelled material an echo would be one uniform grey, which would claim more "
        "than this source supports.",
    ]
    if unlabelled:
        honesty.append(
            "UNLABELLED. The source divides into no named parts, so the pack carries one "
            "structure with a generic label rather than an invented anatomical one."
        )
    pools = [label for _, label, _ in structures if is_blood_pool(label, source.blood_pool_match)]
    if pools:
        honesty.append(
            "BLOOD POOL: "
            + ", ".join(pools)
            + ". These are casts of the lumen, not tissue, and the source names them so. The "
            "viewer draws them translucent and cool for the same reason it does on any "
            "cast-and-shell pack: at a cut, a solid cavity cast and a solid wall otherwise "
            "present the same opaque face."
        )
    if source.kept_because:
        honesty.append(source.kept_because)
    if source.license_quote:
        honesty.append(f"LICENCE AS READ AT THE SOURCE: {source.license_quote}")
    honesty.extend(source.known_problems)

    keyframes = None
    if frames:
        keyframes = {
            "frames": [
                {"gltf": asset, "label": label, "phase": round(index / (len(frames) - 1), 6)}
                for index, (asset, label) in enumerate(frames)
            ],
            "loop": source.loop,
            "vertex_correspondence": correspondence,
            "coverage": source.coverage,
        }
        if source.fps is not None:
            keyframes["fps"] = source.fps

    return {
        "meta": {
            "id": source.pack_id,
            "display_name": source.display_name,
            "anatomy": source.anatomy,
            "canonical_variant": source.canonical_variant,
            "pack_version": "0.1.0",
            "schema_version": "0.1",
        },
        "provenance": {
            "creator": source.creator,
            "source": source.source_text,
            "source_url": source.source_url,
            "license": source.license,
            "license_url": source.license_url,
            "license_state": source.license_state,
            "modified": {
                "flag": True,
                "note": (
                    "Ingested by pipeline/geometry.py: surfaces read, "
                    + placement.note
                    + " Decimated for interactive display and exported to glTF. No geometry was "
                    "added, sculpted, filled or invented — in particular no hole was closed, "
                    "because an open surface here is the source's own truncation rather than "
                    "damage. "
                    + " ".join(honesty)
                ),
            },
            "derivation_chain": [
                source.source_url,
                "pipeline/fetch.py (checksum-recorded acquisition)",
                "pipeline/geometry.py (read, unit-normalise, centre, decimate, export)",
            ],
            "vetted": {"status": "draft", "vetters": [], "last_reviewed": None},
        },
        "meshes": {
            "gltf": "assets/model.gltf",
            "structures": entries,
            "canonical_pose": {
                "position": [0.0, 0.0, 0.0],
                "rotation_euler_xyz_deg": [0.0, 0.0, 0.0],
                "scale": 1.0,
            },
            "units": "mm",
            # The source's own axis order, declared as a coherent right-handed
            # frame so the viewer can build a basis, and stated as UNVERIFIED in
            # the provenance note above. Declaring it is not claiming it.
            "orientation": {
                "up": "+y", "anterior": "+z", "patient_left": "+x", "handedness": "right",
            },
            **({"keyframes": keyframes} if keyframes else {}),
        },
        # The model is centred on its own bounds, so the pivot is the origin.
        # No `free_cut`: seeding a cut plane through a model whose axes are
        # unmeasured would open it along an arbitrary direction.
        "interaction": {"pivot": [0.0, 0.0, 0.0]},
        "views": [],
        "display_flags": {
            "pediatric_vertex_convention": True,
            "plax_apex_left_exception": True,
            "dextrocardia_indicator_profile": {"enabled": False, "profile": None},
        },
        # Not a schema field: `volumetric_data` is v0's open slot, and the
        # per-surface measurements are the evidence behind the observations
        # entry for this pack. They travel with the pack so a reader holding
        # only the pack can see what it is made of.
        "volumetric_data": {"geometry_report": measurements},
    }


@dataclass
class GeometryResult:
    source: GeometrySource
    out_dir: Path
    structures: list[str]
    frames: int
    triangles: int
    sizes: dict[str, int]
    measurements: dict[str, dict[str, int]]
    notes: list[str]


def _write_frame(assets: Path, stem: str, surfaces: list[Surface]) -> tuple[str, int]:
    """One glTF plus its own `.bin`. Returns the pack-relative path and byte size."""
    gltf_bytes, bin_bytes = write_gltf(
        assets / f"{stem}.gltf", surfaces, bin_name=f"{stem}.bin"
    )
    return f"assets/{stem}.gltf", gltf_bytes + bin_bytes


def ingest_geometry(source: GeometrySource) -> GeometryResult:
    """Fetch, read, normalise, measure and write one Explore-only pack."""
    from fetch import acquire_files

    cache_dir = acquire_files(source)
    # A source either globs its members by name or brings its own selection.
    # BodyParts3D needs the second: which of its 1,258 files are the heart, and
    # what each is called, are both derived from a table that ships with the
    # data. See `pipeline/bodyparts3d.py`.
    chosen = source.select(cache_dir) if source.select else None
    paths = [path for path, _ in chosen] if chosen else resolve_members(cache_dir, source.members)
    labels = dict(source.part_labels)
    if chosen:
        labels.update({path.stem: label for path, label in chosen})
    notes: list[str] = []
    if chosen:
        notes.append(
            f"{len(chosen)} part(s) selected and named from the source's own concept map, "
            "not from their filenames"
        )

    surfaces = [read_surface(path) for path in paths]
    if source.animated and len(surfaces) < 2:
        raise SystemExit(
            f"{source.key}: declared animated but only {len(surfaces)} file(s) matched"
        )

    before = sum(surface.vertex_count for surface in surfaces)
    if source.animated:
        surfaces, correspondence_held = weld_frames(surfaces)
    else:
        surfaces = [weld(surface)[0] for surface in surfaces]
        correspondence_held = False
    after = sum(surface.vertex_count for surface in surfaces)
    if after != before:
        notes.append(
            f"welded: {before:,} vertices -> {after:,}, dropping unreferenced points and "
            "merging exact duplicates. No surface moved."
        )
    if source.animated and not correspondence_held:
        notes.append(
            "frames do not share connectivity, so each was welded on its own"
        )

    placement = measure_placement(surfaces)
    surfaces = [placement.apply(surface) for surface in surfaces]
    notes.append(placement.note)

    public_repo_eligible = (
        source.public_repo_eligible and source.license_state in PUBLIC_GIT_LICENSE_STATES
    )
    out_root = "public" if public_repo_eligible else "build"
    out_dir = REPO / out_root / "packs" / source.pack_id
    assets = out_dir / "assets"
    assets.mkdir(parents=True, exist_ok=True)

    sizes: dict[str, int] = {}
    decimated = False
    frames: list[tuple[str, str]] = []
    structures: list[tuple[str, str, Surface]] = []
    #: Structure slug -> the input file it came from, so the measurement of a
    #: surface and the structure that carries it cannot drift apart.
    stem_of: dict[str, str] = {}

    if source.animated:
        # One moving structure, and the frames are its geometry over time. Each
        # frame is a whole mesh in its own glTF, and every frame must carry a
        # node named for the structure or the viewer would lose it mid-playback.
        slug = "surface"
        label = source.structure_label
        # PER FRAME, not shared out across frames. Only one frame is on screen
        # at a time, so the budget that matters for interactive display is one
        # frame's — and dividing it by thirty would decimate a 15,000-triangle
        # myocardium down to 7,000 for no rendering benefit at all. The download
        # cost of all the frames together is bounded separately, by the byte
        # budget this function checks before writing anything.
        for index, (path, surface) in enumerate(zip(paths, surfaces)):
            single = [surface]
            reduced = decimate_to(single, TRIANGLE_BUDGET)
            decimated = decimated or bool(reduced)
            notes.extend(f"{path.stem}: {note}" for note in reduced)
            single[0].name = slug
            stem = "model" if index == 0 else f"frame-{index:03d}"
            asset, size = _write_frame(assets, stem, single)
            sizes[stem] = size
            frames.append((asset, path.stem))
            if index == 0:
                structures = [(slug, label, single[0])]
                stem_of[slug] = path.stem
    else:
        # A directory of parts: one structure per input file, named from the
        # file. The source's own filenames are the only naming evidence there
        # is, so they are carried through rather than interpreted.
        notes.extend(decimate_to(surfaces, TRIANGLE_BUDGET))
        seen: set[str] = set()
        for path, surface in zip(paths, surfaces):
            # The id comes from the LABEL where the source gave one, so a pack's
            # structure list reads as anatomy rather than as the source's opaque
            # element numbering. The filename is the fallback, which is what an
            # unnamed folder of parts has.
            label = labels.get(path.stem, path.stem)
            slug = slugify(label)
            while slug in seen:
                slug = f"{slug}-2"
            seen.add(slug)
            surface.name = slug
            structures.append((slug, label, surface))
            stem_of[slug] = path.stem
        asset, size = _write_frame(assets, "model", [s for _, _, s in structures])
        sizes["model"] = size
        assert asset == "assets/model.gltf"

    # MEASURED AFTER DECIMATION, because that is the mesh the pack ships.
    # Simplification is data-dependent and can split a thin structure into two
    # shells or open one, so measuring the surface as read would report the
    # topology of a mesh nobody ever sees. Nothing in the current registry
    # decimates, which is exactly when to move a measurement: the numbers do
    # not change and the guarantee does.
    measurements = {path.stem: measure(surface) for path, surface in zip(paths, surfaces)}

    for pattern in source.blood_pool_match:
        if not any(is_blood_pool(label, (pattern,)) for _, label, _ in structures):
            raise SystemExit(
                f"{source.key}: blood_pool_match {pattern!r} matches no structure label. "
                "The source's labels have moved; fix the pattern rather than shipping a pack "
                "whose lumen reads as tissue."
            )
    pooled = sum(1 for _, label, _ in structures
                 if is_blood_pool(label, source.blood_pool_match))
    if pooled:
        notes.append(f"{pooled} structure(s) marked blood pool from the source's own labels")

    sizes["assets"] = sum(value for key, value in sizes.items() if key != "assets")

    # `vertex_correspondence` is a claim about the PACK, not about the source.
    # Quadric simplification is data-dependent, so decimating frames
    # independently destroys any correspondence they arrived with — and a pack
    # that kept claiming it would be telling a future deformation-field
    # derivation that it can do something it cannot.
    correspondence = source.vertex_correspondence and correspondence_held and not decimated
    if source.vertex_correspondence and not correspondence:
        notes.append(
            "vertex_correspondence WITHDRAWN: "
            + ("frames were decimated independently, which does not preserve vertex count "
               "or ordering" if decimated
               else "frames do not share connectivity, so one weld mapping does not apply "
                    "to all of them")
        )

    # Groups first, because a parent read before its children reads as a tree.
    unlabelled = len(structures) == 1 and structures[0][0] == "surface"
    slugs = {slug for slug, _, _ in structures}
    groups, group_of_stem = group_structures(source, cache_dir, list(stem_of.values()), slugs)
    entries: list[dict] = list(groups)
    for slug, label, _ in structures:
        stem = stem_of[slug]
        pool, decision = blood_pool_decision(label, source)
        entries.append({
            "id": slug,
            "mesh_node": slug,
            "display_label": label,
            "parent": group_of_stem.get(stem),
            # A source that divides into no named parts has identified nothing:
            # its one structure is "the surface", which is a description of the
            # file rather than a reading of the anatomy. Everything else here is
            # named from the source's own labels or concept map.
            "identified": not unlabelled,
            "blood_pool": pool,
            "blood_pool_decision": decision,
            "topology": topology_block(measurements[stem], slug, source),
            "stylized": False,
        })
    stale = set(source.open_surfaces) - slugs
    if stale:
        raise SystemExit(
            f"{source.key}: open_surfaces declares {sorted(stale)}, which this pack does not "
            "contain. A declaration naming nothing is a declaration nobody is checking."
        )
    if groups:
        notes.append(
            f"{len(groups)} group(s) derived from the source's own concept map, over "
            f"{len(group_of_stem)} of {len(structures)} structures"
        )

    pack = explore_pack(
        source, structures, entries, placement, frames, measurements, correspondence,
    )
    (out_dir / "pack.json").write_text(json.dumps(pack, indent=2) + "\n")
    sizes["pack_json"] = len((out_dir / "pack.json").read_bytes())

    total = sizes["assets"] + sizes["pack_json"]
    if total > GEOMETRY_BUDGET_BYTES:
        raise SystemExit(
            f"{source.key}: derived assets are {total / 1e6:.1f} MB, over the "
            f"{GEOMETRY_BUDGET_BYTES / 1e6:.0f} MB per-pack budget. Nothing has been committed; "
            "reduce the triangle budget or the number of parts."
        )

    return GeometryResult(
        source=source,
        out_dir=out_dir,
        structures=[slug for slug, _, _ in structures],
        frames=len(frames),
        triangles=sum(surface.triangle_count for surface in surfaces),
        sizes=sizes,
        measurements=measurements,
        notes=notes,
    )


def report(result: GeometryResult) -> None:
    source = result.source
    relative_output = result.out_dir.relative_to(REPO)
    in_public_repo = relative_output.parts[0] == "public"
    print(f"\n{'=' * 78}\n{source.display_name}\n{'=' * 78}")
    print(f"  pack id           {source.pack_id}")
    print(f"  licence           {source.license} ({source.license_state})")
    print(f"  public Git output {'yes' if in_public_repo else 'NO'} -> {relative_output}")
    print("  Pages             NO (Explore-only research pack)")
    print(f"  structures        {len(result.structures)}: {', '.join(result.structures)}")
    print(f"  frames            {result.frames or 'static'}")
    print(f"  triangles         {result.triangles:,}")
    print(f"  size on disk      {result.sizes['assets'] / 1e6:.2f} MB of assets "
          f"+ {result.sizes['pack_json'] / 1e3:.1f} kB pack.json")
    print("  per-input measurements:")
    for name, values in result.measurements.items():
        print(f"    - {name:24s} {values['vertices']:>7,} v  {values['triangles']:>7,} t  "
              f"{values['components']:>4} components  "
              f"{values['boundary_edges']:>6} boundary edges  "
              f"{'watertight' if values['watertight'] else 'OPEN'}")
    for note in result.notes:
        print(f"  note: {note}")
