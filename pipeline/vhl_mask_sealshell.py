"""
Chamber space by SEALING the model with a shell built from the observer marks.

The premise of the whole VHL partition problem is that every valve orifice and
every great-vessel stub is modelled open, so the chamber lumen is continuous
with the outside world and no connectivity test can name it. The 553 round-two
marks are a human-placed sample of the OUTER surface, cut ends included. If a
solid shell is built through those marks and unioned with the tissue, the
complement of that union splits cleanly into

* an EXTERIOR — the component that reaches the grid border, and
* INTERIOR CAVITIES — everything else, which is what the chambers are.

`vhl_partition.interior_components` already performs exactly that split, so the
only thing this module has to supply is the shell.

The shell is the union of balls of radius `r` centred on the marks, i.e. the
`r`-sublevel set of the distance to the mark point set. That makes `r` the one
parameter, and this branch has already been burned by parameters, so `r` is not
chosen by eye. There is a well-posed criterion:

    r_seal = the smallest r at which every chamber seed stops being in the
             component that touches the grid border.

Below `r_seal` the shell leaks and the "cavity" is the outside world. Above it
the shell is thicker than it needs to be and starts eating wall and lumen, since
a ball centred on the epicardium of radius r reaches r millimetres INWARD, and
the right-ventricular free wall is only 3-5 mm thick. `sweep` walks r and
records the recovered volume, the per-chamber volumes and the amount of wall the
shell consumes, so the whole curve is reportable rather than a single point. A
plateau between "sealed" and "eating" is what would justify the method. Its
absence is a negative result and should be reported as one.

Nothing here mutates `vhl_partition` or `vhl_seed_partition`; both are imported.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

from vhl_partition import interior_components

EXCLUDE_TAG = 99


# --------------------------------------------------------------------------- #
# marks                                                                        #
# --------------------------------------------------------------------------- #


def mark_points(seeds: list[dict], tag: int = EXCLUDE_TAG) -> np.ndarray:
    """
    Model-space points of the barrier marks.

    `model_point_mm`, never `voxel`: the `voxel` field of a tag-99 mark is the
    labeller's "nearest surface" snap and disagrees with the clicked point by up
    to 13.6 mm, in some cases landing inside a chamber. Using it would place
    shell balls in the lumen.
    """
    return np.array([s["model_point_mm"] for s in seeds if s["tag"] == tag], dtype=np.float64)


def to_voxel(points: np.ndarray, origin: np.ndarray, pitch: float,
             n: int) -> tuple[np.ndarray, int]:
    """Nearest voxel index (array order k, j, i) for model points, plus a clip count."""
    index = np.rint((np.asarray(points, dtype=np.float64) - origin) / pitch - 0.5).astype(np.int64)
    outside = int(((index < 0) | (index >= n)).any(axis=1).sum())
    return np.clip(index, 0, n - 1), outside


def mark_distance_mm(shape: tuple[int, int, int], index: np.ndarray,
                     pitch: float) -> np.ndarray:
    """
    Distance in mm from every voxel to the nearest mark.

    One exact Euclidean transform serves every radius in the sweep, which is
    what makes a 30-point sweep affordable. The marks are snapped to voxel
    centres first, so the field carries up to half a voxel diagonal
    (0.34 mm here) of quantisation against the true point set.
    """
    seed = np.ones(shape, dtype=bool)
    seed[index[:, 0], index[:, 1], index[:, 2]] = False
    return (ndimage.distance_transform_edt(seed) * pitch).astype(np.float32)


def surface_spacing(points: np.ndarray, neighbours: int = 5) -> dict[str, list[float]]:
    """Nearest-neighbour distance percentiles of the mark set, in mm."""
    from scipy import spatial

    distance, _ = spatial.cKDTree(points).query(points, k=neighbours + 1)
    percentiles = [5, 25, 50, 75, 90, 99, 100]
    return {f"nn{k}": [round(float(np.percentile(distance[:, k], p)), 2)
                       for p in percentiles] for k in range(1, neighbours + 1)}


# --------------------------------------------------------------------------- #
# the seal                                                                     #
# --------------------------------------------------------------------------- #


@dataclass
class Seal:
    """One evaluation of the shell at a single radius."""

    radius_mm: float
    interior: np.ndarray = field(repr=False)   # bool, all non-border cavities
    shell_ml: float = 0.0
    interior_ml: float = 0.0
    cavity_count: int = 0
    seeds_interior: int = 0
    seeds_exterior: int = 0
    seeds_buried: int = 0
    sealed: bool = False


def seal_at(tissue: np.ndarray, distance_mm: np.ndarray, radius_mm: float,
            pitch: float, seed_index: np.ndarray) -> Seal:
    """
    Union the shell with the tissue and return the interior cavities.

    `seeds_buried` counts chamber seeds swallowed by the shell itself; that is
    the failure mode at large radius and it is separated from `seeds_exterior`,
    the failure mode at small radius, because the two mean opposite things.
    """
    shell = distance_mm <= np.float32(radius_mm)
    solid = tissue | shell
    labels, sizes = interior_components(~solid)

    keep = np.flatnonzero(sizes > 0)
    interior = np.isin(labels, keep) if keep.size else np.zeros_like(tissue)

    at_seed = labels[seed_index[:, 0], seed_index[:, 1], seed_index[:, 2]]
    solid_seed = solid[seed_index[:, 0], seed_index[:, 1], seed_index[:, 2]]
    buried = int(solid_seed.sum())
    inside = int(np.isin(at_seed, keep).sum())
    voxel_ml = pitch ** 3 / 1000.0

    return Seal(
        radius_mm=radius_mm,
        interior=interior,
        shell_ml=float(shell.sum()) * voxel_ml,
        interior_ml=float(interior.sum()) * voxel_ml,
        cavity_count=int(keep.size),
        seeds_interior=inside,
        seeds_exterior=int(len(seed_index) - inside - buried),
        seeds_buried=buried,
        sealed=(inside == len(seed_index)),
    )


def wall_thickness_mm(points: np.ndarray, tissue: np.ndarray, origin: np.ndarray,
                      pitch: float, smoothing: float = 1.5,
                      reach_mm: float = 25.0) -> np.ndarray:
    """
    Wall thickness under each mark, measured by marching inward along the
    smoothed surface normal until the tissue run ends.

    Independent of any cavity mask, which is the point: it answers "how deep can
    a ball at this mark reach before it is inside a chamber" without reference
    to the envelope that is under suspicion. `nan` where the ray never enters
    tissue (a mark over a cut end or a crevice).
    """
    field_ = ndimage.gaussian_filter(tissue.astype(np.float32), smoothing)
    gradient = np.stack(np.gradient(field_), axis=-1)

    index = np.rint((points - origin) / pitch - 0.5).astype(np.int64)
    index = np.clip(index, 0, tissue.shape[0] - 1)
    normal = gradient[index[:, 0], index[:, 1], index[:, 2]]
    norm = np.linalg.norm(normal, axis=1, keepdims=True)
    normal = np.divide(normal, np.where(norm > 0, norm, 1.0))  # points INTO the tissue

    steps = np.arange(0.0, reach_mm, pitch * 0.5)
    thickness = np.full(len(points), np.nan)
    for m in range(len(points)):
        ray = points[m] + np.outer(steps, normal[m])
        vox = np.clip(np.rint((ray - origin) / pitch - 0.5).astype(np.int64),
                      0, tissue.shape[0] - 1)
        occupied = tissue[vox[:, 0], vox[:, 1], vox[:, 2]]
        if not occupied.any():
            continue
        enter = int(np.argmax(occupied))
        rest = occupied[enter:]
        exit_ = np.flatnonzero(~rest)
        run = int(exit_[0]) if exit_.size else len(rest)
        thickness[m] = run * pitch * 0.5
    return thickness


def sweep(tissue: np.ndarray, distance_mm: np.ndarray, pitch: float,
          seed_index: np.ndarray, radii: np.ndarray,
          deep_lumen: np.ndarray | None = None) -> list[dict]:
    """
    Walk the radius and record the curve. Returns one row per radius.

    `deep_lumen` is an optional reference set of wide (>3 mm clearance) cavity
    voxels; `eaten_ml` is how much of it the shell covers, i.e. how much genuine
    cavity the seal destroys to close the orifices.
    """
    voxel_ml = pitch ** 3 / 1000.0
    rows: list[dict] = []
    for radius in radii:
        result = seal_at(tissue, distance_mm, float(radius), pitch, seed_index)
        row = {
            "r_mm": round(float(radius), 3),
            "shell_ml": round(result.shell_ml, 1),
            "interior_ml": round(result.interior_ml, 1),
            "cavities": result.cavity_count,
            "seeds_in": result.seeds_interior,
            "seeds_out": result.seeds_exterior,
            "seeds_buried": result.seeds_buried,
            "sealed": result.sealed,
        }
        if deep_lumen is not None:
            shell = distance_mm <= np.float32(radius)
            row["eaten_ml"] = round(float((shell & deep_lumen).sum()) * voxel_ml, 1)
        rows.append(row)
    return rows
