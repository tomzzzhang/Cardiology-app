"""
Turn observer-placed seeds into a per-chamber partition, and into a frame.

The counterpart to `vhl_label_tool_3d`, which collects the seeds. Everything
here ran as throwaway scripts during the session that produced the first round
of seeds; it is a module so the next run is `python pipeline/vhl_seed_partition.py
--seeds <file>` rather than a reconstruction.

Two things come out of a seed file, and the first is the more valuable:

* **A cardiac frame.** The labeller never asks which way is patient-left. The
  observer names chambers and the frame is derived from where those chambers
  turn out to sit, so the orientation is an OUTPUT rather than an assumption.
  On round one this showed the pack's declared orientation is wrong by 37.6,
  77.9 and 65.3 degrees on the three axes — its "up" is nearly perpendicular to
  the true base-apex axis.

* **A partition**, by geodesic flood through the chamber space. This one is not
  finished; see `LEAK` below.

LEAK — the open problem this module exists to close.

`cavity = epicardial_envelope AND NOT tissue` is not only chamber. It also holds
the film between the true epicardium and the morphological envelope, and the
trabecular interstices. Both are connected sheets wrapping the whole organ, so
whichever label touches one first inherits all of it. On round one the right
ventricle took 257 mL that way, with a bounding extent of 95 x 105 x 128 mm
against a whole-heart 109 x 122 x 144.

Four attempts to fix it in software, all recorded because each looks reasonable:

1. Plain geodesic BFS: RV 238 mL.
2. Priority flood by descending clearance, the textbook watershed on the
   distance transform: RV 279 mL. It has a second failure worth knowing —
   priority is the voxel's ABSOLUTE clearance, so a seed inside a wide chamber
   sweeps up narrow territory before a seed sitting in that narrow structure is
   ever processed, and small structures lose everything.
3. Dijkstra with step cost `1/(clearance + 0.5)`, making narrow passages
   expensive: RV 257 mL. A 20x penalty is not enough over a long path.
4. Flooding only above a clearance threshold: RV 179 mL, better, still wrapping.

None of them can work, and the reason is structural rather than a tuning
failure: the bogus pockets the envelope bridges are AS WIDE as the valve
orifices it must seal, so no single radius separates them.

The fix is the observer, via `EXCLUDE_TAG`. A "not lumen" mark makes the leak
space its own territory, competing on equal terms, and no chamber can spread
through it. That is what round two collects.
"""

from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import ndimage

from vhl_label_tool_3d import EXCLUDE_TAG
from vhl_partition import components, epicardial_envelope

#: Tag -> short name, for reports.
TAG_NAMES = {1: "LV", 2: "RV", 3: "LA", 4: "RA", 5: "Aorta", 6: "PA",
             EXCLUDE_TAG: "not-lumen"}

#: Normal ranges for a 14-year-old, in mL, for sanity-checking a result. NOT a
#: gate: a chamber outside these is a prompt to look, not a failure.
EXPECTED_ML = {1: (60, 100), 2: (60, 100), 3: (25, 45), 4: (25, 45),
               5: (15, 25), 6: (15, 25)}


@dataclass
class Frame:
    """A cardiac basis derived from seeds, and the checks it did not use."""

    patient_left: np.ndarray
    base: np.ndarray
    anterior: np.ndarray
    #: Angle between the raw left-right and base axes before orthogonalisation.
    #: Near 90 degrees means the seeds are internally consistent — it is not
    #: imposed, so it is evidence.
    raw_axis_angle_deg: float
    checks: dict[str, tuple[bool, float]]

    def declared_disagreement(self) -> dict[str, float]:
        """Angle from each declared model axis, in degrees."""
        declared = {"patient_left": np.array([1.0, 0, 0]),
                    "base": np.array([0, 1.0, 0]),
                    "anterior": np.array([0, 0, 1.0])}
        return {name: float(np.degrees(np.arccos(np.clip(
            abs(float(np.dot(declared[name], getattr(self, name)))), -1, 1))))
            for name in declared}


def load_seeds(path: Path) -> list[dict]:
    return json.loads(Path(path).read_text())["seeds"]


def chamber_space(tissue: np.ndarray, pitch: float,
                  seal_radius_mm: float = 10.0) -> np.ndarray:
    """The connected space inside the epicardium. Includes the leak; see LEAK."""
    envelope = epicardial_envelope(tissue, seal_radius_mm, pitch)
    labels, sizes = components(envelope & ~tissue)
    return labels == int(np.argmax(sizes))


def derive_frame(seeds: list[dict]) -> Frame:
    """
    Build a cardiac basis from the seed centroids.

    Left-right comes from RV to LV, base from the ventricles to the atria. Only
    those two are used; anterior is forced by the cross product, and everything
    else is a check rather than an input.

    A check that was reported in an earlier session and is deliberately NOT here:
    "RV anterior to LV". It is circular — the left-right axis is built FROM the
    LV-RV difference, so those two centroids cannot differ along the
    perpendicular by construction. It passed at +0.0 mm and measured nothing.
    """
    centre = {t: np.array([s["model_point_mm"] for s in seeds if s["tag"] == t]).mean(axis=0)
              for t in {s["tag"] for s in seeds if s["tag"] in TAG_NAMES and s["tag"] != EXCLUDE_TAG}}
    for needed in (1, 2, 3, 4):
        if needed not in centre:
            raise ValueError(f"no seeds for {TAG_NAMES[needed]}; the frame needs all four chambers")

    def unit(v: np.ndarray) -> np.ndarray:
        return v / np.linalg.norm(v)

    raw_left = centre[1] - centre[2]
    raw_base = (centre[3] + centre[4]) / 2 - (centre[1] + centre[2]) / 2
    angle = float(np.degrees(np.arccos(np.clip(
        abs(float(np.dot(unit(raw_left), unit(raw_base)))), -1, 1))))

    left = unit(raw_left)
    base = unit(raw_base - float(np.dot(raw_base, left)) * left)
    anterior = np.cross(left, base)

    origin = (centre[1] + centre[2]) / 2
    def along(tag: int, axis: np.ndarray) -> float:
        return float(np.dot(centre[tag] - origin, axis))

    checks = {
        # The atria are separated far more strongly front-to-back than
        # left-to-right, so this is the reliable one.
        "LA posterior to RA": (along(3, anterior) < along(4, anterior),
                               along(4, anterior) - along(3, anterior)),
        # Weak: the interatrial septum is oblique and the atria genuinely
        # overlap on this axis. Round one failed it by 11 mm and the labels were
        # still right, so treat a small failure as uninformative.
        "RA right of LA": (along(3, left) > along(4, left),
                           along(3, left) - along(4, left)),
    }
    if 5 in centre:
        checks["aorta basal to ventricles"] = (along(5, base) > 0, along(5, base))
    return Frame(left, base, anterior, angle, checks)


def flood(space: np.ndarray, seeds: list[dict], shape_pitch: float) -> np.ndarray:
    """
    Geodesic multi-source flood through `space`, six-connected.

    Equal step cost, so a plain queue gives exact geodesic distance and no
    priority queue is needed. Geodesic rather than Euclidean is the whole point:
    a label cannot cross the septum, because the septum is not in `space`.

    Seeds carrying `EXCLUDE_TAG` compete exactly like chambers, which is how a
    "not lumen" mark stops a leak. They are stripped from the result by
    `strip_exclude`, not here, so the caller can see how much space the barrier
    claimed.
    """
    n = space.shape[0]
    labels = np.zeros(space.shape, dtype=np.uint8)
    flat, mask = labels.reshape(-1), space.reshape(-1)
    queue: deque[int] = deque()
    for seed in seeds:
        k, j, i = seed["voxel"]
        if not (0 <= k < n and 0 <= j < n and 0 <= i < n):
            continue
        index = (k * n + j) * n + i
        if mask[index] and flat[index] == 0:
            flat[index] = seed["tag"] if seed["tag"] != EXCLUDE_TAG else 255
            queue.append(index)

    steps = (n * n, -n * n, n, -n, 1, -1)
    while queue:
        current = queue.popleft()
        value = flat[current]
        k, remainder = divmod(current, n * n)
        j, i = divmod(remainder, n)
        for axis, step in enumerate(steps):
            # Guard the wrap-around at each row and plane edge, which a flat
            # index cannot see: without this a flood escapes off one face of the
            # volume and reappears on the other.
            if axis == 2 and j == n - 1: continue
            if axis == 3 and j == 0: continue
            if axis == 4 and i == n - 1: continue
            if axis == 5 and i == 0: continue
            neighbour = current + step
            if neighbour < 0 or neighbour >= flat.size:
                continue
            if mask[neighbour] and flat[neighbour] == 0:
                flat[neighbour] = value
                queue.append(neighbour)
    return labels


def strip_exclude(labels: np.ndarray) -> tuple[np.ndarray, float]:
    """Remove the barrier territory, returning it as a voxel count."""
    barrier = labels == 255
    cleaned = labels.copy()
    cleaned[barrier] = 0
    return cleaned, float(barrier.sum())


def report(labels: np.ndarray, voxel_mm3: float) -> list[dict]:
    rows = []
    for tag in sorted(EXPECTED_ML):
        volume = float((labels == tag).sum()) * voxel_mm3 / 1000.0
        low, high = EXPECTED_ML[tag]
        present = (labels == tag)
        extent = ((np.argwhere(present).max(axis=0) - np.argwhere(present).min(axis=0))
                  if present.any() else np.zeros(3))
        rows.append({
            "tag": tag, "name": TAG_NAMES[tag], "ml": round(volume, 1),
            "expected_ml": [low, high],
            "in_range": low <= volume <= high,
            "extent_voxels": [int(v) for v in extent],
        })
    return rows


def main() -> int:
    import argparse
    import sys

    root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root / "pipeline"))

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True,
                        help="Heart102_Tissue.stl (gitignored, CC BY-NC)")
    parser.add_argument("--resolution", type=int, default=384)
    parser.add_argument("--out", type=Path, default=root / "output/vhl-partition")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    import geometry
    from meshlib import read_binary_stl
    from vhl_partition import voxelise

    surface, _ = geometry.weld(read_binary_stl(args.source))
    grid = voxelise(surface.vertices, surface.faces, args.resolution)
    seeds = load_seeds(args.seeds)
    counts: dict[int, int] = {}
    for seed in seeds:
        counts[seed["tag"]] = counts.get(seed["tag"], 0) + 1
    print("seeds: " + ", ".join(f"{TAG_NAMES.get(t, t)}={n}" for t, n in sorted(counts.items())))

    space = chamber_space(grid.mask, grid.pitch)
    inside = sum(1 for s in seeds if space[tuple(s["voxel"])])
    print(f"chamber space {space.sum() * grid.voxel_mm3 / 1000:.1f} mL; "
          f"{inside}/{len(seeds)} seeds land inside it")

    frame = derive_frame(seeds)
    print(f"\nframe: raw left-right and base axes are {frame.raw_axis_angle_deg:.1f} deg apart "
          "before orthogonalisation")
    for name, (passed, margin) in frame.checks.items():
        print(f"   {name:<28} {'PASS' if passed else 'FAIL'}  ({margin:+.1f} mm)")
    print("   declared-vs-derived: " + ", ".join(
        f"{k} {v:.1f} deg" for k, v in frame.declared_disagreement().items()))

    labels = flood(space, seeds, grid.pitch)
    labels, barrier = strip_exclude(labels)
    if barrier:
        print(f"\nbarrier claimed {barrier * grid.voxel_mm3 / 1000:.1f} mL")
    print(f"\n{'tag':>8} {'mL':>8} {'expected':>10}   extent (voxels)")
    for row in report(labels, grid.voxel_mm3):
        flag = "" if row["in_range"] else "  <-- outside range"
        print(f"{row['name']:>8} {row['ml']:>8.1f} {str(row['expected_ml']):>10}   "
              f"{row['extent_voxels']}{flag}")

    # Compressed, not raw. The raw uint8 array is 54 MB at 384^3, which was
    # committed once and should not be again: it is a derived artefact that
    # regenerates from the seeds in about a minute. It is almost all zeros and
    # six distinct values, so it compresses to a fraction of a megabyte.
    np.savez_compressed(args.out / "seed-partition-labels.npz", labels=labels)
    (args.out / "seed-partition.json").write_text(json.dumps({
        "seeds": counts,
        "frame": {
            "patient_left": frame.patient_left.tolist(),
            "base": frame.base.tolist(),
            "anterior": frame.anterior.tolist(),
            "raw_axis_angle_deg": round(frame.raw_axis_angle_deg, 2),
            "declared_disagreement_deg": {k: round(v, 1)
                                          for k, v in frame.declared_disagreement().items()},
            "checks": {k: {"pass": bool(p), "margin_mm": round(m, 1)}
                       for k, (p, m) in frame.checks.items()},
        },
        "chambers": report(labels, grid.voxel_mm3),
    }, indent=2) + "\n")
    print(f"\nwrote seed-partition.json and seed-partition-labels.npz to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
