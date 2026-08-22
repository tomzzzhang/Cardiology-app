"""
Assign each myocardial voxel to the chamber it belongs to.

`normal-rodero` ships per-chamber MYOCARDIUM - lv-myocardium, rv-myocardium and
so on - not just lumen, which is why its renders read as a labelled heart from the
outside. This source has no such labels, but once the lumen is partitioned they
follow: a piece of wall belongs to the chamber whose cavity it encloses, and the
nearest labelled lumen voxel says which that is.

The interventricular septum comes out split down its middle, which is the honest
answer - it is shared, and no labelling of a single voxel can say otherwise.

Distance is measured with the voxel pitch, so `max_reach_mm` is a real distance:
wall further than that from any cavity is left unassigned rather than attributed
to whichever chamber happens to be least far away. That matters at the great
vessels and the atrial roof, where the nearest cavity can be centimetres off.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage


def assign(tissue: np.ndarray, lumen_labels: np.ndarray, pitch: float,
           max_reach_mm: float = 12.0) -> np.ndarray:
    """Return a label volume over `tissue`, one tag per chamber, 0 where unclaimed."""
    labelled = lumen_labels > 0
    if not labelled.any():
        return np.zeros_like(lumen_labels)
    distance, index = ndimage.distance_transform_edt(
        ~labelled, sampling=pitch, return_indices=True)
    nearest = lumen_labels[index[0], index[1], index[2]]
    out = np.where(tissue & (distance <= max_reach_mm), nearest, 0)
    return out.astype(lumen_labels.dtype)
