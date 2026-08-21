"""
Build a standalone HTML slice-labeller, and read back what it exports.

Four automatic routes failed to say which lobe is the left ventricle
(`vhl_donor_labels`). All four failed on the same bit of information — telling
left from right — and a person looking at one mid-ventricular slice supplies
that bit in seconds. This module builds the instrument for collecting it.

Three design choices carry the whole thing, and each is a decision NOT to make
the obvious version:

* **The slices are RAW ANATOMY. No computed regions are ever shown.** Painting
  this experiment's own segmentation under the annotator's cursor would collect
  agreement with a guess rather than independent evidence, and the guess is
  exactly what is in doubt. Grey myocardium on white, nothing else. This is the
  single most important property of the tool and the easiest to sabotage by
  adding a "helpful" overlay later.

* **Orientation is never asked about.** The pack's orientation is unverified, so
  a question like "which side is patient-left" would import the very assumption
  that needs establishing. The annotator names chambers from their appearance;
  the orientation is then DERIVED from where the named chambers sit. A free
  second result, and it cannot be contaminated by a wrong prior.

* **Seeds are exported in voxel indices, not pixels.** The pixel-to-voxel map is
  baked in at build time, so a click cannot be misplaced later by a display
  scale, a crop, or a resized window.

Output feeds `seeds_to_markers`, then a geodesic watershed, then tags 1-6.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from vhl_partition import write_png

#: Tag -> (label, palette colour). Same six tags as `anatomy.CHAMBER_TAGS`.
#: The colours are for the BUTTONS only. They are never painted on a slice.
TAG_CHOICES: list[tuple[int, str, str]] = [
    (1, "Left ventricle", "#c62828"),
    (2, "Right ventricle", "#1565c0"),
    (3, "Left atrium", "#ef6c00"),
    (4, "Right atrium", "#0288d1"),
    (5, "Aorta", "#7b1fa2"),
    (6, "Pulmonary artery", "#00897b"),
]

#: Slices are offered along all three axes. Which plane reads as a recognisable
#: four-chamber or short-axis view depends on the pose, and this pose is
#: unverified — so rather than guess the good axis, offer all three and let the
#: annotator work in whichever one they can actually read.
AXES = (0, 1, 2)

#: Slices per axis, spanning the tissue bounding box.
SLICES_PER_AXIS = 14

#: How many slices are shown a second time, later in the sequence, to measure
#: test-retest consistency. Disclosed in the tool: a hidden repeat would be a
#: trick, and a disclosed one still works because nobody remembers the exact
#: pixel they clicked twenty slices ago.
REPEAT_SLICES = 3


@dataclass
class SliceSpec:
    """One offered slice, and the map from its pixels back into the volume."""

    key: str
    axis: int
    index: int
    width: int
    height: int
    #: Pixel (x, y) -> volume index, as the two volume axes the image spans.
    #: `origin` is the crop offset, so a click maps back exactly.
    row_axis: int
    column_axis: int
    row_origin: int
    column_origin: int
    png_base64: str
    repeat_of: str | None = None


def _slice_image(mask: np.ndarray, axis: int, index: int,
                 crop: tuple[slice, slice, slice]) -> np.ndarray:
    plane = np.take(mask[crop], index, axis=axis)
    image = np.full(plane.shape + (3,), 255, dtype=np.uint8)
    image[plane] = (105, 105, 115)
    return image


def build_slices(mask: np.ndarray, out_dir: Path,
                 slices_per_axis: int = SLICES_PER_AXIS,
                 repeats: int = REPEAT_SLICES) -> list[SliceSpec]:
    """Render evenly spaced slices per axis, cropped to the tissue bounds."""
    filled = np.argwhere(mask)
    low, high = filled.min(axis=0), filled.max(axis=0)
    pad = 4
    crop = tuple(slice(max(int(lo) - pad, 0), min(int(hi) + pad + 1, n))
                 for lo, hi, n in zip(low, high, mask.shape))
    cropped = mask[crop]

    specs: list[SliceSpec] = []
    scratch = out_dir / "_slices"
    scratch.mkdir(parents=True, exist_ok=True)

    for axis in AXES:
        extent = cropped.shape[axis]
        # Skip the outer 12% at each end: those slices clip the apex or the
        # vessel stumps and carry nothing identifiable.
        positions = np.linspace(extent * 0.12, extent * 0.88, slices_per_axis).astype(int)
        remaining = [a for a in range(3) if a != axis]
        for position in positions:
            image = _slice_image(mask, axis, int(position), crop)
            key = f"a{axis}s{int(position)}"
            path = scratch / f"{key}.png"
            write_png(path, image)
            specs.append(SliceSpec(
                key=key, axis=axis, index=int(position),
                width=image.shape[1], height=image.shape[0],
                row_axis=remaining[0], column_axis=remaining[1],
                row_origin=crop[remaining[0]].start,
                column_origin=crop[remaining[1]].start,
                png_base64=base64.b64encode(path.read_bytes()).decode("ascii"),
            ))

    # Repeats: spaced far from their originals so they are not recognised.
    rng = np.random.default_rng(20260820)
    middle = [s for s in specs if 3 <= specs.index(s) % slices_per_axis <= slices_per_axis - 4]
    chosen = rng.choice(len(middle), size=min(repeats, len(middle)), replace=False)
    for pick in chosen:
        original = middle[int(pick)]
        specs.append(SliceSpec(**{**original.__dict__,
                                  "key": original.key + "r",
                                  "repeat_of": original.key}))
    return specs


def slice_offset_in_volume(spec: SliceSpec, crop_start: int) -> int:
    return spec.index + crop_start


def build_html(specs: list[SliceSpec], crop_starts: dict[int, int],
               pack_id: str, resolution: int, pitch_mm: float) -> str:
    """Emit the whole tool as one self-contained HTML document."""
    payload = {
        "pack": pack_id,
        "resolution": resolution,
        "pitch_mm": round(pitch_mm, 6),
        "tags": [{"tag": t, "label": lab, "colour": col} for t, lab, col in TAG_CHOICES],
        "slices": [{
            "key": s.key, "axis": s.axis,
            "index": s.index + crop_starts[s.axis],
            "width": s.width, "height": s.height,
            "rowAxis": s.row_axis, "columnAxis": s.column_axis,
            "rowOrigin": s.row_origin, "columnOrigin": s.column_origin,
            "repeatOf": s.repeat_of,
            "png": s.png_base64,
        } for s in specs],
    }
    return _TEMPLATE.replace("__PAYLOAD__", json.dumps(payload))


# --------------------------------------------------------------------------- #
# reading the export back                                                      #
# --------------------------------------------------------------------------- #


def seeds_to_markers(export: dict, shape: tuple[int, int, int]) -> np.ndarray:
    """
    Turn an exported seed list into a marker volume for a watershed.

    Confidence is honoured rather than averaged away: a seed the annotator
    flagged `unsure` is dropped, not down-weighted. A watershed marker is a
    hard assertion about a voxel, and there is no half-assertion to make.
    """
    markers = np.zeros(shape, dtype=np.uint8)
    for seed in export.get("seeds", []):
        if seed.get("confidence") == "unsure":
            continue
        voxel = tuple(int(v) for v in seed["voxel"])
        if all(0 <= v < n for v, n in zip(voxel, shape)):
            markers[voxel] = int(seed["tag"])
    return markers


def consistency(export: dict) -> dict:
    """
    Test-retest agreement from the repeated slices.

    Reports the fraction of repeated slices on which the annotator applied the
    same set of tags. It does not check that the clicks landed in the same spot
    — a marker only has to fall inside the right chamber, so pixel agreement
    would be a stricter test than the task requires and would read as
    disagreement where none exists.

    Counts only CONFIDENT seeds, matching `seeds_to_markers`. Scoring a seed
    that never reaches the watershed would report disagreement about something
    the pipeline does not use, and would make the consistency figure look worse
    than the labelling actually is.
    """
    by_slice: dict[str, set[int]] = {}
    for seed in export.get("seeds", []):
        if seed.get("confidence") == "unsure":
            continue
        by_slice.setdefault(seed["slice"], set()).add(int(seed["tag"]))

    pairs = [(s["key"], s["repeatOf"]) for s in export.get("slices", [])
             if s.get("repeatOf")]
    if not pairs:
        return {"repeats": 0, "agreement": None}

    agreed = sum(1 for repeat, original in pairs
                 if by_slice.get(repeat, set()) == by_slice.get(original, set()))
    return {
        "repeats": len(pairs),
        "agreed": agreed,
        "agreement": round(agreed / len(pairs), 3),
        "detail": [{"slice": o, "first": sorted(by_slice.get(o, set())),
                    "second": sorted(by_slice.get(r, set()))} for r, o in pairs],
    }


_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Chamber seed labeller</title>
<style>
  :root {
    --bg: #f7f7f9; --panel: #ffffff; --ink: #1b1b1f; --muted: #6b6b76;
    --line: #d9d9e0; --accent: #1565c0;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         background: var(--bg); color: var(--ink); }
  header { padding: 14px 20px; background: var(--panel); border-bottom: 1px solid var(--line);
           display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  h1 { font-size: 17px; margin: 0; font-weight: 650; }
  .muted { color: var(--muted); font-size: 13px; }
  main { display: grid; grid-template-columns: minmax(0,1fr) 330px; gap: 18px; padding: 18px 20px; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  .stage { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
           padding: 14px; }
  .canvasWrap { position: relative; display: inline-block; line-height: 0; cursor: crosshair; }
  canvas { image-rendering: pixelated; border-radius: 6px; }
  .side { display: flex; flex-direction: column; gap: 14px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
  .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
             color: var(--muted); margin: 0 0 10px; font-weight: 650; }
  button { font: inherit; border: 1px solid var(--line); background: #fff; color: var(--ink);
           border-radius: 7px; padding: 7px 11px; cursor: pointer; }
  button:hover { border-color: #b9b9c4; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .tags { display: grid; gap: 6px; }
  .tag { display: flex; align-items: center; gap: 9px; text-align: left; width: 100%; }
  .tag.active { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
  .swatch { width: 14px; height: 14px; border-radius: 4px; flex: none; }
  .key { margin-left: auto; color: var(--muted); font-size: 12px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .seeds { max-height: 210px; overflow: auto; font-size: 13px; }
  .seed { display: flex; align-items: center; gap: 8px; padding: 3px 0;
          border-bottom: 1px solid #f0f0f4; }
  .seed button { padding: 1px 7px; font-size: 12px; }
  .counts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 10px; font-size: 13px; }
  .warn { background: #fff8e1; border: 1px solid #ffe0a3; border-radius: 8px;
          padding: 10px 12px; font-size: 13px; }
  input[type=range] { width: 100%; }
  label.check { display: flex; gap: 7px; align-items: center; font-size: 13px; }
  .done { color: #2e7d32; font-weight: 600; }
</style>
</head>
<body>
<header>
  <h1>Chamber seed labeller</h1>
  <span class="muted" id="packLine"></span>
</header>

<main>
  <div class="stage">
    <div class="row" style="margin-bottom:10px">
      <button id="prev">&larr; Prev</button>
      <button id="next">Next &rarr;</button>
      <span class="muted" id="sliceLine"></span>
      <span style="margin-left:auto" class="muted">Zoom</span>
      <button data-zoom="-1">&minus;</button><button data-zoom="1">+</button>
    </div>
    <input type="range" id="slider" min="0" value="0" step="1">
    <div style="margin:10px 0 0">
      <div class="canvasWrap" id="wrap"><canvas id="view"></canvas></div>
    </div>
    <p class="muted" style="margin:10px 0 0">
      Grey is heart muscle. Click <strong>inside a chamber cavity</strong> (the white space) and
      it records a seed for the selected label. Nothing is pre-labelled on purpose &mdash; you are
      looking at raw anatomy, not at any guess this pipeline has made.
    </p>
  </div>

  <div class="side">
    <div class="card">
      <h2>Label to place</h2>
      <div class="tags" id="tags"></div>
      <label class="check" style="margin-top:9px">
        <input type="checkbox" id="unsure"> mark next click <strong>unsure</strong>
      </label>
    </div>

    <div class="card">
      <h2>This slice</h2>
      <div class="seeds" id="seedList"></div>
      <div class="row" style="margin-top:9px">
        <button id="undo">Undo last</button>
        <button id="clearSlice">Clear slice</button>
      </div>
    </div>

    <div class="card">
      <h2>Progress</h2>
      <div class="counts" id="counts"></div>
      <p class="muted" style="margin:9px 0 0" id="progressNote"></p>
    </div>

    <div class="card">
      <h2>Finish</h2>
      <p class="muted" style="margin:0 0 9px">
        Three slices repeat later in the sequence. That is deliberate and disclosed &mdash; it
        measures how consistent the labelling is without needing a second person.
      </p>
      <div class="row">
        <button class="primary" id="download">Download seeds.json</button>
        <button id="copy">Copy</button>
      </div>
      <p class="muted" id="saveNote" style="margin:9px 0 0"></p>
    </div>

    <div class="warn">
      You are never asked which side is patient-left. Just name the chambers you recognise; the
      orientation is worked out afterwards from where they turn out to be.
    </div>
  </div>
</main>

<script>
const DATA = __PAYLOAD__;
const state = { i: 0, tag: 1, zoom: 2, seeds: [] };
const images = {};

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
document.getElementById('packLine').textContent =
  DATA.pack + ' · ' + DATA.resolution + '³ · ' + DATA.pitch_mm.toFixed(3) + ' mm/voxel';
document.getElementById('slider').max = DATA.slices.length - 1;

function preload() {
  DATA.slices.forEach(s => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + s.png;
    images[s.key] = img;
  });
}

function tagInfo(t) { return DATA.tags.find(x => x.tag === t); }

function drawTags() {
  const host = document.getElementById('tags');
  host.innerHTML = '';
  DATA.tags.forEach((t, n) => {
    const b = document.createElement('button');
    b.className = 'tag' + (t.tag === state.tag ? ' active' : '');
    b.innerHTML = '<span class="swatch" style="background:' + t.colour + '"></span>' +
                  '<span>' + t.label + '</span><span class="key">' + (n + 1) + '</span>';
    b.onclick = () => { state.tag = t.tag; drawTags(); };
    host.appendChild(b);
  });
}

function current() { return DATA.slices[state.i]; }

function drawMarkers(s) {
  state.seeds.filter(d => d.slice === s.key).forEach(d => {
    const x = (d.px + 0.5) * state.zoom, y = (d.py + 0.5) * state.zoom;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.284);
    ctx.fillStyle = tagInfo(d.tag).colour; ctx.globalAlpha = d.confidence === 'unsure' ? .45 : .95;
    ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  });
}

function render() {
  const s = current(), img = images[s.key];
  canvas.width = s.width * state.zoom;
  canvas.height = s.height * state.zoom;
  ctx.imageSmoothingEnabled = false;
  // Markers must be painted AFTER the bitmap, in both branches. Drawing them
  // once outside this and letting a late onload repaint the image on top is
  // how a marker silently disappears the first time a slice is opened.
  if (img.complete && img.naturalWidth) {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawMarkers(s);
  } else {
    img.onload = () => {
      if (current().key !== s.key) return;   // navigated away while decoding
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      drawMarkers(s);
    };
  }

  document.getElementById('sliceLine').textContent =
    'slice ' + (state.i + 1) + ' / ' + DATA.slices.length + ' · axis ' + s.axis + ' · index ' + s.index;
  document.getElementById('slider').value = state.i;
  drawSeedList(); drawCounts();
}

function drawSeedList() {
  const s = current(), host = document.getElementById('seedList');
  const here = state.seeds.filter(d => d.slice === s.key);
  host.innerHTML = here.length ? '' : '<span class="muted">no seeds on this slice</span>';
  here.forEach(d => {
    const row = document.createElement('div');
    row.className = 'seed';
    row.innerHTML = '<span class="swatch" style="background:' + tagInfo(d.tag).colour + '"></span>' +
      '<span>' + tagInfo(d.tag).label + (d.confidence === 'unsure' ? ' <em>(unsure)</em>' : '') + '</span>';
    const del = document.createElement('button');
    del.textContent = 'remove'; del.style.marginLeft = 'auto';
    del.onclick = () => { state.seeds.splice(state.seeds.indexOf(d), 1); render(); };
    row.appendChild(del); host.appendChild(row);
  });
}

function drawCounts() {
  const host = document.getElementById('counts');
  host.innerHTML = '';
  DATA.tags.forEach(t => {
    const n = state.seeds.filter(d => d.tag === t.tag && d.confidence !== 'unsure').length;
    const el = document.createElement('div');
    el.innerHTML = '<span class="swatch" style="display:inline-block;background:' + t.colour +
      ';vertical-align:-2px"></span> ' + t.label.replace(/(\w+) (\w+)/, '$1 $2') +
      ': <strong>' + n + '</strong>';
    host.appendChild(el);
  });
  const covered = DATA.tags.filter(t =>
    state.seeds.some(d => d.tag === t.tag && d.confidence !== 'unsure')).length;
  const note = document.getElementById('progressNote');
  note.innerHTML = covered === DATA.tags.length
    ? '<span class="done">All six labels have at least one confident seed.</span>'
    : covered + ' of ' + DATA.tags.length + ' labels seeded. Two or three slices each is plenty.';
}

document.getElementById('wrap').onclick = (e) => {
  const s = current(), r = canvas.getBoundingClientRect();
  const px = Math.floor((e.clientX - r.left) / state.zoom);
  const py = Math.floor((e.clientY - r.top) / state.zoom);
  if (px < 0 || py < 0 || px >= s.width || py >= s.height) return;
  const voxel = [0, 0, 0];
  voxel[s.axis] = s.index;
  voxel[s.rowAxis] = py + s.rowOrigin;
  voxel[s.columnAxis] = px + s.columnOrigin;
  state.seeds.push({
    slice: s.key, axis: s.axis, px, py, voxel, tag: state.tag,
    confidence: document.getElementById('unsure').checked ? 'unsure' : 'sure'
  });
  document.getElementById('unsure').checked = false;
  render();
};

function go(n) { state.i = Math.max(0, Math.min(DATA.slices.length - 1, n)); render(); }
document.getElementById('prev').onclick = () => go(state.i - 1);
document.getElementById('next').onclick = () => go(state.i + 1);
document.getElementById('slider').oninput = (e) => go(+e.target.value);
document.getElementById('undo').onclick = () => { state.seeds.pop(); render(); };
document.getElementById('clearSlice').onclick = () => {
  const k = current().key;
  state.seeds = state.seeds.filter(d => d.slice !== k); render();
};
document.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => {
  state.zoom = Math.max(1, Math.min(6, state.zoom + (+b.dataset.zoom))); render();
});

function exportPayload() {
  return JSON.stringify({
    pack: DATA.pack, resolution: DATA.resolution, pitch_mm: DATA.pitch_mm,
    slices: DATA.slices.map(s => ({ key: s.key, axis: s.axis, index: s.index, repeatOf: s.repeatOf })),
    seeds: state.seeds.map(d => ({
      slice: d.slice, axis: d.axis, voxel: d.voxel, tag: d.tag, confidence: d.confidence
    }))
  }, null, 2);
}

document.getElementById('download').onclick = () => {
  const blob = new Blob([exportPayload()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'seeds.json'; a.click();
  document.getElementById('saveNote').textContent =
    'Saved ' + state.seeds.length + ' seeds. Send seeds.json back.';
};
document.getElementById('copy').onclick = async () => {
  await navigator.clipboard.writeText(exportPayload());
  document.getElementById('saveNote').textContent = 'Copied to clipboard.';
};

window.addEventListener('keydown', (e) => {
  if (e.key >= '1' && e.key <= '6') { state.tag = DATA.tags[+e.key - 1].tag; drawTags(); }
  else if (e.key === 'ArrowRight') go(state.i + 1);
  else if (e.key === 'ArrowLeft') go(state.i - 1);
  else if (e.key === 'u') { const c = document.getElementById('unsure'); c.checked = !c.checked; }
  else if ((e.metaKey || e.ctrlKey) && e.key === 'z') { state.seeds.pop(); render(); }
});

preload(); drawTags(); setTimeout(render, 60);
</script>
</body>
</html>
"""


def main() -> int:
    import argparse
    import sys

    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Build the chamber seed labeller.")
    parser.add_argument("--pack", default="normal-vhl-heart0102")
    parser.add_argument("--source", type=Path, default=None,
                        help="optional STL for a higher-resolution build")
    parser.add_argument("--resolution", type=int, default=384)
    parser.add_argument("--out", type=Path, default=root / "output/vhl-partition")
    args = parser.parse_args()

    sys.path.insert(0, str(root / "pipeline"))
    args.out.mkdir(parents=True, exist_ok=True)

    if args.source and args.source.exists():
        import geometry
        from meshlib import read_binary_stl
        from vhl_partition import voxelise
        surface, _ = geometry.weld(read_binary_stl(args.source))
        grid = voxelise(surface.vertices, surface.faces, args.resolution)
        mask, pitch, resolution = grid.mask, grid.pitch, args.resolution
    else:
        pack = json.loads((root / "public/packs" / args.pack / "pack.json").read_text())
        echo = pack["echo_volume"]
        resolution = echo["resolution"][0]
        mask = np.fromfile(root / "public/packs" / args.pack / echo["asset"],
                           dtype=np.uint8).reshape(*echo["resolution"]) > 0
        pitch = 1.0 / np.array(echo["mesh_to_volume"]).reshape(4, 4)[0, 0]
        print(f"using the pack's own echo volume ({resolution}^3)")

    specs = build_slices(mask, args.out)
    filled = np.argwhere(mask)
    low = filled.min(axis=0)
    crop_starts = {a: max(int(low[a]) - 4, 0) for a in AXES}

    html = build_html(specs, crop_starts, args.pack, resolution, float(pitch))
    target = args.out / "label-tool.html"
    target.write_text(html)
    print(f"wrote {target} ({target.stat().st_size / 1e6:.2f} MB, {len(specs)} slices)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
