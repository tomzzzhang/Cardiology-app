"""
Refine a hand-traced valve annulus against the geometry it was traced on.

What a trace gives well and badly. The PLANE is well determined - the observer's
tricuspid ring is planar to 0.36 mm rms - because a ring of points on a real
annulus fixes an orientation tightly. The RADIUS is not, because only about half
of each ring gets traced in practice and the fit then extrapolates the rest; on
this pack the mean-distance and circle-fit estimates differ by 27%.

So take the plane as the starting point and MEASURE the rest. An annulus is the
narrowest cross-section of the passage between two chambers: slice the lumen on a
candidate plane, take the connected patch the traced centre falls in, and its area
is the orifice. Minimising that area over a small cone of orientations and offsets
around the trace lands on the annulus itself rather than on where the eye put it.

Minimum area alone is NOT enough, and it fails loudly: run on the mitral trace it
returned a plane whose patch measured 0 mm2, having wandered onto a crevice. So the
criterion is not "smallest section" but **the smallest section that actually
separates the two chambers** - remove the patch from the lumen and the atrium's
seeds must end up in a different connected component from the ventricle's. That is
what a valve does, it cannot be satisfied by a crevice, and it is what makes the
answer usable: the winning patch is exactly the barrier that severs them.

The barrier is the measured patch itself, not a circle through it. An annulus is
not round, and there is no reason to make it round when the geometry is right
there.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage


@dataclass
class Annulus:
    normal: np.ndarray
    centre: np.ndarray
    area_mm2: float
    radius_mm: float          #: equivalent-circle radius of the measured patch
    tilt_deg: float           #: angle from the traced plane
    shift_mm: float           #: movement of the centre from the traced one
    filled: bool              #: whether the patch had to be hole-filled


def _basis(n: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    up = np.array([0.0, 1.0, 0.0]) if abs(n[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    e1 = np.cross(up, n); e1 /= np.linalg.norm(e1)
    return e1, np.cross(n, e1)


def _cone(n: np.ndarray, half_angle_deg: float, count: int) -> np.ndarray:
    """Directions within a cone about `n`, plus `n` itself."""
    e1, e2 = _basis(n)
    out = [n]
    k = np.arange(1, count + 1)
    for ring, frac in ((count // 2, 0.5), (count, 1.0)):
        a = np.radians(half_angle_deg) * frac
        for j in range(ring):
            t = 2 * np.pi * j / ring
            out.append(np.cos(a) * n + np.sin(a) * (np.cos(t) * e1 + np.sin(t) * e2))
    return np.array([v / np.linalg.norm(v) for v in out])


def _patch(space: np.ndarray, origin: np.ndarray, pitch: float,
           n: np.ndarray, centre: np.ndarray, at: float,
           span_mm: float, samples: int) -> tuple[float, np.ndarray, bool]:
    """Area and centroid of the lumen patch the traced centre sits in."""
    e1, e2 = _basis(n)
    u = (np.arange(samples) + 0.5) / samples - 0.5
    U, V = np.meshgrid(u * span_mm, u * span_mm, indexing="ij")
    base = centre + n * at
    pts = base + U[..., None] * e1 + V[..., None] * e2
    idx = np.round((pts - origin) / pitch - 0.5).astype(int)
    good = ((idx >= 0) & (idx < space.shape[0])).all(-1)
    grid = np.zeros(U.shape, bool)
    grid[good] = space[idx[good][:, 0], idx[good][:, 1], idx[good][:, 2]]
    labels, _ = ndimage.label(grid)
    mid = samples // 2
    here = labels[mid, mid]
    if here == 0:                      # centre fell on tissue; take the nearest patch
        if labels.max() == 0:
            return np.inf, centre, False
        d, ind = ndimage.distance_transform_edt(labels == 0, return_indices=True)
        here = labels[ind[0][mid, mid], ind[1][mid, mid]]
    patch = labels == here
    filled = ndimage.binary_fill_holes(patch)
    cell = (span_mm / samples) ** 2
    ij = np.argwhere(filled)
    c2 = ij.mean(0)
    world = (base + (c2[0] / samples - 0.5) * span_mm * e1
                  + (c2[1] / samples - 0.5) * span_mm * e2)
    return float(filled.sum()) * cell, world, bool(filled.sum() > patch.sum())


def barrier(space: np.ndarray, origin: np.ndarray, pitch: float,
            n: np.ndarray, centre: np.ndarray, at: float,
            span_mm: float, samples: int) -> np.ndarray:
    """The measured patch, as a one-voxel-thick set of voxels."""
    e1, e2 = _basis(n)
    u = (np.arange(samples) + 0.5) / samples - 0.5
    U, V = np.meshgrid(u * span_mm, u * span_mm, indexing="ij")
    base = centre + n * at
    pts = base + U[..., None] * e1 + V[..., None] * e2
    idx = np.round((pts - origin) / pitch - 0.5).astype(int)
    good = ((idx >= 0) & (idx < space.shape[0])).all(-1)
    grid = np.zeros(U.shape, bool)
    grid[good] = space[idx[good][:, 0], idx[good][:, 1], idx[good][:, 2]]
    labels, _ = ndimage.label(grid)
    mid = samples // 2
    here = labels[mid, mid]
    if here == 0:
        if labels.max() == 0:
            return np.zeros((0, 3), dtype=int)
        _d, ind = ndimage.distance_transform_edt(labels == 0, return_indices=True)
        here = labels[ind[0][mid, mid], ind[1][mid, mid]]
    keep = ndimage.binary_fill_holes(labels == here) & good
    return idx[keep]


def refine(space: np.ndarray, origin: np.ndarray, pitch: float,
           traced_normal: np.ndarray, traced_centre: np.ndarray,
           atrium_seeds: np.ndarray, ventricle_seeds: np.ndarray,
           half_angle_deg: float = 25.0, directions: int = 14,
           offset_mm: float = 8.0, offset_steps: int = 33,
           span_mm: float = 80.0, samples: int = 200,
           min_area_mm2: float = 150.0) -> Annulus:
    """Smallest cross-section near the trace that SEPARATES the two seed sets."""
    n0 = traced_normal / np.linalg.norm(traced_normal)
    cand = []
    for n in _cone(n0, half_angle_deg, directions):
        for at in np.linspace(-offset_mm, offset_mm, offset_steps):
            area, centre, filled = _patch(space, origin, pitch, n,
                                          traced_centre, at, span_mm, samples)
            if np.isfinite(area) and area >= min_area_mm2:
                cand.append((area, n, centre, at, filled))
    cand.sort(key=lambda c: c[0])
    structure = ndimage.generate_binary_structure(3, 1)
    for area, n, centre, at, filled in cand:
        vox = barrier(space, origin, pitch, n, centre, at, span_mm, samples)
        if not len(vox):
            continue
        cut = space.copy()
        cut[vox[:, 0], vox[:, 1], vox[:, 2]] = False
        labels, _ = ndimage.label(cut, structure=structure)
        # The DOMINANT component of each seed set, not every component. With
        # thousands of hand-placed marks a few always straddle any plane, so
        # demanding no component hold both can never be satisfied - it was not,
        # for either valve, which is how this was found.
        from collections import Counter
        a = Counter(int(labels[tuple(s)]) for s in atrium_seeds if cut[tuple(s)])
        v = Counter(int(labels[tuple(s)]) for s in ventricle_seeds if cut[tuple(s)])
        a.pop(0, None); v.pop(0, None)
        if not a or not v:
            continue
        (a_main, a_n), (v_main, v_n) = a.most_common(1)[0], v.most_common(1)[0]
        share = min(a_n / sum(a.values()), v_n / sum(v.values()))
        if a_main != v_main and share >= 0.8:
            return Annulus(normal=n, centre=centre, area_mm2=area,
                           radius_mm=float(np.sqrt(area / np.pi)),
                           tilt_deg=float(np.degrees(np.arccos(np.clip(abs(n @ n0), -1, 1)))),
                           shift_mm=float(np.linalg.norm(centre - traced_centre)),
                           filled=filled)
    raise ValueError("no plane near the trace separates the two seed sets")
