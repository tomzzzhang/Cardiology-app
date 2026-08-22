"""
Chamber space by a SOLID-ANGLE ENCLOSURE FIELD, thresholded at a value LEARNED
from the 580 labelled points.

The idea, in one sentence: a voxel deep inside a cardiac chamber is enclosed —
almost every direction you look, you hit myocardium within a chamber-sized
distance — whereas a voxel outside the epicardium sees at least half the sphere
free, because a point outside a roughly convex body always does.

Formally, for every voxel v define

    E(v) = (1 / |D|) * #{ d in D : the ray v + t*d, 0 < t <= R, meets tissue }

where D is a near-uniform set of unit directions on the sphere and R is a fixed
range in mm. Leaving the grid box without meeting tissue counts as a MISS, not
a hit: the box wall is not anatomy, and treating it as tissue would make every
voxel near the border look enclosed.

E is a purely local geometric property of the tissue mask. It needs no surface
reconstruction, no morphological envelope, no smoothing radius, and no
connectivity assumption. That is the entire point of this candidate: the failure
mode of `epicardial_envelope` is that a dilate-fill-erode bridges the AV groove
and the gaps between the great vessels, creating a film of "space" that wraps
the whole organ. The film sits in a shallow surface concavity; it is NOT
enclosed; so E should be able to see it even though clearance cannot.

WHAT COUNTS AS A HIT, AND WHY R IS WHAT IT IS
---------------------------------------------
* Hit = a sample point strictly beyond the origin voxel and within R mm along
  the direction lands in a tissue voxel.
* Sampling step along each ray is 0.5 voxel, so a wall one voxel thick cannot be
  stepped over even on a body diagonal (the worst-case gap between consecutive
  samples in any single axis is < 1 voxel).
* Out of bounds terminates the ray as a MISS.
* R = 20 mm, chosen from a property of the model that was measured before this
  module existed and not from any outcome of it: the largest ball that fits
  inside the open lumen has radius 17.75 mm. A range shorter than that would
  leave the deepest chamber voxel unable to see any wall in any direction, so
  its enclosure would be 0 and the method could not work by construction.
  20 mm is the smallest round number above 17.75. It is NOT swept.

RESOLUTION
----------
The field is computed at FULL 384^3 resolution. It was going to be decimated 2x
for speed; measurement said the full-resolution pass costs 73 s for 128
directions at R = 20 mm and 131 s for the R = 6/10/15/20/30 multi-range pass, so
decimation was not needed and its blocking artefact was avoided. `decimate_max`
is kept because it is the correct decimation for an occlusion query (a coarse
voxel is tissue if ANY child is, so a one-voxel wall still blocks), but the
reported run used decimate = 1.

THE THRESHOLD IS LEARNED, NOT TUNED
-----------------------------------
The seed file carries 580 hand-placed points with known side:
  * 27 chamber seeds (tags 1-5), placed inside lumen  -> label INSIDE
  * 553 tag-99 marks at `model_point_mm`, clicked on the outside surface of the
    heart -> label OUTSIDE
`threshold_from_labels` reads E at all 580 points and reports both
distributions. If they separate, the threshold is the midpoint of the gap and
the margin is the gap width. If they overlap, the function says so and returns
the overlap — an overlap is this method failing, and it must be reported as
such rather than resolved by picking whichever cut makes a volume look right.

MEASURED RESULT — THIS METHOD FAILS
-----------------------------------
It failed. The two labelled distributions overlap at every ray range tried, and
the overlap is not a tail artefact, it is the decision region.

  R mm   inside p50/min   outside p50/p95/max     AUC     Youden cut  TPR   TNR
    6     0.000 / 0.000    0.469 / 0.664 / 0.930  0.016      —      1.000 0.000
   10     0.195 / 0.000    0.484 / 0.727 / 0.953  0.157      —      1.000 0.000
   15     0.547 / 0.023    0.492 / 0.742 / 0.953  0.535    0.613    0.407 0.874
   20     0.695 / 0.289    0.492 / 0.748 / 0.953  0.816    0.605    0.778 0.854
   30     0.898 / 0.727    0.500 / 0.755 / 0.953  0.982    0.723    1.000 0.932

At the pre-declared R = 20 mm the maximum-margin rule is degenerate: max(outside)
= 0.953 exceeds every one of the 27 inside values (min 0.289), so the only cut
with no false positives keeps no chamber at all — mask 41.1 mL, 0/27 seeds
retained, every chamber 0.0 mL.

R = 30 mm is the best the field can do and it was selected POST HOC, by label
separability (AUC / Youden J), not by any volume. Even there the classes overlap
by 0.227 in E: 37 of 547 barrier marks sit above the cut that retains all 27
chamber seeds. The mask is 366.1 mL of the old 437.7 mL and the flood still
gives RV 175.9 mL across an 87 x 112 x 133 mm extent against a 112 x 125 x 149 mm
whole heart. The wrap survives.

WHY IT FAILS — the premise is wrong for this organ
--------------------------------------------------
The premise was "outside a roughly convex body you see at least half the sphere
free". The heart is not roughly convex at the scale that matters. The AV groove,
the interventricular groove and the wedges between the great vessels are deep
enough that a point sitting in them — on the true epicardial surface, exactly
where the observer clicked — sees tissue in 75-95% of directions. Those points
are geometrically MORE enclosed than a chamber voxel near an open valve orifice
or a cut vessel stub, where rays escape freely.

The decomposition of what the R = 30 mask actually cut says the same thing
numerically: of the 72.8 mL it removed from the old space, 36.3 mL had clearance
> 3 mm, i.e. half of its removals were wide cavity, not film — it punched holes
in the middle of chambers where rays escape down the great vessels. Meanwhile it
KEPT 135.0 mL of clearance < 1.5 mm: trabecular slits and the film in the
grooves, which are narrow and therefore superbly enclosed.

Enclosure is anti-correlated with the property actually wanted. It ranks a
1 mm trabecular interstice as more interior than the centre of the aortic root.
No threshold on this field can work, and that is a statement about the field,
not about the threshold.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

#: Range of an enclosure ray, in mm. See module docstring — fixed from the
#: measured 17.75 mm largest inscribed radius of the lumen, not swept.
RAY_RANGE_MM = 20.0

#: Sampling step along a ray, in voxels of the field grid. 0.5 guarantees no
#: single-voxel wall can be stepped over.
RAY_STEP_VOXELS = 0.5

#: Number of directions. 128 gives the field a resolution of 1/128 = 0.0078,
#: an order of magnitude finer than any margin worth believing.
N_DIRECTIONS = 128

#: Decimation factor for the field grid.
DECIMATE = 2


def fibonacci_directions(n: int = N_DIRECTIONS) -> np.ndarray:
    """`n` near-uniformly spaced unit vectors on the sphere (spherical Fibonacci)."""
    k = np.arange(n) + 0.5
    z = 1.0 - 2.0 * k / n
    r = np.sqrt(np.clip(1.0 - z * z, 0.0, None))
    phi = np.pi * (1.0 + 5.0 ** 0.5) * k
    return np.stack([r * np.cos(phi), r * np.sin(phi), z], axis=1)


def decimate_max(mask: np.ndarray, factor: int = DECIMATE) -> np.ndarray:
    """Block-max downsample. A block is tissue if ANY child voxel is tissue."""
    n = mask.shape[0]
    assert n % factor == 0, "grid size must divide by the decimation factor"
    m = n // factor
    view = mask.reshape(m, factor, m, factor, m, factor)
    return view.any(axis=(1, 3, 5))


def _ray_offsets(direction: np.ndarray, range_voxels: float,
                 step: float = RAY_STEP_VOXELS) -> list[tuple[int, int, int]]:
    """
    Distinct integer lattice offsets sampled along one ray, nearest ordering.

    The zero offset is dropped: a ray starting inside tissue is not interesting
    here (the field is read on free voxels), and self-hits would make E == 1
    everywhere inside the wall and destroy nothing but clarity.
    """
    ts = np.arange(step, range_voxels + 1e-9, step)
    offsets = np.rint(ts[:, None] * direction[None, :]).astype(np.int64)
    seen: set[tuple[int, int, int]] = set()
    out: list[tuple[int, int, int]] = []
    for off in offsets:
        key = (int(off[0]), int(off[1]), int(off[2]))
        if key == (0, 0, 0) or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _shifted_or(target: np.ndarray, source: np.ndarray,
                offset: tuple[int, int, int]) -> None:
    """
    `target |= source shifted by -offset`, zero-filled outside.

    After this, target[v] is true where source[v + offset] is true and v+offset
    is in bounds. Out of bounds contributes False, which is the MISS convention.
    """
    slices_t, slices_s = [], []
    for d, n in zip(offset, source.shape):
        if d >= 0:
            if d >= n:
                return
            slices_t.append(slice(0, n - d))
            slices_s.append(slice(d, n))
        else:
            if -d >= n:
                return
            slices_t.append(slice(-d, n))
            slices_s.append(slice(0, n + d))
    target[tuple(slices_t)] |= source[tuple(slices_s)]


def enclosure_field_multirange(tissue: np.ndarray, pitch: float,
                               ranges_mm, n_directions: int = N_DIRECTIONS,
                               progress=None) -> dict:
    """
    Enclosure counts at SEVERAL ranges from ONE pass of ray casting.

    Offsets along a ray are generated in increasing distance order, so the
    running `hit` mask after the last sample inside R mm is exactly the
    single-range answer for R. Snapshotting it at each checkpoint costs one
    extra accumulate per range per direction, not a second traversal.

    Returns {range_mm: uint8 hit-count array}.
    """
    ranges = sorted(float(r) for r in ranges_mm)
    counts = {r: np.zeros(tissue.shape, dtype=np.uint8) for r in ranges}
    hit = np.empty(tissue.shape, dtype=bool)
    directions = fibonacci_directions(n_directions)
    biggest = ranges[-1] / pitch
    for index, direction in enumerate(directions):
        hit[...] = False
        offsets = _ray_offsets(direction, biggest)
        # distance in voxels of each offset, to know which checkpoint it is past
        step = 0
        for offset in offsets:
            dist_mm = float(np.linalg.norm(offset)) * pitch
            while step < len(ranges) and dist_mm > ranges[step]:
                counts[ranges[step]] += hit
                step += 1
            _shifted_or(hit, tissue, offset)
        while step < len(ranges):
            counts[ranges[step]] += hit
            step += 1
        if progress is not None and (index + 1) % 16 == 0:
            progress(index + 1, n_directions)
    return counts


def youden_cut(inside: np.ndarray, outside: np.ndarray) -> tuple[float, float, float, float]:
    """
    Balanced-accuracy cut and its rates: (threshold, TPR, TNR, J).

    Raw error count is the wrong criterion here — the labelled set is 27 inside
    against 547 outside, so "call everything outside" scores 95% and keeps no
    chamber at all. Youden's J = TPR + TNR - 1 is invariant to that imbalance.
    This is a criterion fixed before looking at any volume.
    """
    inside = np.asarray(inside, float)
    outside = np.asarray(outside, float)
    values = np.unique(np.concatenate([inside, outside]))
    cuts = np.concatenate([[values[0] - 1e-6], 0.5 * (values[:-1] + values[1:]),
                           [values[-1] + 1e-6]])
    tpr = np.array([(inside > c).mean() for c in cuts])
    tnr = np.array([(outside <= c).mean() for c in cuts])
    j = tpr + tnr - 1.0
    b = int(np.argmax(j))
    return float(cuts[b]), float(tpr[b]), float(tnr[b]), float(j[b])


def auc(inside: np.ndarray, outside: np.ndarray) -> float:
    """P(E(inside point) > E(outside point)), ties counted as half. 0.5 = useless."""
    inside = np.asarray(inside, float)[:, None]
    outside = np.asarray(outside, float)[None, :]
    return float(((inside > outside).sum() + 0.5 * (inside == outside).sum())
                 / (inside.size * outside.size))


def enclosure_field(tissue: np.ndarray, pitch: float,
                    range_mm: float = RAY_RANGE_MM,
                    n_directions: int = N_DIRECTIONS,
                    decimate: int = DECIMATE,
                    progress=None) -> tuple[np.ndarray, float]:
    """
    Enclosure fraction for every voxel of a decimated copy of `tissue`.

    Returns (field, coarse_pitch). `field` is float32 in [0, 1] on a grid
    `decimate` times smaller than `tissue` in each axis.
    """
    coarse = decimate_max(tissue, decimate) if decimate > 1 else tissue
    coarse_pitch = pitch * decimate
    range_voxels = range_mm / coarse_pitch

    counts = np.zeros(coarse.shape, dtype=np.uint16)
    hit = np.empty(coarse.shape, dtype=bool)
    directions = fibonacci_directions(n_directions)
    for index, direction in enumerate(directions):
        hit[...] = False
        for offset in _ray_offsets(direction, range_voxels):
            _shifted_or(hit, coarse, offset)
        counts += hit
        if progress is not None and (index + 1) % 16 == 0:
            progress(index + 1, n_directions)
    return (counts.astype(np.float32) / float(n_directions)), coarse_pitch


def upsample(field: np.ndarray, factor: int, shape: tuple[int, int, int]) -> np.ndarray:
    """Nearest-neighbour upsample of a decimated field back to the full grid."""
    if factor == 1:
        return field
    out = np.repeat(np.repeat(np.repeat(field, factor, axis=0), factor, axis=1),
                    factor, axis=2)
    return out[:shape[0], :shape[1], :shape[2]]


def voxel_of_mm(points_mm: np.ndarray, origin: np.ndarray, pitch: float,
                n: int) -> np.ndarray:
    """Integer voxel index [k, j, i] of model-space points, clipped to the grid."""
    v = np.floor((np.asarray(points_mm, dtype=float) - origin) / pitch).astype(np.int64)
    return np.clip(v, 0, n - 1)


@dataclass
class Calibration:
    """What the 580 labelled points say about where to cut the enclosure field."""

    inside: np.ndarray        # E at the 27 chamber seeds
    outside: np.ndarray       # E at the 553 tag-99 marks (model_point_mm)
    separable: bool
    threshold: float
    margin: float             # gap width in E units; <= 0 means overlap
    overlap_inside: int       # chamber seeds at or below max(outside)
    overlap_outside: int      # barrier marks at or above min(inside)
    notes: list[str] = field(default_factory=list)


def threshold_from_labels(inside: np.ndarray, outside: np.ndarray) -> Calibration:
    """
    Maximum-margin cut between the two labelled distributions.

    If min(inside) > max(outside) the classes are linearly separable in E and
    the answer is unambiguous: cut in the middle of the gap, margin = the gap.

    If they overlap there is NO clean cut. The function still returns the
    threshold that minimises total misclassification (ties broken toward the
    largest local gap), but `separable` is False, `margin` is the negative
    overlap width, and the counts on each side are reported. That is the method
    failing and it must be reported as failure.
    """
    inside = np.asarray(inside, dtype=float)
    outside = np.asarray(outside, dtype=float)
    lo, hi = float(outside.max()), float(inside.min())
    notes: list[str] = []
    if hi > lo:
        return Calibration(inside, outside, True, 0.5 * (lo + hi), hi - lo, 0, 0,
                           [f"separable: max(outside)={lo:.4f} < min(inside)={hi:.4f}"])

    # Overlapping. Scan every candidate cut at a midpoint between adjacent
    # observed values and take the one with fewest errors.
    values = np.unique(np.concatenate([inside, outside]))
    cuts = np.concatenate([[values[0] - 1e-6],
                           0.5 * (values[:-1] + values[1:]),
                           [values[-1] + 1e-6]])
    errors = np.array([(inside <= c).sum() + (outside > c).sum() for c in cuts])
    best = int(np.argmin(errors))
    cut = float(cuts[best])
    notes.append(f"NOT separable: max(outside)={lo:.4f} >= min(inside)={hi:.4f}; "
                 f"overlap width {lo - hi:.4f}")
    notes.append(f"best cut {cut:.4f} still misclassifies {int(errors[best])} "
                 f"of {inside.size + outside.size} labelled points")
    return Calibration(inside, outside, False, cut, hi - lo,
                       int((inside <= cut).sum()), int((outside > cut).sum()), notes)


def chamber_space_enclosure(tissue: np.ndarray, field_full: np.ndarray,
                            threshold: float) -> np.ndarray:
    """free AND enclosure > threshold. No connectivity filtering applied here."""
    return (~tissue) & (field_full > threshold)
