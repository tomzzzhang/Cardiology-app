"""
Substrate probe: what kind of geometry is this, actually?

`docs/build_plan.md` ("Anatomical substrate risk") states the problem this module
exists to settle: the echo renderer consumes labelled TISSUE, and "splitting an
STL cannot create tissue that is not there". A blood-pool cast and a myocardial
wall look alike in a thumbnail and behave completely differently under a cut
plane, so the classification has to be measured, not eyeballed.

The measurements here are deliberately blunt and geometric:

* **ray parity** — fire rays through the model and count surface crossings. A
  solid cast crosses twice (in, out). A hollow wall crosses four or more times
  (epicardium in, endocardium in, endocardium out, epicardium out). This is the
  single most decisive test of whether interior surfaces exist at all.
* **shell pairing** — for a two-surface model, the distance from each blood-pool
  point to the nearest myocardial point *is* the wall thickness. Its spread says
  whether the pairing is consistent or whether the second surface merely floats.
* **enclosure** — what fraction of one surface lies inside the other, which
  separates "an outer wall around this cast" from "an unrelated second object".
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import trimesh
from scipy.spatial import cKDTree

from meshlib import Surface


@dataclass
class RayParity:
    """Distribution of surface crossings along random interior rays."""

    sampled: int
    histogram: dict[int, int]
    max_crossings: int
    fraction_over_two: float

    def verdict(self) -> str:
        if self.sampled == 0:
            return "no rays hit the model — inconclusive"
        if self.fraction_over_two >= 0.5:
            return "interior surfaces present (majority of rays cross more than twice)"
        if self.fraction_over_two >= 0.1:
            return "interior surfaces present in places, but most of the model is solid"
        return "no interior surfaces — the mesh behaves as a closed solid"


@dataclass
class SubstrateReport:
    label: str
    triangles: int
    vertices: int
    bounds_mm: tuple[list[float], list[float]]
    extent_mm: list[float]
    watertight: bool
    components: int
    euler_number: int
    volume_mm3: float
    area_mm2: float
    parity: RayParity | None = None
    thickness_mm: dict[str, float] = field(default_factory=dict)
    enclosure: dict[str, float] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def to_trimesh(surface: Surface) -> trimesh.Trimesh:
    return trimesh.Trimesh(
        vertices=np.asarray(surface.vertices, dtype=np.float64),
        faces=np.asarray(surface.faces, dtype=np.int64),
        process=False,
    )


def ray_parity(mesh: trimesh.Trimesh, *, samples: int = 400, seed: int = 20260818) -> RayParity:
    """
    Count how many times each of `samples` rays crosses the surface.

    Rays are fired along +X from a plane just outside the model, aimed at points
    scattered through the bounding box, so they sweep the whole heart rather than
    a single chamber. Crossings are counted with `intersects_location`, which
    returns every hit rather than the first.
    """
    rng = np.random.default_rng(seed)
    low, high = mesh.bounds
    span = high - low

    # Start outside the -X face; jitter the other two axes across the middle 80%
    # of the model so rays pass through chambers rather than skimming the apex.
    count = samples
    origins = np.empty((count, 3))
    origins[:, 0] = low[0] - 0.05 * span[0]
    origins[:, 1] = low[1] + span[1] * rng.uniform(0.1, 0.9, count)
    origins[:, 2] = low[2] + span[2] * rng.uniform(0.1, 0.9, count)
    directions = np.tile(np.array([1.0, 0.0, 0.0]), (count, 1))

    locations, ray_indices, _ = mesh.ray.intersects_location(
        ray_origins=origins, ray_directions=directions, multiple_hits=True
    )
    hits = np.bincount(ray_indices, minlength=count)

    sampled = int(np.count_nonzero(hits))
    histogram: dict[int, int] = {}
    for value in hits[hits > 0]:
        histogram[int(value)] = histogram.get(int(value), 0) + 1
    over_two = int(np.count_nonzero(hits > 2))
    return RayParity(
        sampled=sampled,
        histogram=dict(sorted(histogram.items())),
        max_crossings=int(hits.max()) if hits.size else 0,
        fraction_over_two=(over_two / sampled) if sampled else 0.0,
    )


def describe(label: str, surface: Surface, *, do_parity: bool = True) -> SubstrateReport:
    mesh = to_trimesh(surface)
    low, high = mesh.bounds
    report = SubstrateReport(
        label=label,
        triangles=surface.triangle_count,
        vertices=surface.vertex_count,
        bounds_mm=(low.tolist(), high.tolist()),
        extent_mm=(high - low).tolist(),
        watertight=bool(mesh.is_watertight),
        components=int(len(mesh.split(only_watertight=False))),
        euler_number=int(mesh.euler_number),
        volume_mm3=float(abs(mesh.volume)),
        area_mm2=float(mesh.area),
    )
    if do_parity:
        report.parity = ray_parity(mesh)
    return report


def pair_thickness(
    inner: Surface, outer: Surface, *, samples: int = 20000, seed: int = 20260818
) -> dict[str, float]:
    """
    Distance from the inner (blood-pool) surface to the nearest point on the
    outer (myocardial) surface — i.e. candidate wall thickness, in model units.

    A genuine shell gives a tight, physiologically plausible distribution. A
    second surface that is a rendering flourish, a duplicate, or an unrelated
    object gives either near-zero distances everywhere or a spread far too wide
    to be a wall.

    Distances are measured point-to-nearest-*vertex* via a KD-tree rather than
    point-to-nearest-*triangle*. On these meshes that is not a meaningful
    approximation: the outer surface carries 437k vertices over ~19,000 mm² of
    area, a mean spacing near 0.2 mm, which is an order of magnitude below the
    millimetre-scale wall thickness being measured. The exact query is
    `trimesh.proximity.closest_point`, which costs hours at this triangle count
    and buys nothing the verdict depends on.
    """
    rng = np.random.default_rng(seed)
    tree = cKDTree(np.asarray(outer.vertices, dtype=np.float64))
    points = np.asarray(inner.vertices, dtype=np.float64)
    if points.shape[0] > samples:
        points = points[rng.choice(points.shape[0], samples, replace=False)]

    distance, _ = tree.query(points, k=1, workers=-1)
    percentiles = np.percentile(distance, [1, 5, 25, 50, 75, 95, 99])
    return {
        "n": int(distance.size),
        "min": float(distance.min()),
        "p01": float(percentiles[0]),
        "p05": float(percentiles[1]),
        "p25": float(percentiles[2]),
        "median": float(percentiles[3]),
        "p75": float(percentiles[4]),
        "p95": float(percentiles[5]),
        "p99": float(percentiles[6]),
        "max": float(distance.max()),
        "mean": float(distance.mean()),
        "std": float(distance.std()),
        # Fraction of the blood-pool surface sitting essentially ON the second
        # surface. High means the two are coincident — one shared surface drawn
        # with two materials, not a wall with thickness.
        "fraction_within_0p2mm": float(np.mean(distance < 0.2)),
        "fraction_within_0p5mm": float(np.mean(distance < 0.5)),
    }


def enclosure(inner: Surface, outer: Surface, *, samples: int = 1500, seed: int = 20260818) -> dict[str, float]:
    """Fraction of sampled inner-surface points that fall inside the outer surface."""
    rng = np.random.default_rng(seed)
    outer_mesh = to_trimesh(outer)
    points = np.asarray(inner.vertices, dtype=np.float64)
    if points.shape[0] > samples:
        points = points[rng.choice(points.shape[0], samples, replace=False)]
    contained = outer_mesh.contains(points)
    return {
        "n": int(points.shape[0]),
        "fraction_inside": float(np.mean(contained)),
    }


def wall_chords(
    mesh: trimesh.Trimesh, *, samples: int = 600, seed: int = 20260818
) -> dict[str, float]:
    """
    Length of the solid segments a ray crosses — i.e. chords through the wall.

    For a watertight, consistently wound surface, hits along a ray alternate
    entering/leaving, so the segment between hit 0 and 1, hit 2 and 3, and so on
    lies *inside* the material. Where the material is a myocardial wall, those
    segments are wall crossings.

    A chord is an over-estimate of true thickness by 1/cos(angle of incidence),
    so the distribution's lower percentiles are the honest reading and the mean
    is not. Reported as a distribution for exactly that reason: this measures
    whether a plausible wall exists and how uniform it is, and is not a
    substitute for a proper medial-axis thickness.
    """
    rng = np.random.default_rng(seed)
    low, high = mesh.bounds
    span = high - low

    origins = np.empty((samples, 3))
    origins[:, 0] = low[0] - 0.05 * span[0]
    origins[:, 1] = low[1] + span[1] * rng.uniform(0.1, 0.9, samples)
    origins[:, 2] = low[2] + span[2] * rng.uniform(0.1, 0.9, samples)
    directions = np.tile(np.array([1.0, 0.0, 0.0]), (samples, 1))

    locations, ray_indices, _ = mesh.ray.intersects_location(
        ray_origins=origins, ray_directions=directions, multiple_hits=True
    )
    if locations.size == 0:
        return {"n": 0}

    chords: list[float] = []
    for ray in np.unique(ray_indices):
        xs = np.sort(locations[ray_indices == ray][:, 0])
        if xs.size < 2 or xs.size % 2:
            continue  # odd hit count means a degenerate/open region — skip it
        chords.extend((xs[1::2] - xs[0::2]).tolist())

    values = np.asarray(chords)
    values = values[values > 1e-6]
    if values.size == 0:
        return {"n": 0}
    percentiles = np.percentile(values, [5, 10, 25, 50, 75, 90, 95])
    return {
        "n": int(values.size),
        "p05": float(percentiles[0]),
        "p10": float(percentiles[1]),
        "p25": float(percentiles[2]),
        "median": float(percentiles[3]),
        "p75": float(percentiles[4]),
        "p90": float(percentiles[5]),
        "p95": float(percentiles[6]),
        "mean": float(values.mean()),
        "max": float(values.max()),
    }
