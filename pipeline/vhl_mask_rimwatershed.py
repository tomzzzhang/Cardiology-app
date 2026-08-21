"""
Chamber space by splitting the TISSUE SURFACE into epicardium and endocardium.

The problem this solves. `epicardial_envelope AND NOT tissue` contains a film of
non-chamber space wrapping the organ, and no flood weighting removes it, because
the bogus pockets the envelope bridges are as wide as the orifices it must seal.

The observation this uses. The tissue surface has exactly two sheets — an outer
epicardial one and an inner endocardial one — and they are joined ONLY at the
rims of the orifices: the valve annuli and the cut ends of the great-vessel and
venous stubs. So the epicardium/endocardium split is not a thresholding problem.
It is a watershed on a two-dimensional sheet whose meeting line is an anatomical
landmark rather than a tuned contour.

The observer's 553 "not lumen" marks are, at their `model_point_mm`, a sample of
the epicardium. They seed the outer front. The inner front is seeded from free
space that cannot be film: every mark sits in space no wider than 1.16 mm, so a
voxel with several millimetres of clearance is unambiguously lumen. That
clearance is a SEEDING floor, not a boundary — the boundary is where the two
surface fronts meet — which is why the result barely moves when it is changed.

Then every free voxel is assigned to its nearest surface voxel, and inherits that
voxel's sheet. Free space against endocardium is chamber; free space against
epicardium is film and outside, and is discarded.

What this deliberately does NOT do: separate the chambers from one another. The
valves are modelled open, so left atrium and left ventricle are one connected
space with no neck. Dividing lumen between chambers is the seed flood's job, and
the watershed between two chamber seeds across an open orifice is legitimate.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np
from scipy import ndimage

EPI, ENDO = 1, 2

#: 26-connectivity. The surface sheet is a discrete manifold; six-connectivity
#: leaves it perforated at staircase steps and the front leaks through the holes.
_FULL = np.ones((3, 3, 3), dtype=bool)


@dataclass
class SurfaceSplit:
    """The split, plus every input needed to check it."""

    chamber_space: np.ndarray
    sheet: np.ndarray            # EPI / ENDO / 0, on surface voxels only
    surface: np.ndarray
    epi_sources: int
    endo_sources: int
    unreached_surface: int
    clearance_floor_mm: float
    epi_reach_mm: float


def tissue_surface(tissue: np.ndarray) -> np.ndarray:
    """Tissue voxels with at least one face-adjacent free neighbour."""
    free = ~tissue
    return tissue & ndimage.binary_dilation(free, ndimage.generate_binary_structure(3, 1))


def _nearest(mask: np.ndarray) -> np.ndarray:
    """For every voxel, the index of the nearest voxel in `mask`. Shape (3, N, N, N)."""
    _, index = ndimage.distance_transform_edt(~mask, return_indices=True)
    return index.astype(np.int32)



def _grow_on_surface(surface: np.ndarray, sources: np.ndarray, steps: int) -> np.ndarray:
    """Breadth-first growth from `sources`, confined to `surface`, `steps` deep.

    The marks are points, but what they testify to is an AREA: the observer drew
    a surface, and 553 samples of it stand for the patch around each one. Growing
    them before the race is what turns a point sample into the sheet it samples.
    """
    if steps <= 0:
        return sources.copy()
    n = surface.shape[0]
    reached = sources.copy()
    flat_r, flat_s = reached.reshape(-1), surface.reshape(-1)
    frontier = [int(i) for i in np.flatnonzero(flat_r)]
    offsets = [((dk * n + dj) * n + di, dk, dj, di)
               for dk in (-1, 0, 1) for dj in (-1, 0, 1) for di in (-1, 0, 1)
               if dk or dj or di]
    for _ in range(steps):
        nxt = []
        for current in frontier:
            k, remainder = divmod(current, n * n)
            j, i = divmod(remainder, n)
            for step, dk, dj, di in offsets:
                a, b, c = k + dk, j + dj, i + di
                if a < 0 or b < 0 or c < 0 or a >= n or b >= n or c >= n:
                    continue
                neighbour = current + step
                if flat_s[neighbour] and not flat_r[neighbour]:
                    flat_r[neighbour] = True
                    nxt.append(neighbour)
        if not nxt:
            break
        frontier = nxt
    return reached

def _surface_watershed(surface: np.ndarray, epi: np.ndarray, endo: np.ndarray) -> np.ndarray:
    """
    Equal-cost breadth-first watershed confined to `surface`.

    Confinement is the whole point: a front cannot cross from the outer sheet to
    the inner one except by going around an orifice rim, so where the two fronts
    meet IS the rim.
    """
    n = surface.shape[0]
    sheet = np.zeros(surface.shape, dtype=np.uint8)
    sheet[epi] = EPI
    sheet[endo] = ENDO
    sheet[~surface] = 0

    flat, mask = sheet.reshape(-1), surface.reshape(-1)
    queue: deque[int] = deque(int(i) for i in np.flatnonzero(flat))

    offsets = []
    for dk in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                if dk or dj or di:
                    offsets.append((dk, dj, di, (dk * n + dj) * n + di))

    while queue:
        current = queue.popleft()
        value = flat[current]
        k, remainder = divmod(current, n * n)
        j, i = divmod(remainder, n)
        for dk, dj, di, step in offsets:
            a, b, c = k + dk, j + dj, i + di
            if a < 0 or b < 0 or c < 0 or a >= n or b >= n or c >= n:
                continue
            neighbour = current + step
            if mask[neighbour] and flat[neighbour] == 0:
                flat[neighbour] = value
                queue.append(neighbour)
    return sheet


def split(tissue: np.ndarray, pitch: float, mark_voxels: np.ndarray,
          interior: np.ndarray, outside: np.ndarray | None = None,
          clearance_floor_mm: float = 4.0, epi_reach_mm: float = 8.0) -> SurfaceSplit:
    """
    `mark_voxels` is (M, 3) integer voxel indices of the observer's outside marks,
    which must come from `model_point_mm` — the `voxel` field in the seed file is
    dragged up to 13.6 mm inward by the labeller and is unusable for this.

    `interior` bounds where the inner front may be SEEDED from. It exists because
    the open air around the model has unlimited clearance and would otherwise
    qualify as "too wide to be film" everywhere, seeding the inner front onto the
    epicardium and inverting the whole split. The old broken `chamber_space` is a
    perfectly good choice: it is far too generous, which is exactly why it is safe
    as a seeding bound, and it does not touch where the boundary ends up.
    """
    free = ~tissue
    surface = tissue_surface(tissue)
    nearest = _nearest(surface)

    def project(points: np.ndarray) -> np.ndarray:
        k, j, i = points[:, 0], points[:, 1], points[:, 2]
        return np.stack([nearest[0][k, j, i], nearest[1][k, j, i], nearest[2][k, j, i]], axis=1)

    epi_points = project(np.asarray(mark_voxels, dtype=np.int64))
    epi = np.zeros_like(surface)
    epi[epi_points[:, 0], epi_points[:, 1], epi_points[:, 2]] = True
    # The marks alone are 553 points over ~25000 mm^2 of epicardium, which leaves
    # the outer front starting several millimetres behind the inner one at any
    # rim the observer did not mark. Both fronts advance one step per round, so
    # an unequally seeded race decides the boundary by seeding density rather
    # than by geometry — the exact failure this module exists to avoid.
    #
    # `outside` fixes it without another parameter. Air that reaches the grid
    # border and is not the sealed interior is unambiguously outside the heart,
    # so every surface voxel it touches is unambiguously epicardium. That covers
    # the convex majority densely; the marks cover the concavities the sealing
    # envelope bridges, which is precisely where air cannot reach.
    #
    # `epi_reach_mm` turns each mark from a point into the patch of epicardium it
    # stands for. It is read off the mark cloud rather than chosen: nearest-
    # neighbour spacing among the 553 marks runs to about 8 mm at the 90th
    # percentile, so 8 mm is the radius at which the marks cover the surface they
    # were drawn on. Sweep it; the chamber volumes should stop moving once the
    # cover closes, and a result that keeps drifting with it is not converged.
    epi = _grow_on_surface(surface, epi, int(round(epi_reach_mm / pitch)))
    if outside is not None:
        epi |= surface & ndimage.binary_dilation(outside, _FULL)

    # Free space too wide to be film, projected onto the surface it faces.
    clearance = ndimage.distance_transform_edt(free, sampling=pitch)
    fat = np.argwhere(interior & (clearance > clearance_floor_mm))
    endo_points = project(fat)
    endo = np.zeros_like(surface)
    endo[endo_points[:, 0], endo_points[:, 1], endo_points[:, 2]] = True
    # A surface voxel claimed by both is epicardium: the marks are direct
    # observation and the clearance rule is an inference.
    endo &= ~epi

    sheet = _surface_watershed(surface, epi, endo)
    facing = sheet[nearest[0], nearest[1], nearest[2]]
    return SurfaceSplit(
        chamber_space=free & (facing == ENDO),
        sheet=sheet,
        surface=surface,
        epi_sources=int(epi.sum()),
        endo_sources=int(endo.sum()),
        unreached_surface=int((surface & (sheet == 0)).sum()),
        clearance_floor_mm=clearance_floor_mm,
        epi_reach_mm=epi_reach_mm,
    )
