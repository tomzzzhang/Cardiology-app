"""
Can the Visible Heart Laboratories heart0102 mesh be partitioned per chamber?

EXPERIMENT, not pipeline. Nothing here is imported by `ingest.py` and nothing
here writes to a published pack. It exists to answer one question the
2026-08-19 substrate rejection left open: the two recorded defects — no
per-chamber structures, and 1,026 connected components of debris — are they
solvable, or are they properties of the source that no processing recovers?

The answer this module measures is: the debris is trivially solvable, and the
chambers ARE present as space but do not separate into six labelled parts
without a step this module stops short of. They are not two defects of equal
weight. See `output/vhl-partition/NOTES.md`.

TWO WRONG ANSWERS THIS MODULE GAVE ON THE WAY, written down because both look
right and both are reachable again from a small edit.

The first: seal the valve orifices with a 5 mm CLOSING and measure the space it
encloses. That reports the chambers as packed solid — a largest inscribed sphere
of 4.6 mm against the ~20 mm a 14-year-old left ventricle should admit — and the
figure holds under a doubling of resolution, so it passes the obvious check and
reads as conclusive. It is an artefact of the radius. The orifices are 20-25 mm
across, a 5 mm ball never bridges them, and the space measured is not chamber at
all but the film of interstices between trabeculae, with the lumen left outside
the envelope and silently dropped.

The second, and subtler: raise the radius but keep using a closing. A closing
fills gaps SMALLER than its ball and leaves anything wider open, so no radius
makes it enclose a ventricle — push the radius up and it swallows the space
around the heart before it ever encloses the space inside it. At a 12 mm seal
this keeps 268 mL of interstitial film while dropping 161 mL of real lumen, in
four pieces of 13-18 mm inscribed radius, which is precisely the anatomy being
looked for. The fix is `epicardial_envelope`: dilate, FILL HOLES, erode back.
That recovers 425 mL of connected chamber lumen at 17.75 mm inscribed radius.

What both share: a plausible number, produced by an operator quietly measuring
something other than what it was named for. `cavity_report.seal_radius_mm` is
therefore recorded beside every figure it produces, and the cross-section render
exists because it exposed both errors at a glance when the numbers did not.

Method, and why each step is here rather than the obvious alternative:

* **Components are counted on the SOURCE STL, not the shipped pack.** The pack
  ships a decimated mesh; decimation merges and deletes small shells, so it
  reports 343 components where the source has 1,026. Only the source number is
  comparable to the rejection note. `geometry.component_count` is called rather
  than reimplemented so the figure is the repository's own definition of a
  component (faces are nodes, a shared EDGE is a link).

* **Cavities are sought volumetrically, not on the surface.** The chambers are
  not modelled as objects, so there is nothing to select. If they exist at all
  they exist as space, which makes a voxel grid the natural place to look.

* **Voxelisation is ray parity, matching `ingest.voxelize_surfaces`.** Parity is
  exact for a watertight, consistently wound surface and — unlike a flood fill
  from outside — excludes nested cavities correctly regardless of how the
  cavity's normals are wound. The source is watertight with zero boundary and
  zero non-manifold edges, so parity is exact here and reports zero odd
  scanlines. It is reimplemented rather than imported because `ingest`'s version
  is bound to a `Structure` list and a fixed resolution, and the resolution
  sweep is the whole point of `cavity_report`.

* **The largest inscribed sphere is the shape measurement, but it is only
  meaningful once the seal radius is right.** Volume alone cannot distinguish
  "one open chamber" from "the same space packed with filaments", because both
  hold a similar number of empty voxels; the radius of the largest ball that
  fits does distinguish them. It is resolution-stable, which a component count
  is not — but it is NOT seal-radius-stable, and that is the trap described
  above. Read it together with `seal_radius_mm`, never alone.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy import ndimage

#: 6-connectivity. Face-sharing only: two voxels touching at a corner are not
#: one cavity, for the same reason two shells touching at a vertex are not one
#: component in `geometry.component_count`.
FACE_CONNECTED = ndimage.generate_binary_structure(3, 1)


# --------------------------------------------------------------------------- #
# voxelisation                                                                 #
# --------------------------------------------------------------------------- #


@dataclass
class Grid:
    """A binary occupancy grid and the frame that places it in model space."""

    mask: np.ndarray      # (N, N, N) bool
    origin: np.ndarray    # (3,) float64, model-space corner of voxel (0,0,0)
    pitch: float          # mm per voxel
    odd_scanlines: int    # rays with an odd hit count; >0 means a leaky surface

    @property
    def voxel_mm3(self) -> float:
        return float(self.pitch ** 3)

    def volume_mm3(self, mask: np.ndarray | None = None) -> float:
        m = self.mask if mask is None else mask
        return float(m.sum()) * self.voxel_mm3


def voxelise(vertices: np.ndarray, faces: np.ndarray, resolution: int,
             pad_mm: float = 2.0) -> Grid:
    """
    Fill a triangle surface by ray parity along `+x`, vectorised over triangles.

    Same algorithm as `ingest.voxelize_surfaces`, which walks rays with
    trimesh's ray engine one structure at a time. Here every triangle is
    rasterised into the `(y, z)` columns it covers at once, which is what makes
    a 384^3 sweep affordable enough to check that a result is not a resolution
    artefact.

    `odd_scanlines` is returned rather than raised on: a nonzero count means the
    surface is locally open or self-intersecting and the fill under-reports
    there. On this source it is zero at every resolution tried.
    """
    vertices = np.asarray(vertices, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int64)

    low = vertices.min(axis=0) - pad_mm
    high = vertices.max(axis=0) + pad_mm
    pitch = float((high - low).max() / resolution)
    origin = low

    a, b, c = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]

    def span(axis: int) -> tuple[np.ndarray, np.ndarray]:
        lo = np.minimum(np.minimum(a[:, axis], b[:, axis]), c[:, axis])
        hi = np.maximum(np.maximum(a[:, axis], b[:, axis]), c[:, axis])
        first = np.maximum(np.ceil((lo - origin[axis]) / pitch - 0.5), 0)
        last = np.minimum(np.floor((hi - origin[axis]) / pitch - 0.5), resolution - 1)
        return first.astype(np.int64), last.astype(np.int64)

    y_first, y_last = span(1)
    z_first, z_last = span(2)
    ny = np.maximum(y_last - y_first + 1, 0)
    nz = np.maximum(z_last - z_first + 1, 0)
    per_triangle = ny * nz
    covers = per_triangle > 0

    triangle = np.repeat(np.flatnonzero(covers), per_triangle[covers])
    counts = per_triangle[covers]
    offset = np.arange(int(counts.sum())) - np.repeat(np.cumsum(counts) - counts, counts)
    nz_run = np.repeat(nz[covers], counts)
    column_y = np.repeat(y_first[covers], counts) + offset // nz_run
    column_z = np.repeat(z_first[covers], counts) + offset % nz_run

    sample_y = origin[1] + (column_y + 0.5) * pitch
    sample_z = origin[2] + (column_z + 0.5) * pitch

    a0, a1, a2 = a[triangle], b[triangle], c[triangle]
    e1y, e1z = a1[:, 1] - a0[:, 1], a1[:, 2] - a0[:, 2]
    e2y, e2z = a2[:, 1] - a0[:, 1], a2[:, 2] - a0[:, 2]
    determinant = e1y * e2z - e2y * e1z
    usable = np.abs(determinant) > 1e-12
    safe = np.where(usable, determinant, 1.0)
    ry, rz = sample_y - a0[:, 1], sample_z - a0[:, 2]
    u = np.where(usable, (ry * e2z - rz * e2y) / safe, -1.0)
    v = np.where(usable, (rz * e1y - ry * e1z) / safe, -1.0)
    hit = usable & (u >= 0.0) & (v >= 0.0) & (u + v <= 1.0)

    triangle, column_y, column_z = triangle[hit], column_y[hit], column_z[hit]
    u, v = u[hit], v[hit]
    a0, a1, a2 = a[triangle], b[triangle], c[triangle]
    crossing_x = a0[:, 0] + u * (a1[:, 0] - a0[:, 0]) + v * (a2[:, 0] - a0[:, 0])

    column = column_y * resolution + column_z
    order = np.lexsort((crossing_x, column))
    column, crossing_x = column[order], crossing_x[order]

    mask = np.zeros((resolution, resolution, resolution), dtype=bool)
    odd = 0
    if column.size:
        breaks = np.flatnonzero(np.diff(column)) + 1
        for ids, xs in zip(np.split(column, breaks), np.split(crossing_x, breaks)):
            if xs.size % 2:
                odd += 1
                continue
            iy, iz = divmod(int(ids[0]), resolution)
            starts = np.ceil((xs[0::2] - origin[0]) / pitch - 0.5).astype(int)
            stops = np.floor((xs[1::2] - origin[0]) / pitch - 0.5).astype(int)
            for begin, end in zip(starts, stops):
                if end >= begin:
                    mask[max(begin, 0):end + 1, iy, iz] = True

    return Grid(mask=mask, origin=origin, pitch=pitch, odd_scanlines=odd)


# --------------------------------------------------------------------------- #
# morphology, by exact Euclidean ball                                          #
# --------------------------------------------------------------------------- #
#
# `ndimage.binary_erosion` with a ball structuring element is O(r^3) per voxel
# and approximates the ball by its voxelisation. A distance transform gives the
# exact Euclidean result in two O(n) passes at any radius, which matters because
# the radii swept here run to 12 mm — a 31-voxel-wide element at this pitch.


def erode(mask: np.ndarray, radius_mm: float, pitch: float) -> np.ndarray:
    return (ndimage.distance_transform_edt(mask) * pitch) > radius_mm


def dilate(mask: np.ndarray, radius_mm: float, pitch: float) -> np.ndarray:
    return (ndimage.distance_transform_edt(~mask) * pitch) <= radius_mm


def opening(mask: np.ndarray, radius_mm: float, pitch: float) -> np.ndarray:
    """Erode then dilate: deletes structures thinner than `2 * radius_mm`."""
    eroded = erode(mask, radius_mm, pitch)
    if not eroded.any():
        return np.zeros_like(mask)
    return dilate(eroded, radius_mm, pitch)


def closing(mask: np.ndarray, radius_mm: float, pitch: float) -> np.ndarray:
    """Dilate then erode: seals gaps narrower than `2 * radius_mm`."""
    return erode(dilate(mask, radius_mm, pitch), radius_mm, pitch)


def epicardial_envelope(mask: np.ndarray, radius_mm: float, pitch: float) -> np.ndarray:
    """
    Everything inside the epicardium: dilate to seal the orifices, fill, shrink back.

    NOT a closing, and the distinction is the second trap in this module. A
    closing fills gaps SMALLER than its ball and leaves anything wider open, so
    on a heart it seals the trabecular interstices and pointedly does not seal a
    ventricle — the lumen stays outside the envelope and vanishes from every
    figure computed against it. Measured here at a 12 mm seal, a closing keeps
    268 mL of interstitial film and drops 161 mL of actual chamber lumen sitting
    in four pieces of 13-18 mm inscribed radius.

    Dilating first joins the orifice lips, `binary_fill_holes` then makes the
    whole heart solid because the lumen is no longer connected to the outside,
    and eroding by the same radius returns the boundary to the epicardial
    surface. `| mask` guards the erosion against nibbling at genuinely thin
    tissue. `radius_mm` must exceed half the widest orifice; recovered cavity
    volume flattening as the radius grows is the signature that it does.
    """
    dilated = dilate(mask, radius_mm, pitch)
    return erode(ndimage.binary_fill_holes(dilated), radius_mm, pitch) | mask


def inscribed_radius_mm(mask: np.ndarray, pitch: float) -> float:
    """Radius of the largest ball wholly inside `mask`."""
    if not mask.any():
        return 0.0
    return float(ndimage.distance_transform_edt(mask).max() * pitch)


def components(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Face-connected components, and their voxel counts indexed by label."""
    labels, count = ndimage.label(mask, structure=FACE_CONNECTED)
    if count == 0:
        return labels, np.zeros(1, dtype=np.int64)
    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    sizes[0] = 0
    return labels, sizes


def interior_components(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Components of `mask` that do not touch the grid border.

    The border test is what separates a genuine enclosed cavity from the
    unbounded outside, and it is the test that fails on this source: the chamber
    space reaches the border, through the open valve orifices, so it is not an
    interior component at all.
    """
    labels, sizes = components(mask)
    touching = np.unique(np.concatenate([
        labels[0].ravel(), labels[-1].ravel(),
        labels[:, 0].ravel(), labels[:, -1].ravel(),
        labels[:, :, 0].ravel(), labels[:, :, -1].ravel(),
    ]))
    sizes = sizes.copy()
    for label in touching:
        if label:
            sizes[label] = 0
    return labels, sizes


# --------------------------------------------------------------------------- #
# surface-side debris analysis                                                 #
# --------------------------------------------------------------------------- #


@dataclass
class DebrisReport:
    """Per-component mass of a surface, and where the threshold sits."""

    component_count: int
    triangles: np.ndarray      # per component
    signed_volume_mm3: np.ndarray
    keep_label: int
    #: |volume| of the largest component divided by that of the second.
    separation_ratio: float
    negative_components: int
    notes: list[str] = field(default_factory=list)

    def kept_fraction(self) -> tuple[float, float]:
        total_tri = float(self.triangles.sum())
        total_vol = float(np.abs(self.signed_volume_mm3).sum())
        return (
            float(self.triangles[self.keep_label]) / total_tri,
            float(abs(self.signed_volume_mm3[self.keep_label])) / total_vol,
        )


def face_component_labels(faces: np.ndarray) -> tuple[np.ndarray, int]:
    """
    Label faces by connected component over the shared-EDGE graph.

    Deliberately the same graph as `geometry.component_count`, which returns
    only a count. The labels are needed to weigh each component, and
    reimplementing the graph rather than importing keeps this module from
    depending on a private detail of a file it must not modify.
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components as sparse_components

    faces = np.asarray(faces, dtype=np.int64)
    edges = np.sort(np.concatenate(
        [faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1)
    owner = np.tile(np.arange(len(faces)), 3)
    order = np.lexsort((edges[:, 1], edges[:, 0]))
    edges, owner = edges[order], owner[order]
    shared = np.flatnonzero(np.all(edges[1:] == edges[:-1], axis=1))
    graph = coo_matrix(
        (np.ones(len(shared)), (owner[shared], owner[shared + 1])),
        shape=(len(faces), len(faces)),
    )
    count, labels = sparse_components(graph, directed=False)
    return labels, int(count)


def analyse_debris(vertices: np.ndarray, faces: np.ndarray) -> DebrisReport:
    """
    Weigh every connected component of a surface by enclosed signed volume.

    Signed volume, not triangle count, because the sign is itself the finding:
    a closed shell wound outward encloses positive volume, one wound inward is a
    bubble in the material. On this source exactly one component is positive and
    1,025 are negative, which says the debris is interior voids rather than
    floating islands — a distinction a triangle count cannot make.
    """
    vertices = np.asarray(vertices, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int64)
    labels, count = face_component_labels(faces)

    v0, v1, v2 = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    tetra = np.einsum("ij,ij->i", v0, np.cross(v1, v2)) / 6.0

    triangles = np.bincount(labels, minlength=count)
    volume = np.bincount(labels, weights=tetra, minlength=count)

    magnitude = np.abs(volume)
    ranked = np.argsort(-magnitude)
    keep = int(ranked[0])
    ratio = float(magnitude[ranked[0]] / magnitude[ranked[1]]) if count > 1 else float("inf")

    return DebrisReport(
        component_count=count,
        triangles=triangles,
        signed_volume_mm3=volume,
        keep_label=keep,
        separation_ratio=ratio,
        negative_components=int((volume < 0).sum()),
    )


def strip_debris(vertices: np.ndarray, faces: np.ndarray,
                 report: DebrisReport) -> tuple[np.ndarray, np.ndarray]:
    """Keep only the component the report nominates, and drop orphan vertices."""
    labels, _ = face_component_labels(faces)
    kept = np.asarray(faces)[labels == report.keep_label]
    used = np.unique(kept)
    remap = np.full(len(vertices), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return np.asarray(vertices)[used], remap[kept]


# --------------------------------------------------------------------------- #
# the partition attempt                                                        #
# --------------------------------------------------------------------------- #


@dataclass
class CavityReport:
    """What the empty space inside the epicardial envelope actually looks like."""

    resolution: int
    pitch_mm: float
    #: Recorded beside every figure below. None of them mean anything without it.
    seal_radius_mm: float
    tissue_mm3: float
    envelope_mm3: float
    cavity_mm3: float
    cavity_components: int
    largest_cavity_mm3: float
    #: THE number. Radius of the largest ball that fits anywhere in the cavity.
    largest_inscribed_radius_mm: float
    interior_void_count: int
    interior_void_mm3: float
    largest_interior_void_mm3: float


def cavity_report(grid: Grid, seal_radius_mm: float = 12.0) -> CavityReport:
    """
    Look for chamber cavities, two ways, and measure how open whatever is found is.

    `interior_*` counts genuinely enclosed voids — what a chamber would be if
    the model closed its valve orifices. On this source that count is ~1 mL of
    trabecular bubbles and NOTHING else, because the orifices are open: the
    chambers are continuous with the outside, so no chamber is an enclosed void.
    That is a fact about the model, not a measurement of the chambers.

    `cavity_*` is the one that sees chambers, by sealing the orifices with a
    closing of `seal_radius_mm` first. The radius must EXCEED the orifice
    radius, or the seal does not close and the chambers stay outside the
    envelope while the interstitial film between trabeculae is measured in their
    place — see the module docstring. At 12 mm this recovers ~270 mL of chamber
    space; at 5 mm it recovers 113 mL that is not chamber at all.
    """
    tissue = grid.mask
    pitch = grid.pitch

    _, interior_sizes = interior_components(~tissue)
    interior_live = interior_sizes[interior_sizes > 0]

    envelope = epicardial_envelope(tissue, seal_radius_mm, pitch)
    cavity = envelope & ~tissue
    _, cavity_sizes = components(cavity)
    cavity_live = cavity_sizes[cavity_sizes > 0]

    return CavityReport(
        resolution=int(tissue.shape[0]),
        pitch_mm=pitch,
        seal_radius_mm=seal_radius_mm,
        tissue_mm3=grid.volume_mm3(tissue),
        envelope_mm3=grid.volume_mm3(envelope),
        cavity_mm3=grid.volume_mm3(cavity),
        cavity_components=int(cavity_live.size),
        largest_cavity_mm3=float(cavity_live.max()) * grid.voxel_mm3 if cavity_live.size else 0.0,
        largest_inscribed_radius_mm=inscribed_radius_mm(cavity, pitch),
        interior_void_count=int(interior_live.size),
        interior_void_mm3=float(interior_live.sum()) * grid.voxel_mm3,
        largest_interior_void_mm3=float(interior_live.max()) * grid.voxel_mm3 if interior_live.size else 0.0,
    )


def chamber_cavity(grid: Grid, seal_radius_mm: float = 12.0,
                   bridge_radius_mm: float = 2.0) -> np.ndarray:
    """
    The connected chamber space: seal the orifices, take the largest cavity,
    then bridge across trabeculae.

    `bridge_radius_mm` is a closing applied to the CAVITY, not the tissue. Without
    it the distance transform of the chamber space measures the gaps between
    trabeculae rather than the lumen those trabeculae sit in, and every seed
    lands on a filament interstice. Bridging at 2 mm joins the lumen across
    filaments thinner than 4 mm while leaving the septum — which is many times
    that — intact.
    """
    envelope = epicardial_envelope(grid.mask, seal_radius_mm, grid.pitch)
    labels, sizes = components(envelope & ~grid.mask)
    if not sizes.any():
        return np.zeros_like(grid.mask)
    merged = labels == int(np.argmax(sizes))
    if bridge_radius_mm > 0:
        merged = closing(merged, bridge_radius_mm, grid.pitch) & ~grid.mask
    return merged


def chamber_core_sweep(grid: Grid, seal_radius_mm: float,
                       thresholds_mm: np.ndarray,
                       bridge_radius_mm: float = 2.0) -> list[dict]:
    """
    Look for chamber-sized lobes in the chamber space, at every scale.

    This is the seed-finding half of a marker watershed. If N chambers are
    present as lobes joined at narrow valve necks, then thresholding the
    cavity's distance transform must, at SOME height, cut the necks and leave N
    cores of chamber scale. Whatever this sweep finds bounds what any watershed
    built on it could produce.

    What it finds on this source is TWO cores, stable in count and roughly equal
    in size across thresholds from 4 mm to 9 mm — almost certainly the two
    ventricles. It does not find four, because the atrioventricular orifices are
    modelled open and each atrium stays continuous with its ventricle. Splitting
    those needs a cut plane, which is a different kind of evidence from a
    distance maximum, and this module does not invent one.
    """
    merged = chamber_cavity(grid, seal_radius_mm, bridge_radius_mm)
    if not merged.any():
        return []
    distance = ndimage.distance_transform_edt(merged) * grid.pitch

    rows: list[dict] = []
    for threshold in thresholds_mm:
        core_labels, core_count = ndimage.label(distance >= threshold, structure=FACE_CONNECTED)
        if core_count == 0:
            break
        core_sizes = np.bincount(core_labels.ravel())[1:] * grid.voxel_mm3
        core_sizes = np.sort(core_sizes)[::-1]
        rows.append({
            "threshold_mm": round(float(threshold), 2),
            "cores": int(core_count),
            "cores_over_5ml": int((core_sizes > 5000.0).sum()),
            "largest_cores_ml": [round(float(s) / 1000.0, 2) for s in core_sizes[:6]],
        })
    return rows


# --------------------------------------------------------------------------- #
# rendering                                                                    #
# --------------------------------------------------------------------------- #
#
# Written by hand because the pipeline environment carries neither matplotlib
# nor Pillow, and a diagnostic image is not worth widening `environment.yml`
# for. A PNG is a zlib stream of filter-prefixed scanlines inside three chunks;
# that is little enough code to be cheaper than the dependency.

#: Colour per anatomy tag, for whenever a partition does become possible. The
#: keys are `anatomy.CHAMBER_TAGS`; the palette is chosen for a light
#: background, keeping left-heart structures warm and right-heart cool so a
#: mislabelled side is visible at a glance rather than only on inspection.
TAG_COLOURS: dict[int, tuple[int, int, int]] = {
    1: (198, 40, 40),    # LV     deep red
    2: (21, 101, 192),   # RV     deep blue
    3: (239, 108, 0),    # LA     orange
    4: (2, 136, 209),    # RA     light blue
    5: (123, 31, 162),   # aorta  purple
    6: (0, 137, 123),    # PA     teal
}

TISSUE_COLOUR = (188, 44, 44)
CAVITY_COLOUR = (40, 96, 200)
ENVELOPE_COLOUR = (232, 232, 236)
BACKGROUND_COLOUR = (255, 255, 255)


def write_png(path: Path, rgb: np.ndarray) -> None:
    """Write an (H, W, 3) uint8 array as a PNG."""
    import struct
    import zlib

    height, width, _ = rgb.shape
    raw = np.hstack([
        np.zeros((height, 1), dtype=np.uint8),          # filter byte 0 per row
        rgb.reshape(height, width * 3).astype(np.uint8),
    ]).tobytes()

    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def slice_panel(grid: Grid, cavity: np.ndarray, envelope: np.ndarray,
                fractions: tuple[float, ...] = (0.35, 0.45, 0.55, 0.65),
                scale: int = 2) -> np.ndarray:
    """
    A grid of orthogonal cross-sections: rows are axes, columns are positions.

    Cross-sections rather than a surface render on purpose. The finding is about
    what is INSIDE the tissue, and an exterior view of this model looks like a
    perfectly ordinary heart — the whole point is that the defect is invisible
    from outside.
    """
    tiles: list[list[np.ndarray]] = []
    for axis in (0, 1, 2):
        row: list[np.ndarray] = []
        for fraction in fractions:
            index = int(grid.mask.shape[axis] * fraction)
            tissue_slice = np.take(grid.mask, index, axis=axis)
            cavity_slice = np.take(cavity, index, axis=axis)
            envelope_slice = np.take(envelope, index, axis=axis)

            image = np.zeros(tissue_slice.shape + (3,), dtype=np.uint8)
            image[...] = BACKGROUND_COLOUR
            image[envelope_slice] = ENVELOPE_COLOUR
            image[cavity_slice] = CAVITY_COLOUR
            image[tissue_slice] = TISSUE_COLOUR
            row.append(np.kron(image, np.ones((scale, scale, 1), dtype=np.uint8)))
        tiles.append(row)

    gap = 4
    tile_h, tile_w = tiles[0][0].shape[:2]
    height = len(tiles) * tile_h + (len(tiles) - 1) * gap
    width = len(fractions) * tile_w + (len(fractions) - 1) * gap
    canvas = np.full((height, width, 3), 245, dtype=np.uint8)
    for r, row in enumerate(tiles):
        for c, tile in enumerate(row):
            y, x = r * (tile_h + gap), c * (tile_w + gap)
            canvas[y:y + tile_h, x:x + tile_w] = tile
    return canvas


#: Distinct hues for whatever regions a partition step produces, in order.
#: Deliberately NOT `TAG_COLOURS`: these regions are unidentified until an
#: anatomical frame names them, and colouring an unnamed region left-ventricle
#: red would be the first step towards believing it is the left ventricle.
REGION_COLOURS: list[tuple[int, int, int]] = [
    (216, 27, 96), (30, 136, 229), (255, 179, 0), (0, 137, 123),
    (142, 36, 170), (109, 76, 65), (84, 110, 122), (192, 202, 51),
]


def region_panel(grid: Grid, regions: np.ndarray,
                 fractions: tuple[float, ...] = (0.35, 0.45, 0.55, 0.65),
                 scale: int = 2) -> np.ndarray:
    """
    Cross-sections with each labelled region in its own colour over grey tissue.

    `regions` is an integer label volume, 0 for unlabelled.
    """
    tiles: list[list[np.ndarray]] = []
    for axis in (0, 1, 2):
        row: list[np.ndarray] = []
        for fraction in fractions:
            index = int(grid.mask.shape[axis] * fraction)
            tissue_slice = np.take(grid.mask, index, axis=axis)
            region_slice = np.take(regions, index, axis=axis)

            image = np.full(tissue_slice.shape + (3,), 255, dtype=np.uint8)
            image[tissue_slice] = (170, 170, 176)
            for label in np.unique(region_slice):
                if label:
                    colour = REGION_COLOURS[(int(label) - 1) % len(REGION_COLOURS)]
                    image[region_slice == label] = colour
            row.append(np.kron(image, np.ones((scale, scale, 1), dtype=np.uint8)))
        tiles.append(row)

    gap = 4
    tile_h, tile_w = tiles[0][0].shape[:2]
    canvas = np.full((len(tiles) * tile_h + (len(tiles) - 1) * gap,
                      len(fractions) * tile_w + (len(fractions) - 1) * gap, 3), 245, np.uint8)
    for r, row in enumerate(tiles):
        for c, tile in enumerate(row):
            canvas[r * (tile_h + gap):r * (tile_h + gap) + tile_h,
                   c * (tile_w + gap):c * (tile_w + gap) + tile_w] = tile
    return canvas


# --------------------------------------------------------------------------- #
# driver                                                                       #
# --------------------------------------------------------------------------- #

#: Where `fetch.py` leaves the source. Gitignored and NOT redistributable: the
#: model is CC BY-NC 4.0, so it stays out of the repository and only measurements
#: derived from it are committed.
SOURCE_RELATIVE = Path("pipeline/.cache/vhl/Heart102_Tissue.stl")

#: A ball this radius seals the valve orifices. It MUST exceed the orifice
#: radius or the seal silently fails — see the module docstring. The orifices
#: here are ~20-25 mm across, and the sweep in NOTES.md shows recovered chamber
#: volume climbing steeply to 12 mm and flattening after, which is the signature
#: of the seal closing rather than of more space appearing.
SEAL_RADIUS_MM = 10.0

#: Closing applied to the CAVITY to bridge across trabeculae, so the distance
#: transform measures the lumen rather than the gaps between filaments.
BRIDGE_RADIUS_MM = 2.0

#: Triangle budget for the committed cleaned mesh. The full-resolution cleaned
#: mesh is ~14 MB, which does not belong in Git for an experiment; this is the
#: reviewable artefact and the script regenerates the full one on demand.
REVIEW_TRIANGLE_BUDGET = 120_000


def main() -> int:
    import argparse
    import sys

    root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root / "pipeline"))

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=root / SOURCE_RELATIVE,
                        help="Heart102_Tissue.stl (gitignored; fetched separately)")
    parser.add_argument("--out", type=Path, default=root / "output/vhl-partition")
    parser.add_argument("--resolutions", type=int, nargs="+", default=[192, 384])
    parser.add_argument("--full-resolution-mesh", action="store_true",
                        help="also write the undecimated cleaned mesh (~14 MB, not committed)")
    args = parser.parse_args()

    if not args.source.exists():
        print(f"source mesh not found at {args.source}", file=sys.stderr)
        print("It is CC BY-NC 4.0 and gitignored. Fetch it before running.", file=sys.stderr)
        return 2

    import geometry
    from meshlib import Surface, read_binary_stl, write_gltf

    args.out.mkdir(parents=True, exist_ok=True)
    findings: dict = {}

    # ---- item 1: characterise the debris -------------------------------- #
    surface = read_binary_stl(args.source)
    welded, _ = geometry.weld(surface)
    measured = geometry.measure(welded)
    print(f"source: {measured['triangles']} triangles, {measured['components']} components, "
          f"watertight={bool(measured['watertight'])}")

    debris = analyse_debris(welded.vertices, welded.faces)
    tri_fraction, vol_fraction = debris.kept_fraction()
    print(f"debris: {debris.component_count - 1} components to drop; "
          f"largest/second |volume| ratio = {debris.separation_ratio:,.0f}x; "
          f"{debris.negative_components} of {debris.component_count} enclose NEGATIVE volume")
    print(f"cleaning costs {100 * (1 - tri_fraction):.2f}% of triangles and "
          f"{100 * (1 - vol_fraction):.3f}% of |volume|")

    findings["source_measure"] = measured
    findings["debris"] = {
        "components": debris.component_count,
        "negative_volume_components": debris.negative_components,
        "separation_ratio": round(debris.separation_ratio, 1),
        "triangles_kept_fraction": round(tri_fraction, 6),
        "volume_kept_fraction": round(vol_fraction, 8),
        "dropped_volume_mm3": round(
            float(np.abs(debris.signed_volume_mm3).sum()
                  - abs(debris.signed_volume_mm3[debris.keep_label])), 4),
        "component_triangles_sorted": sorted(debris.triangles.tolist(), reverse=True)[:20],
    }

    # ---- item 2: cleaned mesh ------------------------------------------- #
    clean_v, clean_f = strip_debris(welded.vertices, welded.faces, debris)
    cleaned = Surface(name="myocardial-tissue-cleaned",
                      vertices=np.ascontiguousarray(clean_v, dtype=np.float32),
                      faces=np.ascontiguousarray(clean_f, dtype=np.int32))
    print(f"cleaned: {cleaned.triangle_count} triangles, "
          f"{geometry.component_count(cleaned)} component(s)")
    findings["cleaned_measure"] = geometry.measure(cleaned)

    if args.full_resolution_mesh:
        write_gltf(args.out / "cleaned-full.gltf", [cleaned], bin_name="cleaned-full.bin")

    import fast_simplification
    reduction = 1.0 - REVIEW_TRIANGLE_BUDGET / cleaned.triangle_count
    points, faces = fast_simplification.simplify(
        cleaned.vertices, cleaned.faces, min(max(reduction, 0.0), 0.98))
    review = Surface(name="myocardial-tissue-cleaned",
                     vertices=np.ascontiguousarray(points, dtype=np.float32),
                     faces=np.ascontiguousarray(faces, dtype=np.int32))
    write_gltf(args.out / "cleaned-review.gltf", [review], bin_name="cleaned-review.bin")
    findings["cleaned_review_measure"] = geometry.measure(review)
    print(f"wrote cleaned-review.gltf ({review.triangle_count} triangles)")

    # ---- item 3: the partition attempt ---------------------------------- #
    reports = []
    grid = None
    for resolution in args.resolutions:
        grid = voxelise(welded.vertices, welded.faces, resolution)
        report = cavity_report(grid, SEAL_RADIUS_MM)
        reports.append(report.__dict__ | {"odd_scanlines": grid.odd_scanlines})
        print(f"res {resolution}^3 pitch {grid.pitch:.4f} mm: "
              f"tissue {report.tissue_mm3 / 1000:.1f} mL, "
              f"cavity {report.cavity_mm3 / 1000:.1f} mL in {report.cavity_components} pieces, "
              f"largest inscribed sphere {report.largest_inscribed_radius_mm:.2f} mm, "
              f"enclosed voids {report.interior_void_count} "
              f"({report.largest_interior_void_mm3 / 1000:.3f} mL largest)")
    findings["cavity_reports"] = [
        {k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()}
        for r in reports
    ]

    assert grid is not None

    # The seal-radius sweep, kept in the record because reading any cavity
    # figure without it is how this module reached a wrong answer once already.
    seal_sweep = []
    for radius in (6.0, 8.0, 10.0, 12.0, 14.0, 16.0):
        report = cavity_report(grid, radius)
        seal_sweep.append({
            "seal_radius_mm": radius,
            "cavity_ml": round(report.cavity_mm3 / 1000, 1),
            "largest_cavity_ml": round(report.largest_cavity_mm3 / 1000, 1),
            "largest_inscribed_radius_mm": round(report.largest_inscribed_radius_mm, 2),
        })
    findings["seal_radius_sweep"] = seal_sweep
    print("seal sweep (radius -> largest cavity mL): " + ", ".join(
        f"{r['seal_radius_mm']:.0f}->{r['largest_cavity_ml']:.0f}" for r in seal_sweep))

    sweep = chamber_core_sweep(grid, SEAL_RADIUS_MM, np.arange(3.0, 10.0, 1.0),
                               BRIDGE_RADIUS_MM)
    findings["chamber_core_sweep"] = sweep
    stable = [row for row in sweep if row["cores_over_5ml"] == 2]
    print(f"chamber core sweep: {len(stable)} of {len(sweep)} thresholds show exactly "
          f"two chamber-scale cores")

    # ---- item 4: render ------------------------------------------------- #
    envelope = epicardial_envelope(grid.mask, SEAL_RADIUS_MM, grid.pitch)
    cavity = chamber_cavity(grid, SEAL_RADIUS_MM, BRIDGE_RADIUS_MM)
    write_png(args.out / "cross-sections.png", slice_panel(grid, cavity, envelope))
    print("wrote cross-sections.png")

    # The chamber space split as far as the evidence actually goes: the two
    # stable cores grown back over the cavity by nearest-core assignment.
    #
    # NEAREST-CORE IS NOT A WATERSHED, and the difference matters. This measures
    # straight-line distance, which walks through the septum as if it were not
    # there, so the boundary it draws is a plane between the two cores rather
    # than the muscle that actually separates them. A geodesic flood confined to
    # the cavity would follow the septum; scipy has no such transform and the
    # environment carries no skimage, so what is written out here is the honest
    # weaker thing, labelled as such. It is a picture of where the two cores
    # are, NOT a partition, and nothing downstream should treat it as one.
    distance = ndimage.distance_transform_edt(cavity) * grid.pitch
    # Pick the threshold that isolates the most chamber-scale cores, preferring
    # the highest such threshold: a core that survives more erosion is a lobe of
    # the lumen rather than a wide spot between two trabeculae.
    best: tuple[int, float] = (0, 0.0)
    for candidate in np.arange(4.0, distance.max(), 0.5):
        labelled, _ = ndimage.label(distance >= candidate, structure=FACE_CONNECTED)
        counts = np.bincount(labelled.ravel())
        counts[0] = 0
        found = int((counts * grid.voxel_mm3 > 3000.0).sum())
        if found >= best[0]:
            best = (found, float(candidate))
    seed_threshold = best[1]
    findings["seed_threshold_mm"] = round(seed_threshold, 2)
    core_labels, _ = ndimage.label(distance >= seed_threshold, structure=FACE_CONNECTED)
    core_sizes = np.bincount(core_labels.ravel())
    core_sizes[0] = 0
    chamber_scale = np.flatnonzero(core_sizes * grid.voxel_mm3 > 3000.0)
    print(f"seed threshold {seed_threshold:.1f} mm -> {len(chamber_scale)} chamber-scale cores")
    seeds = np.zeros_like(core_labels)
    for rank, label in enumerate(chamber_scale, start=1):
        seeds[core_labels == label] = rank
    if seeds.any():
        _, (iy, ix, iz) = ndimage.distance_transform_edt(seeds == 0, return_indices=True)
        grown = np.where(cavity, seeds[iy, ix, iz], 0)
        write_png(args.out / "chamber-cores.png", region_panel(grid, grown))
        volumes = [round(float((grown == r).sum()) * grid.voxel_mm3 / 1000, 1)
                   for r in range(1, len(chamber_scale) + 1)]
        findings["core_regions_ml"] = volumes
        print(f"wrote chamber-cores.png ({len(chamber_scale)} regions, {volumes} mL)")

    findings["verdict"] = {
        "debris_solvable": True,
        "chambers_present_as_space": True,
        "six_tag_partition_emitted": False,
        "reason": (
            "The debris is separable with a volume threshold at essentially no cost. The "
            "chambers ARE present as open space — about "
            f"{seal_sweep[3]['largest_cavity_ml']:.0f} mL of connected chamber lumen once the "
            "valve orifices are sealed at 12 mm — but they arrive as ONE connected region, "
            "because the model leaves every valve orifice open. Distance-transform seeding "
            "splits that region into two stable chamber-scale cores, almost certainly the two "
            "ventricles, and no further. Separating atrium from ventricle needs a valve cut "
            "plane, which this module does not have and does not invent. No six-tag partition "
            "is emitted, so no anatomy.py frame or valve check has been run."
        ),
    }
    (args.out / "findings.json").write_text(json.dumps(findings, indent=2) + "\n")
    print(f"wrote findings.json to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
