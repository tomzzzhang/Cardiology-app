"""
Separate two chambers at the valve they share, by the plane of that valve.

A geodesic flood divides lumen by who reaches it first. Across an open
atrioventricular orifice that is not a boundary: atrium and ventricle are one
connected space, the trabeculae give the front many parallel routes, and the two
labels end up interdigitated over a surface many times the area of the annulus
they are supposed to meet at. Measured on this model, right atrium and right
ventricle shared 6,394 mm2, against roughly 1,000-1,200 mm2 for a tricuspid
annulus at this age.

Anatomy says the interface is a plane: the annulus is a ring, the valve sits in
it, and every path from atrium to ventricle passes through it. So rather than
weighting the flood - which cannot help, because the flood is not what is wrong -
the two labels are re-cut by the least-area plane that separates their seeds.

The search is over plane ORIENTATION as well as offset, because an
atrioventricular plane is oblique to every axis of this model and to the line
between the two centroids. The winning plane is the one whose cross-section
through the shared space is smallest while still keeping each chamber's own
seeds on its own side, which is a statement of what a valve is.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class ValveCut:
    normal: np.ndarray
    offset: float
    area_mm2: float
    misplaced_seeds: int
    #: Cross-sectional area against offset along the winning normal, as evidence
    #: that the chosen offset is a minimum rather than a preference.
    profile: list[tuple[float, float]]


def _directions(count: int) -> np.ndarray:
    """A hemisphere of normals, evenly spread. Antipodes are the same plane."""
    k = np.arange(count) + 0.5
    phi = np.arccos(1 - k / count)          # hemisphere: cos phi in [0, 1]
    theta = np.pi * (1 + 5 ** 0.5) * k
    return np.stack([np.sin(phi) * np.cos(theta),
                     np.sin(phi) * np.sin(theta),
                     np.cos(phi)], axis=1)


def find(points_a: np.ndarray, points_b: np.ndarray, shared: np.ndarray,
         pitch: float, directions: int = 300, slab_mm: float = 1.0,
         tolerance: float = 0.05) -> ValveCut:
    """
    `points_a` / `points_b` are the two chambers' seed positions in mm;
    `shared` is (N, 3) mm positions of every voxel either label holds.

    `tolerance` is the share of each chamber's seeds allowed to fall on the wrong
    side. It is not slack for its own sake: the marks were placed on cut faces
    through the annulus, so a few of them straddle any plane drawn there, and
    demanding a perfect split finds no plane at all. At 5% the constraint still
    pins the plane to within a millimetre or so; the profile returned alongside
    shows how sharp the minimum is.
    """
    dirs = _directions(directions)
    best = None
    for n in dirs:
        s = shared @ n
        a = points_a @ n
        b = points_b @ n
        a_first = a.mean() < b.mean()
        lo = np.percentile(a if a_first else b, 100 * tolerance)
        hi = np.percentile(b if a_first else a, 100 * (1 - tolerance))
        if lo >= hi:
            continue
        cuts = np.arange(lo, hi, pitch)
        if not len(cuts):
            continue
        for t in cuts:
            wrong_a = np.count_nonzero((a < t) != a_first) / len(a)
            wrong_b = np.count_nonzero((b < t) != (not a_first)) / len(b)
            if max(wrong_a, wrong_b) > tolerance:
                continue
            count = np.count_nonzero(np.abs(s - t) <= slab_mm / 2)
            area = count * pitch ** 3 / slab_mm
            if best is None or area < best[0]:
                profile = [(float(u), float(np.count_nonzero(np.abs(s - u) <= slab_mm / 2)
                                             * pitch ** 3 / slab_mm)) for u in cuts]
                best = (area, n, float(t), profile,
                        int(round(wrong_a * len(a) + wrong_b * len(b))))
    if best is None:
        raise ValueError("no plane separates the two seed sets within tolerance")
    area, normal, offset, profile, misplaced = best
    return ValveCut(normal=normal, offset=offset, area_mm2=area,
                    misplaced_seeds=misplaced, profile=profile)


def apply(labels: np.ndarray, tag_a: int, tag_b: int, cut: ValveCut,
          origin: np.ndarray, pitch: float, a_below: bool) -> np.ndarray:
    """Re-cut everything the two labels hold, by which side of the plane it is on."""
    out = labels.copy()
    both = np.argwhere((labels == tag_a) | (labels == tag_b))
    mm = (both + 0.5) * pitch + origin
    below = (mm @ cut.normal) < cut.offset
    out[both[below, 0], both[below, 1], both[below, 2]] = tag_a if a_below else tag_b
    out[both[~below, 0], both[~below, 1], both[~below, 2]] = tag_b if a_below else tag_a
    return out
