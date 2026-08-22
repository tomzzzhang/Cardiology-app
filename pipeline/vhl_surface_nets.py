"""
Naive surface nets: a binary voxel label to a smooth triangle surface.

Why not marching cubes. `skimage` is not in `environment.yml` and this is not a
good enough reason to add it. Surface nets needs no 256-entry case table — it
places ONE vertex per active cell at the average of that cell's edge crossings
and joins the four cells around every sign-changing grid edge into a quad — so it
is about sixty lines of array arithmetic, and on binary data it produces a
smoother surface than marching cubes does, which is the point here: these
surfaces are for looking at.

The volume is blurred and re-thresholded before extraction. On a binary mask the
crossings all sit at edge midpoints, which reproduces the voxel staircase exactly;
a short blur puts them where the surface really is.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

#: Cell corner order: index = a*4 + b*2 + c for corner offset (a, b, c).
_EDGES = np.array([
    (0, 4), (1, 5), (2, 6), (3, 7),      # along +x
    (0, 2), (1, 3), (4, 6), (5, 7),      # along +y
    (0, 1), (2, 3), (4, 5), (6, 7),      # along +z
], dtype=np.int64)

_CORNER = np.array([(a, b, c) for a in (0, 1) for b in (0, 1) for c in (0, 1)], dtype=np.float64)
#: Midpoint of each edge in cell-local coordinates.
_EDGE_MID = (_CORNER[_EDGES[:, 0]] + _CORNER[_EDGES[:, 1]]) / 2.0


def extract(mask: np.ndarray, origin: np.ndarray, pitch: float,
            blur_voxels: float = 0.6, smooth_iterations: int = 8,
            smooth_strength: float = 0.5) -> tuple[np.ndarray, np.ndarray]:
    """Return `(vertices_mm, triangles)` for the boundary of `mask`."""
    # sigma 0.6 keeps a ONE-VOXEL wall alive: it blurs to 0.66, over the 0.5
    # threshold. At sigma 1.0 the same wall falls to 0.40 and is erased, which
    # punches rectangular holes through every thin trabecular sheet.
    field = ndimage.gaussian_filter(mask.astype(np.float32), blur_voxels) if blur_voxels else mask
    solid = field > 0.5
    if not solid.any():
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)

    # Corner samples of every cell, shape (8, I, J, K).
    corners = np.stack([solid[a:a + solid.shape[0] - 1,
                              b:b + solid.shape[1] - 1,
                              c:c + solid.shape[2] - 1]
                        for a, b, c in _CORNER.astype(int)], axis=0)
    crossing = corners[_EDGES[:, 0]] != corners[_EDGES[:, 1]]       # (12, I, J, K)
    count = crossing.sum(axis=0)
    active = count > 0

    local = np.tensordot(_EDGE_MID.T, crossing.astype(np.float32), axes=(1, 0))  # (3, I, J, K)
    local = local[:, active] / count[active]

    cell = np.argwhere(active)
    vertices = (cell + local.T + 0.5) * pitch + origin

    index = np.full(active.shape, -1, dtype=np.int64)
    index[active] = np.arange(len(cell))

    quads: list[np.ndarray] = []
    # One quad per sign-changing grid edge, from the four cells sharing it.
    #
    # The in-plane pair per axis must keep the basis RIGHT-handed, or the quads
    # on that axis come out wound backwards. (1, 2), (2, 0), (0, 1) are the
    # cyclic rotations; the obvious-looking (0, 2) for axis 1 is not one of them,
    # and using it inverts every y-facing face. The mesh stays closed, so a
    # Euler-characteristic check passes and nothing looks wrong until it is lit:
    # inverted normals read as dark speckle across the surface.
    for axis, (u, v) in enumerate(((1, 2), (2, 0), (0, 1))):
        lo = [slice(None)] * 3
        hi = [slice(None)] * 3
        lo[axis], hi[axis] = slice(0, -1), slice(1, None)
        flips = solid[tuple(lo)] != solid[tuple(hi)]
        # Cells touching this edge are offset by 0 or -1 in the two other axes.
        shifts = [(0, 0), (0, -1), (-1, -1), (-1, 0)]
        picked = np.argwhere(flips)
        if not len(picked):
            continue
        gathered: list[np.ndarray] = []
        valid = np.ones(len(picked), dtype=bool)
        for du, dv in shifts:
            p = picked.copy()
            p[:, u] += du
            p[:, v] += dv
            inside = ((p >= 0).all(axis=1)
                      & (p[:, 0] < index.shape[0]) & (p[:, 1] < index.shape[1])
                      & (p[:, 2] < index.shape[2]))
            got = np.full(len(p), -1, dtype=np.int64)
            got[inside] = index[p[inside, 0], p[inside, 1], p[inside, 2]]
            valid &= got >= 0
            gathered.append(got)
        if not valid.any():
            continue
        quad = np.stack([g[valid] for g in gathered], axis=1)
        # Wind so the face points from solid to empty.
        forward = solid[tuple(lo)][flips][valid]
        quad = np.where(forward[:, None], quad, quad[:, ::-1])
        quads.append(quad)

    if not quads:
        return np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64)
    quad = np.concatenate(quads, axis=0)
    triangles = np.concatenate([quad[:, (0, 2, 1)], quad[:, (0, 3, 2)]], axis=0)
    # Wound so the signed volume of a closed surface comes out POSITIVE, i.e.
    # face normals point out of the solid. Checked on axis-aligned slabs, one per
    # axis, because a cube alone cannot catch a single axis being inverted.

    if smooth_iterations:
        vertices = _laplacian(vertices, triangles, smooth_iterations, smooth_strength)
    return vertices, triangles


def _laplacian(vertices: np.ndarray, triangles: np.ndarray,
               iterations: int, strength: float) -> np.ndarray:
    """
    Taubin smoothing: a positive umbrella pass followed by a slightly larger
    negative one, which removes the voxel staircase without the steady shrinkage
    that repeated Laplacian passes cause. On a trabeculated wall the shrinkage
    matters - plain Laplacian pulls the two sides of a thin sheet through each
    other, and the surface ends up self-intersecting and speckled.
    """
    edges = np.concatenate([triangles[:, (0, 1)], triangles[:, (1, 2)], triangles[:, (2, 0)]])
    edges = np.concatenate([edges, edges[:, ::-1]])
    order = np.argsort(edges[:, 0], kind="stable")
    edges = edges[order]
    degree = np.bincount(edges[:, 0], minlength=len(vertices)).astype(np.float64)
    degree[degree == 0] = 1.0
    out = vertices.copy()
    mu = -(strength + 0.03)
    for step in range(iterations * 2):
        summed = np.zeros_like(out)
        np.add.at(summed, edges[:, 0], out[edges[:, 1]])
        out += (strength if step % 2 == 0 else mu) * (summed / degree[:, None] - out)
    return out
