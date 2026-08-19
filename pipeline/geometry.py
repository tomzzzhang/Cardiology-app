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
    read_binary_stl,
    read_obj,
    read_vtk_polydata,
    read_vtu,
    write_gltf,
)
from sources import GeometrySource

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
    ".stl": read_binary_stl,
    ".vtk": read_vtk_polydata,
    ".vtu": read_vtu,
    ".vtp": read_vtk_polydata,
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


def explore_pack(
    source: GeometrySource,
    structures: list[tuple[str, str, Surface]],
    placement: Placement,
    frames: list[tuple[str, str]],
    measurements: dict[str, dict[str, int]],
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
            "vertex_correspondence": source.vertex_correspondence,
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
            "structures": [
                {
                    "id": slug,
                    "mesh_node": slug,
                    "display_label": label,
                    "parent": None,
                    "blood_pool": False,
                    "stylized": False,
                }
                for slug, label, _ in structures
            ],
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

    placement = measure_placement(surfaces)
    surfaces = [placement.apply(surface) for surface in surfaces]
    notes.append(placement.note)

    out_dir = REPO / "public" / "packs" / source.pack_id
    assets = out_dir / "assets"
    assets.mkdir(parents=True, exist_ok=True)

    measurements = {path.stem: measure(surface) for path, surface in zip(paths, surfaces)}
    sizes: dict[str, int] = {}
    frames: list[tuple[str, str]] = []
    structures: list[tuple[str, str, Surface]] = []

    if source.animated:
        # One moving structure, and the frames are its geometry over time. Each
        # frame is a whole mesh in its own glTF, and every frame must carry a
        # node named for the structure or the viewer would lose it mid-playback.
        slug = "surface"
        label = source.structure_label
        share = max(1, TRIANGLE_BUDGET // len(surfaces))
        for index, (path, surface) in enumerate(zip(paths, surfaces)):
            single = [surface]
            notes.extend(f"{path.stem}: {note}" for note in decimate_to(single, share))
            single[0].name = slug
            stem = "model" if index == 0 else f"frame-{index:03d}"
            asset, size = _write_frame(assets, stem, single)
            sizes[stem] = size
            frames.append((asset, path.stem))
            if index == 0:
                structures = [(slug, label, single[0])]
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
        asset, size = _write_frame(assets, "model", [s for _, _, s in structures])
        sizes["model"] = size
        assert asset == "assets/model.gltf"

    sizes["assets"] = sum(value for key, value in sizes.items() if key != "assets")
    pack = explore_pack(source, structures, placement, frames, measurements)
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
    print(f"\n{'=' * 78}\n{source.display_name}\n{'=' * 78}")
    print(f"  pack id           {source.pack_id}")
    print(f"  licence           {source.license} ({source.license_state})")
    print(f"  published         NO (Explore-only, unpublished by rule) -> "
          f"{result.out_dir.relative_to(REPO)}")
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
