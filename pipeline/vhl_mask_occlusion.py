"""
Chamber space by LINE-OF-SIGHT OCCLUSION from the observer's barrier marks.

The owner's rule, taken literally:

    "If there is tissue / heart wall between the chamber and a 99 seed, the
     seed must not affect the chamber's permeation."

That is a statement about VISIBILITY, and visibility is computable per voxel
with no flood, no competition and no race:

    a free voxel is OUTSIDE  <=>  the straight segment from it to at least one
                                  tag-99 mark (at `model_point_mm`) is
                                  unobstructed by tissue.

    chamber_space = free  AND NOT outside

`free` here is the existing `space` mask (the epicardial-envelope cavity), which
is a superset of the true lumen: the envelope only ever ADDS the film between
the true epicardium and the envelope, plus trabecular interstices.  Both of
those additions lie on the outside of the wall, so both are directly visible
from a mark that was clicked on the epicardial surface, while chamber lumen is
not: the wall is between.  Occlusion is exactly the discriminator the envelope
lacks.

Formulation (option (a) of the two the brief names).  All-pairs is
7.5e6 voxels x 553 marks = 4.2e9 segments, so each voxel is tested against its
`k` NEAREST marks only, k small, with a vectorised fixed-step DDA that carries
an active set and drops a pair the moment it hits tissue or arrives.  Testing
only the k nearest marks can only MISS visibility (a voxel visible solely from a
far mark is kept), so this is an OVER-estimate of chamber space and an
UNDER-estimate of the removed film.  `k` is therefore not a free knob but a
convergence parameter: the visible set grows monotonically with k and the honest
answer is the plateau.  `sample_full_visibility` audits the residual by testing
a random sample of survivors against ALL 553 marks.

Marks are used at `model_point_mm` only.  The `voxel` field of a tag-99 mark is
corrupt (p50 2.40 mm, max 13.56 mm from its own `model_point_mm`) and is never
read here.  A mark that lands inside a tissue voxel (6 of 553 do, by click
slop against the voxelisation) is snapped to the nearest free voxel centre, so
that every light source is a real free voxel and the visibility test needs no
tolerance parameter at the far end.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage, spatial


# --------------------------------------------------------------------------- #
# geometry helpers                                                             #
# --------------------------------------------------------------------------- #

def voxel_centres_mm(index: np.ndarray, origin: np.ndarray, pitch: float) -> np.ndarray:
    """Model mm of integer voxel indices `[k, j, i]` (array order == mm order)."""
    return origin[None, :] + (index.astype(np.float64) + 0.5) * pitch


def mm_to_index(points: np.ndarray, origin: np.ndarray, pitch: float) -> np.ndarray:
    """Nearest voxel index of model-mm points. Not clipped."""
    return np.rint((points - origin[None, :]) / pitch - 0.5).astype(np.int64)


def snap_to_free(points_mm: np.ndarray, tissue: np.ndarray,
                 origin: np.ndarray, pitch: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Move every mark to the centre of the nearest non-tissue voxel.

    Returns (snapped_mm, moved_mm, inside_grid). Marks outside the grid are
    reported and dropped by the caller.
    """
    n = tissue.shape[0]
    idx = mm_to_index(points_mm, origin, pitch)
    inside = np.all((idx >= 0) & (idx < n), axis=1)
    safe = np.clip(idx, 0, n - 1)
    _, nearest = ndimage.distance_transform_edt(tissue, return_indices=True,
                                                return_distances=True)
    k, j, i = safe[:, 0], safe[:, 1], safe[:, 2]
    in_tissue = tissue[k, j, i]
    out = safe.copy()
    out[in_tissue, 0] = nearest[0][k, j, i][in_tissue]
    out[in_tissue, 1] = nearest[1][k, j, i][in_tissue]
    out[in_tissue, 2] = nearest[2][k, j, i][in_tissue]
    snapped = voxel_centres_mm(out, origin, pitch)
    moved = np.linalg.norm(snapped - points_mm, axis=1)
    return snapped, moved, inside


# --------------------------------------------------------------------------- #
# the visibility test                                                          #
# --------------------------------------------------------------------------- #

def visible_from_marks(tissue: np.ndarray, origin: np.ndarray, pitch: float,
                       cand_mm: np.ndarray, marks_mm: np.ndarray,
                       k: int, step_frac: float = 0.4,
                       chunk: int = 1_000_000,
                       progress=None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    For each candidate point, is the segment to one of its `k` nearest marks
    free of tissue?

    Returns (visible, seen_dist_mm, rank_used):
      visible     bool, one per candidate
      seen_dist   distance in mm to the mark that saw it (inf if none did) --
                  this is the depth the sight-line reached, and it is the number
                  that measures intrusion through a cut vessel end
      rank_used   which nearest-neighbour rank succeeded (-1 if none)

    Fixed-step DDA at `step_frac` of a voxel, nearest-voxel lookup, with an
    active set so a pair costs only as many samples as it survives.
    """
    n = tissue.shape[0]
    flat = tissue.reshape(-1)
    tree = spatial.cKDTree(marks_mm)
    k = min(k, len(marks_mm))
    step = step_frac * pitch

    total = len(cand_mm)
    visible = np.zeros(total, dtype=bool)
    seen = np.full(total, np.inf, dtype=np.float32)
    rank_used = np.full(total, -1, dtype=np.int16)

    for start in range(0, total, chunk):
        stop = min(start + chunk, total)
        pts = cand_mm[start:stop]
        dist, nn = tree.query(pts, k=k, workers=-1)
        if k == 1:
            dist, nn = dist[:, None], nn[:, None]
        local_vis = np.zeros(len(pts), dtype=bool)
        local_seen = np.full(len(pts), np.inf, dtype=np.float32)
        local_rank = np.full(len(pts), -1, dtype=np.int16)

        for r in range(k):
            todo = np.flatnonzero(~local_vis)
            if todo.size == 0:
                break
            src = pts[todo]
            tgt = marks_mm[nn[todo, r]]
            length = dist[todo, r].astype(np.float32)
            delta = (tgt - src).astype(np.float32)
            norm = np.linalg.norm(delta, axis=1)
            unit = np.zeros_like(delta)
            good = norm > 1e-9
            unit[good] = delta[good] / norm[good, None]

            # A candidate that IS a mark voxel is trivially visible.
            arrived = ~good
            active = np.flatnonzero(good)
            pos = (src + unit * step).astype(np.float32)
            travelled = np.full(len(todo), step, dtype=np.float32)

            while active.size:
                p = pos[active]
                idx = np.rint((p - origin[None, :].astype(np.float32)) / pitch - 0.5).astype(np.int64)
                np.clip(idx, 0, n - 1, out=idx)
                hit = flat[(idx[:, 0] * n + idx[:, 1]) * n + idx[:, 2]]
                reach = travelled[active] >= (length[active] - 0.5 * step)
                arrived[active[reach & ~hit]] = True
                done = hit | reach
                active = active[~done]
                if active.size:
                    travelled[active] += step
                    pos[active] += unit[active] * step

            got = todo[arrived]
            local_vis[got] = True
            local_seen[got] = length[arrived]
            local_rank[got] = r

        visible[start:stop] = local_vis
        seen[start:stop] = local_seen
        rank_used[start:stop] = local_rank
        if progress is not None:
            progress(stop, total, int(local_vis.sum()))
    return visible, seen, rank_used


def sample_full_visibility(tissue: np.ndarray, origin: np.ndarray, pitch: float,
                           cand_mm: np.ndarray, marks_mm: np.ndarray,
                           step_frac: float = 0.4) -> tuple[np.ndarray, np.ndarray]:
    """
    Exhaustive test of a (small) candidate set against ALL marks.

    Used to audit how much visibility the k-nearest truncation missed. Cost is
    len(cand) * len(marks) segments, so keep len(cand) in the low tens of
    thousands.
    """
    return visible_from_marks(tissue, origin, pitch, cand_mm, marks_mm,
                              k=len(marks_mm), step_frac=step_frac,
                              chunk=max(1, 20_000_000 // max(1, len(marks_mm))))


# --------------------------------------------------------------------------- #
# the mask                                                                     #
# --------------------------------------------------------------------------- #

@dataclass
class OcclusionResult:
    mask: np.ndarray
    visible: np.ndarray          # per candidate voxel
    seen_dist_mm: np.ndarray     # per candidate voxel
    cand_index: np.ndarray       # (N,3) voxel indices of the candidates
    marks_mm: np.ndarray         # snapped marks actually used
    stats: dict = field(default_factory=dict)


def occlusion_mask(tissue: np.ndarray, space: np.ndarray, origin: np.ndarray,
                   pitch: float, marks_mm: np.ndarray, k: int = 16,
                   step_frac: float = 0.4, progress=None) -> OcclusionResult:
    """
    chamber_space = space AND NOT (visible from any of the k nearest marks).
    """
    snapped, moved, inside = snap_to_free(marks_mm, tissue, origin, pitch)
    used = snapped[inside]
    cand_index = np.argwhere(space)
    cand_mm = voxel_centres_mm(cand_index, origin, pitch)
    visible, seen, rank = visible_from_marks(tissue, origin, pitch, cand_mm, used,
                                             k=k, step_frac=step_frac, progress=progress)
    mask = np.zeros_like(space)
    keep = cand_index[~visible]
    mask[keep[:, 0], keep[:, 1], keep[:, 2]] = True
    return OcclusionResult(mask=mask, visible=visible, seen_dist_mm=seen,
                           cand_index=cand_index, marks_mm=used,
                           stats={"marks_snapped": int((moved > 1e-9).sum()),
                                  "snap_max_mm": float(moved.max()),
                                  "marks_outside_grid": int((~inside).sum()),
                                  "rank_hist": np.bincount(rank[rank >= 0],
                                                           minlength=k).tolist()})
