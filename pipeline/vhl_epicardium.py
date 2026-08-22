"""The OUTER surface of the heart, and a wall partition confined to it.

`vhl_wall_paint.epicardium` returns every tissue voxel with a free neighbour.
On this model that is not the epicardium: it is the whole tissue boundary, which
includes the endocardium lining each chamber and the surface of every trabecular
strut. The chambers hold 425 mL of open lumen and the wall is trabeculated
throughout, so the inner boundary is several times the area of the outer one.

That matters because the grooves are drawn on the OUTSIDE. A surface flood over
the whole tissue boundary can leave a chamber's outer territory, pass through an
open valve orifice onto the endocardium, and spread down the inside of a
neighbour without ever meeting a groove - the barrier is on a face the route
never touches. No groove can close that, because the leak is not on the drawn
surface at all.

`outer_surface` keeps only the tissue voxels facing the space OUTSIDE the organ.
Outside is `free AND NOT chamber space`, taking the component that reaches the
grid border, so the definition rests on the chamber-space mask this branch
already built and introduces no new parameter.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from vhl_wall_paint import _polyline, _snap, _surface_flood, _to_voxel

_FACE = ndimage.generate_binary_structure(3, 1)
_FULL = np.ones((3, 3, 3), dtype=bool)


def outer_surface(tissue: np.ndarray, chamber_space: np.ndarray) -> np.ndarray:
    """Tissue voxels facing the air outside the heart."""
    outside = ~tissue & ~chamber_space
    labels, _n = ndimage.label(outside, structure=_FACE)
    border = np.unique(np.concatenate([
        labels[0].ravel(), labels[-1].ravel(),
        labels[:, 0].ravel(), labels[:, -1].ravel(),
        labels[:, :, 0].ravel(), labels[:, :, -1].ravel()]))
    border = border[border > 0]
    outside = np.isin(labels, border)
    return tissue & ndimage.binary_dilation(outside, _FACE)


def partition(tissue: np.ndarray, surface: np.ndarray, paint: dict,
              rotation: np.ndarray, origin: np.ndarray, pitch: float,
              thickness_mm: float = 1.2) -> tuple[np.ndarray, dict]:
    """`vhl_wall_paint.partition` with the surface supplied rather than derived."""
    n = tissue.shape[0]
    barrier = np.zeros(tissue.shape, dtype=bool)
    grooves = np.asarray(paint.get("grooves", []), dtype=float)
    if len(grooves):
        dense = _polyline(grooves, surface, origin, pitch, break_mm=8.0)
        vox = _snap(surface, _to_voxel(dense, rotation, origin, pitch, n))
        stroke = np.zeros(tissue.shape, dtype=bool)
        stroke[vox[:, 0], vox[:, 1], vox[:, 2]] = True
        steps = max(int(round(thickness_mm / pitch)), 1)
        barrier = ndimage.binary_dilation(stroke, _FULL, iterations=steps) & surface

    seeds: dict[int, np.ndarray] = {}
    for key, region in paint.get("regions", {}).items():
        pts = np.asarray(region["points"], dtype=float)
        if len(pts):
            seeds[int(key)] = _snap(surface, _to_voxel(pts, rotation, origin, pitch, n))

    sheet = _surface_flood(surface, seeds, barrier, None)
    reached = sheet > 0
    if not reached.any():
        raise ValueError("no region seed landed on the outer surface")
    _d, index = ndimage.distance_transform_edt(~reached, return_indices=True)
    wall = np.where(tissue, sheet[index[0], index[1], index[2]], 0).astype(np.uint8)
    report = {
        "surface_voxels": int(surface.sum()),
        "barrier_voxels": int(barrier.sum()),
        "surface_unreached": int((surface & ~barrier & (sheet == 0)).sum()),
        "regions": {int(k): int(len(v)) for k, v in seeds.items()},
    }
    return wall, report
