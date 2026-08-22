"""Label the endocardium from the lumen it lines, and the wall between two surfaces.

The wall has two labelled faces, and they carry different evidence:

* OUTSIDE, the epicardium, where the observer's grooves say where one chamber's
  territory ends and the next begins. `vhl_epicardium` floods that.
* INSIDE, the endocardium, where no drawing is needed at all. An inner-surface
  voxel is FACE-ADJACENT to the lumen it lines, so it can read its label straight
  off the lumen voxel it touches. Nothing is measured at a distance, so nothing
  walks through the septum: the left face of the septum reads from the left
  ventricular cavity and the right face from the right, and the split falls out.

With both faces labelled, the wall in between is nearest-labelled-SURFACE rather
than nearest-labelled-lumen. That is an interpolation between two observations
instead of an extrapolation from one, which is why the septum stops being taken
whole by whichever cavity happened to be marginally nearer.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

_FACE = ndimage.generate_binary_structure(3, 1)

# The six face neighbours, as (axis, shift) pairs.
_NEIGHBOURS = [(0, 1), (0, -1), (1, 1), (1, -1), (2, 1), (2, -1)]


def inner_surface(tissue: np.ndarray, outer: np.ndarray) -> np.ndarray:
    """Tissue voxels on a free boundary that is not the outer one."""
    boundary = tissue & ndimage.binary_dilation(~tissue, _FACE)
    return boundary & ~outer


def label_from_lumen(inner: np.ndarray, lumen: np.ndarray) -> np.ndarray:
    """Each inner-surface voxel takes the tag of the lumen it touches.

    Votes over the six face neighbours, so a voxel in a crevice touching two
    chambers goes to the one it faces more of. Ties break to the lower tag, which
    only matters for a handful of trabecular voxels.
    """
    tags = [t for t in range(1, 7) if (lumen == t).any()]
    votes = np.zeros((len(tags),) + inner.shape, dtype=np.uint8)
    for n, tag in enumerate(tags):
        cavity = lumen == tag
        for axis, shift in _NEIGHBOURS:
            votes[n] += np.roll(cavity, shift, axis=axis).astype(np.uint8)
    best = votes.argmax(axis=0)
    touched = votes.max(axis=0) > 0
    out = np.zeros(inner.shape, dtype=np.uint8)
    keep = inner & touched
    out[keep] = np.asarray(tags, dtype=np.uint8)[best[keep]]
    return out


def wall_between(tissue: np.ndarray, *surfaces: np.ndarray) -> np.ndarray:
    """Fill the wall from the nearest labelled voxel of any supplied surface."""
    seed = np.zeros(tissue.shape, dtype=np.uint8)
    for surface in surfaces:
        seed = np.where((seed == 0) & (surface > 0), surface, seed)
    _d, index = ndimage.distance_transform_edt(seed == 0, return_indices=True)
    return np.where(tissue, seed[index[0], index[1], index[2]], 0).astype(np.uint8)


def plane_side(shape: tuple[int, int, int], centre_cardiac, normal_cardiac,
               rotation: np.ndarray, origin: np.ndarray, pitch: float) -> np.ndarray:
    """Signed distance in mm to a plane given in CARDIAC coordinates.

    Positive is the side the normal points to. The traced and fitted valve data
    are all in the viewer's cardiac frame; the voxel grid is in model
    coordinates, so the plane is rotated in rather than the volume rotated out.
    """
    grid = np.indices(shape, dtype=np.float32)
    model_centre = rotation.T @ np.asarray(centre_cardiac, dtype=float)
    model_normal = rotation.T @ np.asarray(normal_cardiac, dtype=float)
    signed = np.zeros(shape, dtype=np.float32)
    for axis in range(3):
        signed += np.float32(model_normal[axis] * pitch) * grid[axis]
    offset = float(np.dot(model_normal, origin + 0.5 * pitch - model_centre))
    return signed + np.float32(offset)


def enforce_valve_side(labels: np.ndarray, side: np.ndarray,
                       basal_tag: int, apical_tag: int) -> tuple[np.ndarray, dict]:
    """Keep the atrium off the ventricular side of its valve plane, and back.

    `side` is positive basal. Both directions are applied from the SAME input, so
    the two rules cannot chase each other.
    """
    out = labels.copy()
    stray_atrium = (labels == basal_tag) & (side < 0)
    stray_ventricle = (labels == apical_tag) & (side > 0)
    out[stray_atrium] = apical_tag
    out[stray_ventricle] = basal_tag
    return out, {"atrium_to_ventricle": int(stray_atrium.sum()),
                 "ventricle_to_atrium": int(stray_ventricle.sum())}
