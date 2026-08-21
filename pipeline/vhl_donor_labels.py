"""
Naming the lobes: two routes tried, both negative, both reproducible from here.

`vhl_partition` recovers the VHL chamber lumen and splits it into stable lobes.
It cannot say which lobe is the left ventricle. This module is the attempt to
say so, and the record of why it does not succeed. The negative results are the
deliverable — a labelling produced anyway would be indistinguishable from a
correct one on inspection, which is precisely why neither is emitted.

ROUTE 1 — register a labelled donor onto the recovered lumen.

`anatomy-bodyparts3d-heart` is a better donor than its reputation. It carries a
1:1 cover of `anatomy.CHAMBER_TAGS` as separately modelled lumen casts, plus
ventricular free walls, valve leaflets and the caval/coronary trees. Casts are
the RIGHT shape for this: what a void-based partition of a tissue-only source
recovers IS lumen, so cast-against-lumen is like-for-like.

It fails on POSE, not on content. A heart cavity is close enough to an ellipsoid
that its principal axes do not fix handedness, and all four proper-rotation
starts converge under trimmed ICP to within 0.05 Dice of one another (best
0.547, margin 0.022). A margin that size cannot separate a left-right mirror,
and a mirror exchanges LV and RV. So the transfer is not performed.

Note the trap in the obvious alternative metric: mean nearest-neighbour distance
looks excellent (1.63 mm) for every start, because the target cloud is dense and
donor points land near SOME target point whatever the correspondence. It
measures proximity, not agreement. Dice is scored instead.

ROUTE 2 — identify the left ventricle by wall thickness.

The orientation-independent discriminator, and the one that needs no donor: the
LV free wall runs roughly 3x the RV (8-12 mm against 3-5 mm). Used as an ORDINAL
test only, because pediatric normative wall-thickness data is thin and this is a
14-year-old — the ordering is trustworthy, an absolute millimetre cut-off is not.

It finds no contrast on this model. Measured on compact myocardium at 0.387 mm
pitch, each lobe judged on its own free wall, the two lobes return identical
medians (1.16 mm) and identical maxima (4.12 mm), and the p90 differs by 0.31 mm
in the direction OPPOSITE to the expected reading. The ~3:1 ratio appears
nowhere. This segmentation's wall is largely trabecular, with a thin and roughly
uniform compact layer, so the contrast the method depends on is not present to
be measured. The method is sound; this substrate cannot feed it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from vhl_partition import (
    FACE_CONNECTED, Grid, closing, components, epicardial_envelope, opening, voxelise,
)

#: Donor structure id -> `anatomy.CHAMBER_TAGS` value. A complete cover of the
#: six tags, which is the fact that makes this donor worth trying at all.
DONOR_TAGS: dict[str, int] = {
    "cavity-of-left-ventricle": 1,
    "cavity-of-right-ventricle": 2,
    "cavity-of-left-atrium": 3,
    "cavity-of-right-atrium": 4,
    "ascending-aorta": 5,
    "pulmonary-trunk": 6,
}

#: Dice margin over the runner-up below which a registration is called
#: ambiguous and NOT used. Set by what is at stake rather than by convention:
#: the competing poses here differ by a mirror, so accepting a near-tie risks
#: exchanging LV and RV — an error that is invisible downstream because the
#: result still looks like a heart.
MIN_DICE_MARGIN = 0.10


@dataclass
class Registration:
    """A fitted pose, and everything needed to decide whether to trust it."""

    rotation: np.ndarray
    scale: float
    translation: np.ndarray
    dice: float
    runner_up_dice: float
    mean_nn_mm: float

    @property
    def margin(self) -> float:
        return self.dice - self.runner_up_dice

    @property
    def trustworthy(self) -> bool:
        return self.margin >= MIN_DICE_MARGIN


def read_donor_cavities(pack_assets: Path) -> dict[int, tuple[np.ndarray, np.ndarray]]:
    """The six labelled lumen casts, by anatomy tag."""
    gltf = json.loads((pack_assets / "model.gltf").read_text())
    buffer = (pack_assets / "model.bin").read_bytes()

    def accessor(index: int) -> np.ndarray:
        spec = gltf["accessors"][index]
        view = gltf["bufferViews"][spec["bufferView"]]
        offset, count = view.get("byteOffset", 0), spec["count"]
        if spec["type"] == "VEC3":
            return np.frombuffer(buffer, "<f4", count * 3, offset).reshape(count, 3)
        kind = "<u4" if spec["componentType"] == 5125 else "<u2"
        return np.frombuffer(buffer, kind, count, offset)

    by_name = {mesh["name"]: i for i, mesh in enumerate(gltf["meshes"])}
    out: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    for name, tag in DONOR_TAGS.items():
        if name not in by_name:
            continue
        primitive = gltf["meshes"][by_name[name]]["primitives"][0]
        vertices = np.asarray(accessor(primitive["attributes"]["POSITION"]), dtype=np.float64)
        faces = np.asarray(accessor(primitive["indices"])).reshape(-1, 3).astype(np.int64)
        out[tag] = (vertices, faces)
    return out


def donor_point_cloud(cavities: dict[int, tuple[np.ndarray, np.ndarray]],
                      resolution: int = 128) -> tuple[np.ndarray, np.ndarray]:
    """
    Uniformly sampled points with their tags.

    Sampled by voxelising rather than by taking mesh vertices: vertex density
    follows curvature, so a vertex cloud over-weights the fiddly ends of a
    lumen and under-weights its body, which biases both the centroid and the
    principal axes that the pose search starts from.
    """
    points, tags = [], []
    for tag, (vertices, faces) in sorted(cavities.items()):
        grid = voxelise(vertices, faces, resolution)
        index = np.argwhere(grid.mask)
        points.append(grid.origin + (index + 0.5) * grid.pitch)
        tags.append(np.full(len(index), tag, dtype=np.int32))
    return np.vstack(points), np.concatenate(tags)


def chamber_lumen_points(grid: Grid, seal_radius_mm: float = 10.0
                         ) -> tuple[np.ndarray, np.ndarray]:
    """The recovered VHL chamber lumen as a point cloud, plus its voxel mask."""
    envelope = epicardial_envelope(grid.mask, seal_radius_mm, grid.pitch)
    labels, sizes = components(envelope & ~grid.mask)
    cavity = labels == int(np.argmax(sizes))
    return grid.origin + (np.argwhere(cavity) + 0.5) * grid.pitch, cavity


def _principal_frame(points: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    centre = points.mean(axis=0)
    centred = points - centre
    values, vectors = np.linalg.eigh(centred.T @ centred / len(centred))
    order = np.argsort(-values)
    return centre, vectors[:, order], np.sqrt(values[order])


def register(source: np.ndarray, target: np.ndarray, target_mask: np.ndarray,
             grid: Grid, iterations: int = 40, seed: int = 0) -> Registration:
    """
    Fit donor to target from all four proper-rotation starts, and score by Dice.

    Every sign flip of the principal axes that keeps the determinant positive is
    a legitimate pose, and on a near-ellipsoidal cavity they are near-equally
    plausible. Running all four and reporting the MARGIN is the point: a single
    best fit reported alone would hide that three others fit almost as well.
    """
    rng = np.random.default_rng(seed)
    sample = source[rng.choice(len(source), min(60_000, len(source)), replace=False)]
    anchor = target[rng.choice(len(target), min(120_000, len(target)), replace=False)]
    tree = cKDTree(anchor)

    target_centre, target_axes, target_spread = _principal_frame(target)
    source_centre, source_axes, source_spread = _principal_frame(source)
    initial_scale = float(np.mean(target_spread / source_spread))

    origin = grid.origin

    def dice_against(moved: np.ndarray) -> float:
        index = np.round((moved - origin) / grid.pitch - 0.5).astype(int)
        inside = np.all((index >= 0) & (index < grid.mask.shape[0]), axis=1)
        occupied = np.zeros_like(target_mask)
        occupied[index[inside, 0], index[inside, 1], index[inside, 2]] = True
        return float(2 * (occupied & target_mask).sum() / (occupied.sum() + target_mask.sum()))

    results: list[Registration] = []
    for first in (1, -1):
        for second in (1, -1):
            flip = np.diag([float(first), float(second), 1.0])
            rotation = target_axes @ flip @ source_axes.T
            if np.linalg.det(rotation) < 0:
                rotation = target_axes @ np.diag([float(first), float(second), -1.0]) @ source_axes.T
            scale = initial_scale
            translation = target_centre - (source_centre @ rotation.T) * scale

            for _ in range(iterations):
                moved = (sample @ rotation.T) * scale + translation
                distance, nearest = tree.query(moved, k=1)
                keep = distance < np.percentile(distance, 80)   # trim outliers
                a, b = sample[keep], anchor[nearest[keep]]
                a_centre, b_centre = a.mean(axis=0), b.mean(axis=0)
                u, _, vt = np.linalg.svd((a - a_centre).T @ (b - b_centre))
                correction = np.diag([1.0, 1.0, float(np.sign(np.linalg.det(vt.T @ u.T)))])
                rotation = vt.T @ correction @ u.T
                scale = float(np.sum((b - b_centre) * ((a - a_centre) @ rotation.T))
                              / np.sum((a - a_centre) ** 2))
                translation = b_centre - (a_centre @ rotation.T) * scale

            moved = (sample @ rotation.T) * scale + translation
            distance, _ = tree.query(moved, k=1)
            results.append(Registration(
                rotation=rotation, scale=scale, translation=translation,
                dice=dice_against((source @ rotation.T) * scale + translation),
                runner_up_dice=0.0, mean_nn_mm=float(distance.mean()),
            ))

    results.sort(key=lambda r: -r.dice)
    best, second = results[0], results[1]
    best.runner_up_dice = second.dice
    return best


def wall_thickness_contrast(grid: Grid, seal_radius_mm: float = 10.0,
                            core_threshold_mm: float = 6.0,
                            trabecula_radius_mm: float = 1.5) -> list[dict]:
    """
    Free-wall thickness of each chamber-scale lobe, for the LV-is-thicker test.

    Two choices carry the measurement. Thickness is taken on COMPACT myocardium
    — an opening strips the trabeculae that would otherwise dominate any shell
    drawn around a lobe and drag every lobe to the same thin median. And each
    lobe is measured only where it is the NEARER of the two, so each is judged
    on its own free wall instead of both sharing the septum between them.
    """
    envelope = epicardial_envelope(grid.mask, seal_radius_mm, grid.pitch)
    labels, sizes = components(envelope & ~grid.mask)
    cavity = labels == int(np.argmax(sizes))
    bridged = closing(cavity, 2.0, grid.pitch) & ~grid.mask
    distance = ndimage.distance_transform_edt(bridged) * grid.pitch

    compact = opening(grid.mask, trabecula_radius_mm, grid.pitch)
    thickness = ndimage.distance_transform_edt(compact) * grid.pitch

    cores, _ = ndimage.label(distance >= core_threshold_mm, structure=FACE_CONNECTED)
    counts = np.bincount(cores.ravel())
    counts[0] = 0
    chamber_scale = np.flatnonzero(counts * grid.voxel_mm3 > 8000.0)
    if len(chamber_scale) != 2:
        return []

    to_core = [ndimage.distance_transform_edt(cores != label) * grid.pitch
               for label in chamber_scale]
    rows: list[dict] = []
    for i, label in enumerate(chamber_scale):
        own = to_core[i] < to_core[1 - i]
        shell = compact & own & (to_core[i] > 0) & (to_core[i] <= 10.0)
        values = thickness[shell]
        centre = grid.origin + (np.argwhere(cores == label).mean(axis=0) + 0.5) * grid.pitch
        rows.append({
            "core": int(label),
            "cavity_ml": round(float(counts[label]) * grid.voxel_mm3 / 1000, 1),
            "centroid_mm": [round(float(v), 1) for v in centre],
            "median_half_thickness_mm": round(float(np.median(values)), 2),
            "p90_half_thickness_mm": round(float(np.percentile(values, 90)), 2),
            "max_half_thickness_mm": round(float(values.max()), 2),
        })
    return rows
