"""
Partition the myocardium by grooves drawn on its own surface.

Assigning wall to the nearest labelled cavity gives ragged boundaries, because
the nearest cavity is not what bounds a chamber's territory on the outside. The
atrioventricular and interventricular grooves are, and on this specimen they are
plainly visible - so they are drawn rather than inferred.

The shape is the seeded watershed that has worked at every other step here, moved
onto a surface: a groove stroke is a BARRIER, a region point is a SEED, and the
flood runs over the epicardial surface only. Confining it to the surface is the
whole trick - two points either side of a groove are millimetres apart in space
and a long way apart across the surface, which is exactly the distinction a groove
encodes and a distance transform through the wall cannot see.

Wall beneath then inherits from the surface above it, by nearest labelled surface
voxel. Marks arrive in CARDIAC coordinates, since the viewer raycasts posed
meshes; `rotation` maps them back.
"""
from __future__ import annotations

from collections import deque

import numpy as np
from scipy import ndimage

_FULL = np.ones((3, 3, 3), dtype=bool)


def epicardium(tissue: np.ndarray) -> np.ndarray:
    """Tissue voxels with a face-adjacent free neighbour."""
    return tissue & ndimage.binary_dilation(~tissue, ndimage.generate_binary_structure(3, 1))


def _to_voxel(points_mm: np.ndarray, rotation: np.ndarray,
              origin: np.ndarray, pitch: float, shape: int) -> np.ndarray:
    model = (rotation.T @ np.asarray(points_mm, dtype=float).T).T
    return np.clip(np.round((model - origin) / pitch - 0.5).astype(int), 0, shape - 1)


def _strokes(points: np.ndarray, break_mm: float) -> list[np.ndarray]:
    """Split a flat list of marks back into the strokes it was drawn as.

    The export flattens every stroke into one array. Consecutive marks WITHIN a
    drag are about a brush-width apart; the jump between one stroke and the next
    is much larger, so the gaps say where the pen was lifted.
    """
    if len(points) < 2:
        return [points]
    step = np.linalg.norm(np.diff(points, axis=0), axis=1)
    cuts = np.flatnonzero(step > break_mm) + 1
    return [s for s in np.split(points, cuts) if len(s)]


def _polyline(points: np.ndarray, surface: np.ndarray, origin: np.ndarray,
              pitch: float, break_mm: float) -> np.ndarray:
    """Marks to a CONTINUOUS curve on the surface.

    A barrier made of dilated dots only closes if the dots are nearer than the
    dilation. Drawn at 2.5 mm spacing and dilated by 2.5 mm they do not, so the
    flood walks straight between them - which is what leaked. Joining consecutive
    marks within a stroke and snapping the join onto the surface gives a curve
    that closes at any spacing, and lets the barrier be thin, which matters
    because a fat barrier eats territory it should only be dividing.
    """
    out = []
    for stroke in _strokes(points, break_mm):
        if len(stroke) == 1:
            out.append(stroke)
            continue
        for a, b in zip(stroke[:-1], stroke[1:]):
            steps = max(int(np.ceil(np.linalg.norm(b - a) / (pitch * 0.5))), 1)
            out.append(a + (b - a) * np.linspace(0, 1, steps + 1)[:, None])
    return np.vstack(out) if out else points


def _snap(mask: np.ndarray, voxels: np.ndarray) -> np.ndarray:
    """Move each voxel onto the nearest voxel of `mask`."""
    _d, index = ndimage.distance_transform_edt(~mask, return_indices=True)
    return np.stack([index[k][voxels[:, 0], voxels[:, 1], voxels[:, 2]] for k in range(3)], axis=1)


def concavity(tissue: np.ndarray, surface: np.ndarray, pitch: float,
              radius_mm: float = 2.0) -> np.ndarray:
    """How concave the surface is at each point, 0..1, high inside a groove.

    The share of a small ball around a surface voxel that is tissue. On a ridge
    most of the ball is outside the organ and the share is low; in the floor of an
    atrioventricular or interventricular groove the walls close in around it and
    the share is high. No curvature estimate, no normals, no fitting - and it is
    exactly the signal the observer is pointing at when they say the boundaries
    should sit in the grooves.
    """
    size = max(int(round(2 * radius_mm / pitch)) | 1, 3)
    share = ndimage.uniform_filter(tissue.astype(np.float32), size=size)
    return np.where(surface, share, 0.0)


def _surface_flood(surface: np.ndarray, seeds: dict[int, np.ndarray],
                   barrier: np.ndarray, cost: np.ndarray | None = None) -> np.ndarray:
    """Watershed over `surface`, blocked by `barrier`.

    With `cost` supplied this is Dijkstra rather than breadth-first: crossing a
    groove is made expensive, so two fronts meeting near one stall on its rim and
    the boundary settles into the groove instead of wherever the fronts happened
    to collide. That is what "snap the boundaries to the natural grooves" means
    operationally - it is a property of the metric, not a post-hoc nudge.
    """
    if cost is not None:
        import heapq
        n = surface.shape[0]
        open_surface = surface & ~barrier
        out = np.zeros(surface.shape, dtype=np.uint8)
        dist = np.full(surface.shape, np.inf, dtype=np.float32)
        heap: list[tuple[float, int, int]] = []
        for tag, vox in seeds.items():
            for k, j, i in vox:
                if open_surface[k, j, i]:
                    dist[k, j, i] = 0.0
                    out[k, j, i] = tag
                    heapq.heappush(heap, (0.0, int((k * n + j) * n + i), int(tag)))
        flat_d, flat_o = dist.reshape(-1), out.reshape(-1)
        flat_m, flat_c = open_surface.reshape(-1), cost.reshape(-1)
        offsets = [((dk * n + dj) * n + di, dk, dj, di)
                   for dk in (-1, 0, 1) for dj in (-1, 0, 1) for di in (-1, 0, 1)
                   if dk or dj or di]
        while heap:
            d0, current, tag = heapq.heappop(heap)
            if d0 > flat_d[current]:
                continue
            k, remainder = divmod(current, n * n)
            j, i = divmod(remainder, n)
            for step, dk, dj, di in offsets:
                a, b, c = k + dk, j + dj, i + di
                if a < 0 or b < 0 or c < 0 or a >= n or b >= n or c >= n:
                    continue
                nb = current + step
                if not flat_m[nb]:
                    continue
                nd = d0 + flat_c[nb] * ((dk * dk + dj * dj + di * di) ** 0.5)
                if nd < flat_d[nb]:
                    flat_d[nb] = nd
                    flat_o[nb] = tag
                    heapq.heappush(heap, (float(nd), int(nb), int(tag)))
        return out
    """Equal-cost breadth-first watershed over `surface`, blocked by `barrier`."""
    n = surface.shape[0]
    open_surface = surface & ~barrier
    out = np.zeros(surface.shape, dtype=np.uint8)
    flat, mask = out.reshape(-1), open_surface.reshape(-1)
    queue: deque[int] = deque()
    for tag, vox in seeds.items():
        for k, j, i in vox:
            if open_surface[k, j, i]:
                index = (k * n + j) * n + i
                if flat[index] == 0:
                    flat[index] = tag
                    queue.append(int(index))
    offsets = [((dk * n + dj) * n + di, dk, dj, di)
               for dk in (-1, 0, 1) for dj in (-1, 0, 1) for di in (-1, 0, 1)
               if dk or dj or di]
    while queue:
        current = queue.popleft()
        value = flat[current]
        k, remainder = divmod(current, n * n)
        j, i = divmod(remainder, n)
        for step, dk, dj, di in offsets:
            a, b, c = k + dk, j + dj, i + di
            if a < 0 or b < 0 or c < 0 or a >= n or b >= n or c >= n:
                continue
            nb = current + step
            if mask[nb] and flat[nb] == 0:
                flat[nb] = value
                queue.append(nb)
    return out


def partition(tissue: np.ndarray, paint: dict, rotation: np.ndarray,
              origin: np.ndarray, pitch: float,
              groove_width_mm: float | None = None,
              thickness_mm: float = 1.2,
              snap_to_grooves: float = 0.0,
              concavity_radius_mm: float = 2.0) -> tuple[np.ndarray, dict]:
    """Return `(wall_labels, report)` from an exported `wall-paint.json`."""
    n = tissue.shape[0]
    surface = epicardium(tissue)
    width = groove_width_mm if groove_width_mm is not None else float(paint.get("brush_mm", 2.5))

    barrier = np.zeros(tissue.shape, dtype=bool)
    grooves = np.asarray(paint.get("grooves", []), dtype=float)
    if len(grooves):
        # Join the marks into curves FIRST, then snap the curves to the surface.
        # Break at 8 mm, read off the marks themselves: consecutive marks within a
        # drag sit 2.9 mm apart at the median, while the jump between strokes is
        # 18.7 mm at the 95th percentile. A larger threshold joins across pen-lifts
        # and draws walls the observer never drew.
        dense = _polyline(grooves, surface, origin, pitch, break_mm=8.0)
        vox = _snap(surface, _to_voxel(dense, rotation, origin, pitch, n))
        stroke = np.zeros(tissue.shape, dtype=bool)
        stroke[vox[:, 0], vox[:, 1], vox[:, 2]] = True
        # A connected curve only needs enough width to be watertight against a
        # 26-connected flood, not a brush-width slab.
        steps = max(int(round(thickness_mm / pitch)), 1)
        barrier = ndimage.binary_dilation(stroke, _FULL, iterations=steps) & surface

    seeds: dict[int, np.ndarray] = {}
    for key, region in paint.get("regions", {}).items():
        pts = np.asarray(region["points"], dtype=float)
        if not len(pts):
            continue
        seeds[int(key)] = _snap(surface, _to_voxel(pts, rotation, origin, pitch, n))

    cost = None
    if snap_to_grooves > 0:
        conc = concavity(tissue, surface, pitch, concavity_radius_mm)
        # Flat surface costs 1; the floor of a groove costs 1 + snap. Fronts
        # therefore stop at grooves rather than running through them.
        cost = (1.0 + snap_to_grooves * np.clip((conc - 0.5) * 2.0, 0, 1)).astype(np.float32)
    sheet = _surface_flood(surface, seeds, barrier, cost)
    reached = sheet > 0
    if not reached.any():
        raise ValueError("no region seed landed on the epicardial surface")
    _d, index = ndimage.distance_transform_edt(~reached, return_indices=True)
    wall = np.where(tissue, sheet[index[0], index[1], index[2]], 0).astype(np.uint8)

    report = {
        "surface_voxels": int(surface.sum()),
        "barrier_voxels": int(barrier.sum()),
        "surface_unreached": int((surface & ~barrier & (sheet == 0)).sum()),
        "regions": {int(k): int(len(v)) for k, v in seeds.items()},
        "groove_width_mm": width,
        "barrier_thickness_mm": thickness_mm,
        "groove_marks": int(len(grooves)),
        "snap_to_grooves": snap_to_grooves,
    }
    return wall, report
