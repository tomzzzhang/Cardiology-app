"""
Tidy a voxel label map: smooth the boundaries, remove the islands.

A seeded watershed gives boundaries that follow the data voxel by voxel, which on
a trabeculated surface means they wander, and it leaves specks of one label
stranded inside another wherever the front squeezed through a gap. Neither is
anatomy. Both are cheap to remove and easy to measure.

**Smoothing is a majority vote, not a blur.** A label map cannot be filtered as
numbers - averaging tags 1 and 5 does not give tag 3. Each label's indicator is
box-filtered separately and the winner takes the voxel, which moves a boundary
towards the locally dominant side and leaves the interior untouched.

**Islands are re-homed to whoever surrounds them, not deleted**, so nothing is
lost from the mask - a hole would only be filled again by whatever ran the
inheritance step afterwards, and less predictably.

Both are measured rather than asserted: `report` returns the interface area
between labels, which falls as boundaries straighten, and the component count per
label, which is what an island is.
"""
from __future__ import annotations

from collections import Counter

import numpy as np
from scipy import ndimage

_FACE = ndimage.generate_binary_structure(3, 1)
_FULL = np.ones((3, 3, 3), dtype=bool)


def interface_area_mm2(labels: np.ndarray, pitch: float) -> float:
    """Total area of faces between two DIFFERENT non-zero labels."""
    total = 0
    for axis in range(3):
        a = np.take(labels, range(0, labels.shape[axis] - 1), axis=axis)
        b = np.take(labels, range(1, labels.shape[axis]), axis=axis)
        total += int(np.count_nonzero((a != b) & (a > 0) & (b > 0)))
    return total * pitch * pitch


def components_per_label(labels: np.ndarray, tags) -> dict[int, int]:
    out = {}
    for tag in tags:
        mask = labels == tag
        if not mask.any():
            continue
        _lab, n = ndimage.label(mask, structure=_FACE)
        out[int(tag)] = int(n)
    return out


def smooth(labels: np.ndarray, mask: np.ndarray, tags, pitch: float,
           radius_mm: float = 1.5, iterations: int = 3) -> np.ndarray:
    """Iterated majority vote inside `mask`. Labels outside `mask` are cleared."""
    size = max(int(round(2 * radius_mm / pitch)) | 1, 3)     # odd box, >= 3
    out = np.where(mask, labels, 0)
    tags = [int(t) for t in tags]
    for _ in range(iterations):
        best = np.zeros(out.shape, dtype=np.float32)
        winner = np.zeros(out.shape, dtype=labels.dtype)
        for tag in tags:
            share = ndimage.uniform_filter((out == tag).astype(np.float32), size=size)
            take = share > best
            winner[take] = tag
            best[take] = share[take]
        # A voxel with no label anywhere near it keeps whatever it had, rather
        # than being emptied by a vote nobody stood in.
        out = np.where(mask & (best > 0), winner, out)
    return out


def _rehome(labels: np.ndarray, drop_by_tag: dict[int, np.ndarray]) -> np.ndarray:
    """Give each dropped voxel to the nearest surviving voxel of a DIFFERENT label.

    Two things this has to get right, and a first version got the second wrong.

    Speed: dilating each doomed component and voting on its shell costs a pass over
    the whole volume PER COMPONENT, and there are hundreds. One distance transform
    per tag handles all of that tag's components at once.

    Correctness: the destination must EXCLUDE the label being dropped. Otherwise an
    island's nearest survivor is very often its own label's main body across a small
    gap, so it is relabelled as itself and remains a separate component - which is
    exactly the thing being removed. "Force to one patch" then silently does nothing,
    and reports success.
    """
    out = labels.copy()
    for tag, drop in drop_by_tag.items():
        if not drop.any():
            continue
        keep = (labels > 0) & (labels != tag)
        for other, mask in drop_by_tag.items():
            if other != tag:
                keep &= ~mask
        if not keep.any():
            continue
        _d, index = ndimage.distance_transform_edt(~keep, return_indices=True)
        out[drop] = labels[index[0][drop], index[1][drop], index[2][drop]]
    return out


def enforce_single(labels: np.ndarray, tags) -> tuple[np.ndarray, dict[int, int]]:
    """Force each of `tags` to ONE component, re-homing the rest to their neighbours.

    A left or right ventricle is one patch of wall. That is a fact about the organ,
    not a size threshold, so it is stated rather than approximated. Labels whose
    topology genuinely is complex - the atria, with veins and appendages hanging
    off them - are left alone by not being in `tags`.
    """
    drop: dict[int, np.ndarray] = {}
    moved: dict[int, int] = {}
    for tag in [int(t) for t in tags]:
        mask = labels == tag
        if not mask.any():
            continue
        comp, n = ndimage.label(mask, structure=_FACE)
        if n <= 1:
            continue
        sizes = np.bincount(comp.ravel())
        sizes[0] = 0
        keep = int(np.argmax(sizes))
        lose = mask & (comp != keep)
        drop[tag] = lose
        moved[tag] = int(lose.sum())
    return _rehome(labels, drop), moved


def absorb_thin(labels: np.ndarray, tags, pitch: float,
                radius_mm: float = 1.5) -> tuple[np.ndarray, dict[int, int]]:
    """Give away any strip of a label too narrow to hold a ball of `radius_mm`.

    The owner's rule: no ribbon of one colour squeezed between two others. A ribbon
    is what a morphological opening removes - it survives only where the ball fits -
    and what it removes goes to the label on the other side rather than to a hole.
    """
    steps = max(int(round(radius_mm / pitch)), 1)
    drop: dict[int, np.ndarray] = {}
    moved: dict[int, int] = {}
    for tag in [int(t) for t in tags]:
        mask = labels == tag
        if not mask.any():
            continue
        core = ndimage.binary_dilation(
            ndimage.binary_erosion(mask, _FACE, iterations=steps), _FACE, iterations=steps)
        strip = mask & ~core
        if not strip.any():
            continue
        # An opening peels a thin RIND off every region, not just the ribbons
        # between two others. Handing that rind away shatters the labelling - it
        # is most of the surface layer. Keep any sliver still attached to the
        # core; give away only the ones the opening has cut loose, which is what
        # a ribbon squeezed between two other labels actually is.
        comp, n = ndimage.label(strip, structure=_FACE)
        attached = np.unique(comp[ndimage.binary_dilation(core, _FULL) & strip])
        loose = ~np.isin(comp, attached[attached > 0])
        strip &= loose
        if strip.any():
            drop[tag] = strip
            moved[tag] = int(strip.sum())
    return _rehome(labels, drop), moved


def despeckle(labels: np.ndarray, tags, voxel_mm3: float,
              min_ml: float = 0.25) -> tuple[np.ndarray, dict[int, float]]:
    """Re-home every component under `min_ml` to the label surrounding it."""
    drop: dict[int, np.ndarray] = {}
    moved: dict[int, float] = {}
    for tag in [int(t) for t in tags]:
        mask = labels == tag
        if not mask.any():
            continue
        comp, n = ndimage.label(mask, structure=_FACE)
        if n <= 1:
            continue
        sizes = np.bincount(comp.ravel())
        sizes[0] = 0
        keep = int(np.argmax(sizes))
        small = np.flatnonzero(sizes * voxel_mm3 / 1000.0 < min_ml)
        small = small[(small > 0) & (small != keep)]
        if not len(small):
            continue
        lose = np.isin(comp, small)
        drop[tag] = lose
        moved[tag] = float(lose.sum()) * voxel_mm3 / 1000.0
    return _rehome(labels, drop), moved
