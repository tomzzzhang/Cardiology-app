"""Build the data the chamber-review viewer reads.

Three artefacts, into one directory:

* `volume.u8` + `volume.json` — the label volume itself, so the cut face is
  sampled from the data rather than faked and a click lands on a real voxel.
* `<part>.pos.bin` / `.idx.bin` — one mesh per labelled lumen, plus the
  myocardium with a per-vertex colour attribute.
* `manifest.json` — what the viewer lists, and the camera framing.

Nothing here is specific to one source. It takes a voxel grid, a tissue mask, a
lumen labelling, a wall labelling and a measured cardiac frame, and it does not
care where they came from.

Run it again after ANY change to the labels. The viewer reads these files and
nothing else, so a stale export is indistinguishable from a labelling bug, and
that mistake has been made twice.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

import vhl_surface_nets as sn  # noqa: E402
from vhl_tags import EXPECTED, NAMES  # noqa: E402

#: Chamber tags, their viewer labels and their colours. The hues match the
#: figures this branch produces, so a render and a section agree.
PARTS = [
    (1, "Left ventricle", "#3f8fd0"),
    (2, "Right ventricle", "#d8544c"),
    (3, "Left atrium", "#46a95c"),
    (4, "Right atrium", "#e69a33"),
    (5, "Aorta", "#9878c9"),
    (6, "Pulmonary artery", "#3fb6bd"),
]
#: Volume sentinels above the anatomy range. `anatomy.py` owns 1-24.
TISSUE, SPACE, VOID = 20, 21, 22
UNCLAIMED = "#9aa1a8"


def _srgb_to_linear(value) -> np.ndarray:
    """three.js reads a vertex-colour attribute as LINEAR and converts on output.

    Writing sRGB straight through renders every chamber washed out.
    """
    s = np.asarray(value, dtype=float)
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)


def _hex_to_linear(colour: str) -> np.ndarray:
    return _srgb_to_linear([int(colour[i:i + 2], 16) / 255 for i in (1, 3, 5)])


def write_volume(out: Path, tissue, lumen, space, origin, pitch, rotation) -> dict:
    """Ship the label volume to the browser.

    0 empty, 1-6 chamber, 7-10 valve rings, 20 tissue, 21 chamber space with no
    chamber tag, 22 a sealed void inside the wall. 21 and 22 exist because the
    inner painter has to tell "endocardium facing space nothing has named yet"
    and "a sealed trabecular interstice" apart from open air - all three read 0
    otherwise, and a mark on the first is legitimate while a mark on the last
    two is not.
    """
    n = tissue.shape[0]
    volume = np.zeros(tissue.shape, dtype=np.uint8)
    if space is not None:
        free = ~tissue
        outside = free & ~space
        labels, _count = ndimage.label(outside, structure=ndimage.generate_binary_structure(3, 1))
        edge = np.unique(np.concatenate([
            labels[0].ravel(), labels[-1].ravel(), labels[:, 0].ravel(),
            labels[:, -1].ravel(), labels[:, :, 0].ravel(), labels[:, :, -1].ravel()]))
        edge = edge[edge > 0]
        volume[outside & ~np.isin(labels, edge)] = VOID
        volume[space & free] = SPACE
    volume[tissue] = TISSUE
    for tag in range(1, 11):
        volume[lumen == tag] = tag
    (out / "volume.u8").write_bytes(volume.tobytes())
    meta = {
        "resolution": n,
        "pitch_mm": float(pitch),
        "origin_mm": [float(x) for x in origin],
        "full_resolution": n,
        "rotation_rows": {"patient_left": list(rotation[0]), "base": list(rotation[1]),
                          "anterior": list(rotation[2])},
        "counts": {int(t): int((volume == t).sum())
                   for t in list(range(11)) + [TISSUE, SPACE, VOID]},
    }
    (out / "volume.json").write_text(json.dumps(meta, indent=2))
    return meta


def _downsample(mask: np.ndarray, factor: int) -> np.ndarray:
    """Downsample by MAX over each block, never by stride.

    Striding drops every second plane, which deletes exactly the one-voxel walls
    this model is full of.
    """
    n = mask.shape[0] // factor
    trimmed = np.asarray(mask)[:n * factor, :n * factor, :n * factor]
    return trimmed.reshape(n, factor, n, factor, n, factor).max(axis=(1, 3, 5))


def _wall_colour(vertices, lumen, wall, origin, pitch) -> tuple[np.ndarray, dict]:
    """One colour per vertex: which chamber's wall this piece of surface is.

    A vertex sits ON the tissue boundary, so reading the wall label at its own
    voxel lands just outside the wall and returns 0 almost everywhere. Two ways
    to recover it, and the order matters:

    * A vertex on the ENDOCARDIUM is within a voxel of the lumen it lines, and
      which lumen that is was already settled by touching. Take that tag.
    * Otherwise the nearest labelled wall voxel, which is right everywhere the
      wall is not thinner than the mesh spacing.

    Vertex normals were tried for the first case and are worse - this surface is
    trabeculated, the normal is noisy, and the inward test picks the wrong side
    often enough to cost eight points on the right atrium.
    """
    limit = wall.shape[0] - 1

    def voxels(points):
        return np.clip(np.round((points - origin) / pitch - 0.5).astype(int), 0, limit)

    index = voxels(vertices)
    lumen_distance, lumen_index = ndimage.distance_transform_edt(
        lumen == 0, sampling=pitch, return_indices=True)
    near = lumen_distance[index[:, 0], index[:, 1], index[:, 2]] <= 1.0
    lining = lumen[lumen_index[0], lumen_index[1], lumen_index[2]][
        index[:, 0], index[:, 1], index[:, 2]]
    _distance, wall_index = ndimage.distance_transform_edt(wall == 0, return_indices=True)
    snapped = np.stack([wall_index[k][index[:, 0], index[:, 1], index[:, 2]]
                        for k in range(3)], axis=1)
    fallback = wall[snapped[:, 0], snapped[:, 1], snapped[:, 2]]
    from_lumen = near & (lining > 0)
    tags = np.where(from_lumen, lining, fallback)

    colours = np.tile(_hex_to_linear(UNCLAIMED), (len(vertices), 1))
    for tag, _label, colour in PARTS:
        colours[tags == tag] = _hex_to_linear(colour)
    report = {"from_lumen": int(from_lumen.sum()),
              "from_nearest_wall": int((~from_lumen).sum()),
              "by_chamber": {NAMES[t]: int((tags == t).sum()) for t, _l, _c in PARTS},
              "unclaimed": int((tags == 0).sum())}
    return colours, report


def write_meshes(out: Path, tissue, lumen, wall, origin, pitch, rotation,
                 factor: int, volumes: dict | None) -> list[dict]:
    """One mesh per lumen, plus the myocardium carrying a colour attribute.

    The wall is ONE mesh with per-vertex colour rather than six meshes: splitting
    it per chamber would duplicate every shared interface and roughly double the
    triangle count for a picture that looks the same.
    """
    def pose(v):
        return (rotation @ v.T).T

    manifest: list[dict] = []
    for tag, label, colour in PARTS:
        mask = _downsample(lumen == tag, factor)
        if not mask.any():
            continue
        vertices, faces = sn.extract(mask, origin, pitch * factor,
                                     blur_voxels=0.4, smooth_iterations=10)
        key = label.lower().replace(" ", "-")
        posed = pose(vertices)
        posed.astype("<f4").tofile(out / f"{key}.pos.bin")
        faces.astype("<u4").tofile(out / f"{key}.idx.bin")
        row = volumes.get(tag, {}) if volumes else {}
        manifest.append({"key": key, "label": label, "colour": colour,
                         "verts": int(len(posed)), "tris": int(len(faces)), "wall": False,
                         "ml": row.get("ml"),
                         "expected": list(EXPECTED[tag]) if tag in EXPECTED else None,
                         "in_range": row.get("in_range", True)})

    vertices, faces = sn.extract(_downsample(tissue, factor), origin, pitch * factor,
                                 blur_voxels=0.4, smooth_iterations=8)
    # Colour is sampled BEFORE posing: the label volume is in source coordinates.
    colours, report = _wall_colour(vertices, lumen, wall, origin, pitch)
    colours.astype("<f4").tofile(out / "myocardium.col.bin")
    print(f"  vertex colour: {report['from_lumen']} from the lumen they line, "
          f"{report['from_nearest_wall']} from the nearest labelled wall voxel")
    print(f"  wall colours: {report['by_chamber']} unclaimed {report['unclaimed']}")
    posed = pose(vertices)
    posed.astype("<f4").tofile(out / "myocardium.pos.bin")
    faces.astype("<u4").tofile(out / "myocardium.idx.bin")
    manifest.append({"key": "myocardium", "label": "Myocardial tissue", "colour": UNCLAIMED,
                     "verts": int(len(posed)), "tris": int(len(faces)), "wall": True,
                     "ml": None, "expected": None, "in_range": True})

    points = pose((np.argwhere(tissue) + 0.5) * pitch + origin)
    (out / "manifest.json").write_text(json.dumps(
        {"parts": manifest,
         "centre": [float(x) for x in points.mean(0)],
         "extent": float((points.max(0) - points.min(0)).max())}, indent=2))
    return manifest


def copy_runtime(out: Path) -> None:
    """three.js and the viewer page itself, beside the data they read.

    Copied from node_modules rather than vendored: the repository already pins
    three, and a second copy in Git would drift from it silently.
    """
    here = Path(__file__).resolve().parent
    shutil.copy(here / "viewer.html", out / "index.html")
    three = ROOT / "node_modules/three"
    for source, name in ((three / "build/three.module.min.js", "three.module.min.js"),
                         (three / "build/three.core.min.js", "three.core.min.js"),
                         (three / "examples/jsm/controls/OrbitControls.js", "OrbitControls.js")):
        if not source.exists():
            raise FileNotFoundError(f"{source} missing - run npm ci first")
        shutil.copy(source, out / name)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the chamber-review viewer's data.")
    parser.add_argument("--grid", type=Path, required=True,
                        help="npz carrying 'pitch' and 'origin'")
    parser.add_argument("--tissue", type=Path, required=True, help="npz with a 'tissue' mask")
    parser.add_argument("--lumen", type=Path, required=True, help="npz with 'labels'")
    parser.add_argument("--wall", type=Path, required=True, help="npz with 'labels'")
    parser.add_argument("--frame", type=Path, required=True,
                        help="json with frame.patient_left / base / anterior")
    parser.add_argument("--chamber-space", type=Path, default=None,
                        help="npz with 'mask'; without it the viewer cannot tell "
                             "unnamed chamber space from the air outside")
    parser.add_argument("--volumes", type=Path, default=None,
                        help="json with a 'chambers' list, for the viewer's readout")
    parser.add_argument("--mesh-downsample", type=int, default=2,
                        help="meshes are built at 1/N of the label resolution")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    grid = np.load(args.grid)
    pitch, origin = float(grid["pitch"]), grid["origin"]
    tissue = np.load(args.tissue)["tissue"]
    lumen = np.load(args.lumen)["labels"]
    wall = np.load(args.wall)["labels"]
    space = np.load(args.chamber_space)["mask"] if args.chamber_space else None
    frame = json.loads(args.frame.read_text())
    frame = frame.get("frame", frame)
    rotation = np.array([frame["patient_left"], frame["base"], frame["anterior"]], dtype=float)

    volumes = None
    if args.volumes:
        volumes = {row["tag"]: row for row in json.loads(args.volumes.read_text())["chambers"]}

    meta = write_volume(args.out, tissue, lumen, space, origin, pitch, rotation)
    print(f"volume.u8 {(args.out / 'volume.u8').stat().st_size / 1e6:.1f} MB "
          f"counts {meta['counts']}")
    write_meshes(args.out, tissue, lumen, wall, origin, pitch, rotation,
                 args.mesh_downsample, volumes)
    copy_runtime(args.out)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
