"""
A rotatable 3D chamber labeller, still as one self-contained HTML file.

The slice version of this tool (`vhl_label_tool`) was correct and unusable.
Reading a chamber off an isolated binary cross-section is a trained radiological
skill; without it the slices carry no spatial context and there is nothing to
recognise. That is a real defect in the instrument, not in the reader.

What changes here, and why each choice:

* **It opens on a CUTAWAY: muscle and cavity together, front half removed.**
  The obvious design was to show the blood pool alone, as an angiographic cast
  in which an LV cone and an RV crescent are recognisable at a glance. That was
  built and rejected on the evidence: this source's trabeculation is heavy
  enough that the cast is a lumpy mass with fingers everywhere and no readable
  chamber, whether taken raw or opened at 2-5 mm to strip the interstitial film.
  Rendering muscle in red against cavity in cream, with the near half clipped
  away, produces a cross-section held in 3D — and that reads immediately, with
  septum and chamber walls obvious. The cast view remains one checkbox away.

* **It shows the cavity UNDIVIDED.** The cavity is close to objective: not
  tissue, inside the epicardium. The three-way split this experiment produced is
  the contested part and is NEVER drawn. Showing it would collect agreement with
  a guess instead of independent evidence, which is the trap the whole labelling
  exercise exists to avoid.

* **Picking is a ray march through the volume, not a lookup in a depth buffer.**
  The click has to land on the chamber the reader believes they are pointing at,
  including when a clipping plane has cut the front of the heart away. Marching
  the actual voxels from the clip plane forward gives exactly that, and it stays
  exact regardless of zoom, rotation or window size.

* **The volume ships as a tiled PNG, decoded in the browser.** 128^3 packed one
  bit per structure into two colour channels, with the surface and its normals
  computed once at load. That is ~200 KB rather than the ~1.5 MB a pre-extracted
  point cloud with normals would cost, and it keeps the file emailable.

Seeds export in the SAME schema as the slice tool, so `seeds_to_markers` and
`consistency` read either without modification.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np
from scipy import ndimage

from vhl_label_tool import TAG_CHOICES
from vhl_partition import (components, epicardial_envelope, write_png)

#: Working resolution for the shipped volume. 128 keeps the payload small and
#: still resolves a papillary muscle; seeds are mapped back up on export, so
#: this costs display detail rather than seed precision.
GRID = 128

#: Tiles across the packed PNG. 12 x 11 holds 128 slices.
TILE_COLUMNS = 12


def downsample(mask: np.ndarray, factor: int) -> np.ndarray:
    """Block-reduce by OR. `any` rather than majority: thin trabeculae and the
    narrow necks between chambers must survive, and a majority rule erases
    exactly those."""
    size = mask.shape[0] // factor
    trimmed = mask[:size * factor, :size * factor, :size * factor]
    return trimmed.reshape(size, factor, size, factor, size, factor).any(axis=(1, 3, 5))


def pack_volume_png(tissue: np.ndarray, cavity: np.ndarray, path: Path) -> tuple[int, int]:
    """Tile the volume into one RGB image: red = tissue, green = cavity."""
    n = tissue.shape[0]
    rows = (n + TILE_COLUMNS - 1) // TILE_COLUMNS
    image = np.zeros((rows * n, TILE_COLUMNS * n, 3), dtype=np.uint8)
    for k in range(n):
        ty, tx = divmod(k, TILE_COLUMNS)
        image[ty * n:(ty + 1) * n, tx * n:(tx + 1) * n, 0] = tissue[k] * 255
        image[ty * n:(ty + 1) * n, tx * n:(tx + 1) * n, 1] = cavity[k] * 255
    write_png(path, image)
    return image.shape[1], image.shape[0]


def build(tissue_full: np.ndarray, cavity_full: np.ndarray, out: Path,
          pack_id: str, full_resolution: int, pitch_mm: float) -> Path:
    factor = tissue_full.shape[0] // GRID
    tissue = downsample(tissue_full, factor)
    cavity = downsample(cavity_full, factor)

    scratch = out / "_volume.png"
    width, height = pack_volume_png(tissue, cavity, scratch)
    encoded = base64.b64encode(scratch.read_bytes()).decode("ascii")
    scratch.unlink()

    payload = {
        "pack": pack_id,
        "grid": GRID,
        "tileColumns": TILE_COLUMNS,
        "imageWidth": width,
        "imageHeight": height,
        "fullResolution": full_resolution,
        "scaleToFull": factor,
        "pitch_mm": round(pitch_mm, 6),
        "tags": [{"tag": t, "label": lab, "colour": col} for t, lab, col in TAG_CHOICES],
    }
    html = (_TEMPLATE
            .replace("__PAYLOAD__", json.dumps(payload))
            .replace("__VOLUME__", encoded))
    target = out / "label-tool-3d.html"
    target.write_text(html)
    return target


_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Chamber labeller (3D)</title>
<style>
  :root { --bg:#f6f6f8; --panel:#fff; --ink:#1b1b1f; --muted:#6b6b76; --line:#dcdce3; --accent:#1565c0; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         background:var(--bg); color:var(--ink); }
  header { padding:12px 18px; background:var(--panel); border-bottom:1px solid var(--line);
           display:flex; gap:14px; align-items:baseline; flex-wrap:wrap; }
  h1 { font-size:16px; margin:0; font-weight:650; }
  .muted { color:var(--muted); font-size:13px; }
  main { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:16px; padding:16px 18px; }
  @media (max-width:940px){ main{grid-template-columns:1fr;} }
  .stage,.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px; }
  .card h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted);
             margin:0 0 9px; font-weight:650; }
  .side { display:flex; flex-direction:column; gap:12px; }
  button { font:inherit; border:1px solid var(--line); background:#fff; border-radius:7px;
           padding:6px 10px; cursor:pointer; color:var(--ink); }
  button:hover { border-color:#b7b7c2; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .tag { display:flex; align-items:center; gap:8px; width:100%; text-align:left; margin-bottom:5px; }
  .tag.active { box-shadow:inset 0 0 0 2px var(--ink); }
  .swatch { width:13px; height:13px; border-radius:4px; flex:none; }
  .key { margin-left:auto; color:var(--muted); font-size:12px; }
  canvas { display:block; border-radius:8px; background:#fff; cursor:crosshair; touch-action:none; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  label.ctl { display:block; font-size:13px; color:var(--muted); margin-top:8px; }
  input[type=range]{ width:100%; }
  .seed { display:flex; align-items:center; gap:7px; padding:3px 0; border-bottom:1px solid #f1f1f5;
          font-size:13px; }
  .warn { background:#fff8e1; border:1px solid #ffe0a3; border-radius:8px; padding:9px 11px; font-size:13px; }
  .done { color:#2e7d32; font-weight:600; }
</style>
</head>
<body>
<header>
  <h1>Chamber labeller &mdash; 3D</h1>
  <span class="muted" id="packLine"></span>
</header>

<main>
  <div class="stage">
    <div class="row" style="margin-bottom:8px">
      <button id="resetView">Reset view</button>
      <label class="ctl" style="margin:0"><input type="checkbox" id="showTissue" checked> show muscle</label>
      <span class="muted" style="margin-left:auto">drag to rotate &middot; scroll to zoom &middot; click a chamber to label</span>
    </div>
    <canvas id="view" width="620" height="560"></canvas>
    <label class="ctl">Cut away front <span id="clipVal" class="muted"></span>
      <input type="range" id="clip" min="0" max="100" value="50"></label>
    <p id="status" class="warn" style="margin:10px 0 0">
      Loading&hellip; if this stays, whatever opened the file is blocking scripts.
      Save it to disk and open it in Chrome or Safari.
    </p>
    <p class="muted" id="hint" style="margin:8px 0 0; display:none">
      <strong>Red is heart muscle, cream is the space inside the chambers.</strong> The front half
      is cut away so you are looking at a cross-section held in 3D. Drag to rotate, use the slider
      to move the cut, then click on a chamber to label it. Nothing here is pre-labelled &mdash;
      the cream is the undivided cavity, not any guess about where the chambers divide.
    </p>
  </div>

  <div class="side">
    <div class="card">
      <h2>Label to place</h2>
      <div id="tags"></div>
      <label class="ctl"><input type="checkbox" id="unsure"> mark next click unsure</label>
    </div>
    <div class="card">
      <h2>Seeds placed</h2>
      <div id="seedList" style="max-height:200px; overflow:auto"></div>
      <div class="row" style="margin-top:8px">
        <button id="undo">Undo</button><button id="clear">Clear all</button>
      </div>
    </div>
    <div class="card">
      <h2>Progress</h2>
      <div id="counts" style="font-size:13px"></div>
      <p class="muted" id="progressNote" style="margin:8px 0 0"></p>
    </div>
    <div class="card">
      <h2>Finish</h2>
      <div class="row">
        <button class="primary" id="download">Download seeds.json</button>
        <button id="copy">Copy</button>
      </div>
      <p class="muted" id="saveNote" style="margin:8px 0 0"></p>
    </div>
    <div class="warn">
      You are never asked which side is patient-left. Name the chambers you recognise; the
      orientation is worked out afterwards from where they turn out to be.
    </div>
  </div>
</main>

<img id="volsrc" alt="" style="display:none" src="data:image/png;base64,__VOLUME__">
<script>
const CFG = __PAYLOAD__;
const N = CFG.grid, NN = N * N, NNN = NN * N;
const canvas = document.getElementById('view'), ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
document.getElementById('packLine').textContent =
  CFG.pack + ' · blood pool · ' + N + '³ display, seeds exported at ' + CFG.fullResolution + '³';

let vol = null, surf = { cav:null, tis:null };
const view = { yaw: 0.9, pitch: 0.20, zoom: 3.2, clip: 0.5, tissue: true };
const state = { tag: 1, seeds: [] };

/* ---------- decode the packed volume ---------- */
function decodeVolume(img) {
  const c = document.createElement('canvas');
  c.width = CFG.imageWidth; c.height = CFG.imageHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, CFG.imageWidth, CFG.imageHeight).data;
  const v = new Uint8Array(NNN);
  for (let k = 0; k < N; k++) {
    const tx = (k % CFG.tileColumns) * N, ty = ((k / CFG.tileColumns) | 0) * N;
    for (let j = 0; j < N; j++) {
      const rowOff = ((ty + j) * CFG.imageWidth + tx) * 4, base = (k * N + j) * N;
      for (let i = 0; i < N; i++) {
        const o = rowOff + i * 4;
        v[base + i] = (d[o] > 127 ? 1 : 0) | (d[o + 1] > 127 ? 2 : 0);
      }
    }
  }
  return v;
}

/* ---------- surface extraction with normals ----------
   Normal is the 26-neighbour occupancy gradient, pointing away from mass.
   Cheaper than a blurred-volume gradient and smooth enough to read shape by. */
function buildSurface(bit) {
  const xs = [], ns = [];
  for (let k = 1; k < N - 1; k++)
    for (let j = 1; j < N - 1; j++)
      for (let i = 1; i < N - 1; i++) {
        const id = (k * N + j) * N + i;
        if (!(vol[id] & bit)) continue;
        if ((vol[id - NN] & bit) && (vol[id + NN] & bit) && (vol[id - N] & bit) &&
            (vol[id + N] & bit) && (vol[id - 1] & bit) && (vol[id + 1] & bit)) continue;
        let gx = 0, gy = 0, gz = 0;
        for (let dk = -1; dk <= 1; dk++)
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              if (!dk && !dj && !di) continue;
              if (vol[id + dk * NN + dj * N + di] & bit) { gx -= dk; gy -= dj; gz -= di; }
            }
        const L = Math.hypot(gx, gy, gz) || 1;
        xs.push(k, j, i); ns.push(gx / L, gy / L, gz / L);
      }
  return { p: new Int16Array(xs), n: new Float32Array(ns), count: xs.length / 3 };
}

/* ---------- maths ---------- */
function matrix() {
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  // R = Rx(pitch) * Ry(yaw), row-major
  return [ cy, 0, sy,
           sp * sy, cp, -sp * cy,
           -cp * sy, sp, cp * cy ];
}
const CENTRE = N / 2;

/* ---------- render ---------- */
const zbuf = new Float32Array(W * H);
const image = ctx.createImageData(W, H);
const LIGHT = (() => { const v = [0.4, -0.55, 0.73]; const L = Math.hypot(...v); return v.map(x => x / L); })();

function shadePoint(px, py, depth, nx, ny, nz, r, g, b) {
  if (px < 0 || py < 0 || px >= W || py >= H) return;
  const o = py * W + px;
  if (depth >= zbuf[o]) return;
  zbuf[o] = depth;
  const lam = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  const s = 0.34 + 0.72 * lam;
  const q = o * 4;
  image.data[q] = Math.min(255, r * s);
  image.data[q + 1] = Math.min(255, g * s);
  image.data[q + 2] = Math.min(255, b * s);
  image.data[q + 3] = 255;
}

function drawSet(set, R, colour, skipNear) {
  const [a, b, c, d, e, f, g, h, i] = R;
  const z0 = view.zoom;
  for (let t = 0; t < set.count; t++) {
    const x = set.p[t * 3] - CENTRE, y = set.p[t * 3 + 1] - CENTRE, z = set.p[t * 3 + 2] - CENTRE;
    const rz = g * x + h * y + i * z;
    if (rz < skipNear) continue;                       // cut away toward viewer
    const rx = a * x + b * y + c * z, ry = d * x + e * y + f * z;
    const px = (rx * z0 + W / 2) | 0, py = (ry * z0 + H / 2) | 0;
    const nx = set.n[t * 3], ny = set.n[t * 3 + 1], nz = set.n[t * 3 + 2];
    const rnx = a * nx + b * ny + c * nz, rny = d * nx + e * ny + f * nz,
          rnz = g * nx + h * ny + i * nz;
    const s = z0 > 3 ? 2 : 1;                          // splat size follows zoom
    for (let ox = 0; ox < s; ox++)
      for (let oy = 0; oy < s; oy++)
        shadePoint(px + ox, py + oy, rz, rnx, rny, rnz, colour[0], colour[1], colour[2]);
  }
}

function clipDepth() {
  // 1 = nothing cut, 0.5 = exactly half cut away toward the viewer, 0 = all cut.
  // Linear in the view's depth axis so the slider feels like a scalpel rather
  // than doing nothing for most of its travel, which the first mapping did.
  return (0.5 - view.clip) * N * 1.2;
}

function render() {
  zbuf.fill(Infinity);
  image.data.fill(0);
  for (let p = 3; p < image.data.length; p += 4) image.data[p] = 0;
  const R = matrix(), near = clipDepth();
  if (view.tissue && surf.tis) drawSet(surf.tis, R, [196, 96, 88], near);
  if (surf.cav) drawSet(surf.cav, R, [240, 225, 140], near);
  ctx.putImageData(image, 0, 0);
  drawSeedMarkers(R, near);
  document.getElementById('clipVal').textContent =
    view.clip >= 0.999 ? '(off)' : Math.round((1 - view.clip) * 100) + '%';
}

function project(v, R) {
  const x = v[0] - CENTRE, y = v[1] - CENTRE, z = v[2] - CENTRE;
  return [ (R[0]*x + R[1]*y + R[2]*z) * view.zoom + W / 2,
           (R[3]*x + R[4]*y + R[5]*z) * view.zoom + H / 2,
            R[6]*x + R[7]*y + R[8]*z ];
}

function drawSeedMarkers(R, near) {
  state.seeds.forEach(s => {
    const [px, py, pz] = project(s.vox, R);
    if (pz < near) return;
    const col = CFG.tags.find(t => t.tag === s.tag).colour;
    ctx.beginPath(); ctx.arc(px, py, 7, 0, 6.284);
    ctx.fillStyle = col; ctx.globalAlpha = s.confidence === 'unsure' ? .45 : .95;
    ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
  });
}

/* ---------- picking: march the actual voxels ---------- */
function pick(sx, sy) {
  const R = matrix(), near = clipDepth();
  const vx = (sx - W / 2) / view.zoom, vy = (sy - H / 2) / view.zoom;
  const want = view.tissue ? 3 : 2;                    // cavity, or either
  const reach = N * 1.5;
  for (let d = near; d < reach; d += 0.5) {
    // inverse-rotate (R is orthonormal, so transpose)
    const x = R[0]*vx + R[3]*vy + R[6]*d + CENTRE;
    const y = R[1]*vx + R[4]*vy + R[7]*d + CENTRE;
    const z = R[2]*vx + R[5]*vy + R[8]*d + CENTRE;
    const k = Math.round(x), j = Math.round(y), i = Math.round(z);
    if (k < 0 || j < 0 || i < 0 || k >= N || j >= N || i >= N) continue;
    const val = vol[(k * N + j) * N + i];
    if (val & 2) return [k, j, i];                     // cavity always wins
    if ((want & 1) && (val & 1)) return [k, j, i];
  }
  return null;
}

/* ---------- interaction ---------- */
let drag = null;
canvas.addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  view.yaw = drag.yaw + dx * 0.01;
  view.pitch = Math.max(-1.5, Math.min(1.5, drag.pitch + dy * 0.01));
  render();
});
canvas.addEventListener('pointerup', e => {
  const wasDrag = drag && drag.moved;
  drag = null;
  if (wasDrag) return;
  const r = canvas.getBoundingClientRect();
  const hit = pick(e.clientX - r.left, e.clientY - r.top);
  if (!hit) { note('Nothing there — try clicking on the solid shape.'); return; }
  state.seeds.push({ vox: hit, tag: state.tag,
    confidence: document.getElementById('unsure').checked ? 'unsure' : 'sure' });
  document.getElementById('unsure').checked = false;
  refresh();
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  view.zoom = Math.max(1.2, Math.min(8, view.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
  render();
}, { passive: false });

document.getElementById('clip').oninput = e => { view.clip = e.target.value / 100; render(); };
document.getElementById('showTissue').onchange = e => { view.tissue = e.target.checked; render(); };
document.getElementById('resetView').onclick = () => {
  view.yaw = 0.9; view.pitch = 0.20; view.zoom = 3.2; view.clip = 0.5;
  document.getElementById('clip').value = 50; render();
};
document.getElementById('undo').onclick = () => { state.seeds.pop(); refresh(); };
document.getElementById('clear').onclick = () => { state.seeds = []; refresh(); };

function note(t) { document.getElementById('saveNote').textContent = t; }

function drawTags() {
  const host = document.getElementById('tags'); host.innerHTML = '';
  CFG.tags.forEach((t, n) => {
    const b = document.createElement('button');
    b.className = 'tag' + (t.tag === state.tag ? ' active' : '');
    b.innerHTML = '<span class="swatch" style="background:' + t.colour + '"></span><span>' +
                  t.label + '</span><span class="key">' + (n + 1) + '</span>';
    b.onclick = () => { state.tag = t.tag; drawTags(); };
    host.appendChild(b);
  });
}

function refresh() {
  const list = document.getElementById('seedList');
  list.innerHTML = state.seeds.length ? '' : '<span class="muted">none yet</span>';
  state.seeds.forEach((s, idx) => {
    const t = CFG.tags.find(x => x.tag === s.tag);
    const row = document.createElement('div');
    row.className = 'seed';
    row.innerHTML = '<span class="swatch" style="background:' + t.colour + '"></span><span>' +
      t.label + (s.confidence === 'unsure' ? ' <em>(unsure)</em>' : '') + '</span>';
    const del = document.createElement('button');
    del.textContent = 'x'; del.style.marginLeft = 'auto';
    del.onclick = () => { state.seeds.splice(idx, 1); refresh(); };
    row.appendChild(del); list.appendChild(row);
  });
  const counts = document.getElementById('counts'); counts.innerHTML = '';
  CFG.tags.forEach(t => {
    const n = state.seeds.filter(s => s.tag === t.tag && s.confidence !== 'unsure').length;
    const el = document.createElement('div');
    el.innerHTML = '<span class="swatch" style="display:inline-block;vertical-align:-2px;background:' +
      t.colour + '"></span> ' + t.label + ': <strong>' + n + '</strong>';
    counts.appendChild(el);
  });
  const covered = CFG.tags.filter(t =>
    state.seeds.some(s => s.tag === t.tag && s.confidence !== 'unsure')).length;
  document.getElementById('progressNote').innerHTML = covered === CFG.tags.length
    ? '<span class="done">All six labelled. One or two seeds each is plenty.</span>'
    : covered + ' of 6 labelled.';
  render();
}

function payload() {
  return JSON.stringify({
    pack: CFG.pack, resolution: CFG.fullResolution, pitch_mm: CFG.pitch_mm,
    source: '3d', slices: [],
    seeds: state.seeds.map(s => ({
      slice: '3d', axis: -1,
      // back up to full resolution, centre of the block this voxel came from
      voxel: s.vox.map(v => v * CFG.scaleToFull + ((CFG.scaleToFull / 2) | 0)),
      display_voxel: s.vox, tag: s.tag, confidence: s.confidence
    }))
  }, null, 2);
}
document.getElementById('download').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([payload()], { type: 'application/json' }));
  a.download = 'seeds.json'; a.click();
  note('Saved ' + state.seeds.length + ' seeds.');
};
document.getElementById('copy').onclick = async () => {
  await navigator.clipboard.writeText(payload()); note('Copied.');
};
window.addEventListener('keydown', e => {
  if (e.key >= '1' && e.key <= '6') { state.tag = CFG.tags[+e.key - 1].tag; drawTags(); }
  else if (e.key === 'u') { const c = document.getElementById('unsure'); c.checked = !c.checked; }
  else if ((e.metaKey || e.ctrlKey) && e.key === 'z') { state.seeds.pop(); refresh(); }
});

/* ---------- start ---------- */
function start() {
  vol = decodeVolume(document.getElementById('volsrc'));
  surf.cav = buildSurface(2);
  surf.tis = buildSurface(1);
  document.getElementById('status').style.display = 'none';
  document.getElementById('hint').style.display = '';
  drawTags(); refresh();
}
const src = document.getElementById('volsrc');
if (src.complete && src.naturalWidth) start(); else src.onload = start;
</script>
</body>
</html>
"""


def main() -> int:
    import argparse
    import sys

    root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root / "pipeline"))

    parser = argparse.ArgumentParser(description="Build the 3D chamber labeller.")
    parser.add_argument("--pack", default="normal-vhl-heart0102")
    parser.add_argument("--source", type=Path, default=None)
    parser.add_argument("--resolution", type=int, default=384)
    parser.add_argument("--out", type=Path, default=root / "output/vhl-partition")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    if args.source and args.source.exists():
        import geometry
        from meshlib import read_binary_stl
        from vhl_partition import voxelise
        surface, _ = geometry.weld(read_binary_stl(args.source))
        grid = voxelise(surface.vertices, surface.faces, args.resolution)
        tissue, pitch, resolution = grid.mask, grid.pitch, args.resolution
    else:
        pack = json.loads((root / "public/packs" / args.pack / "pack.json").read_text())
        echo = pack["echo_volume"]
        resolution = echo["resolution"][0]
        tissue = np.fromfile(root / "public/packs" / args.pack / echo["asset"],
                             dtype=np.uint8).reshape(*echo["resolution"]) > 0
        pitch = 1.0 / np.array(echo["mesh_to_volume"]).reshape(4, 4)[0, 0]

    envelope = epicardial_envelope(tissue, 10.0, float(pitch))
    labels, sizes = components(envelope & ~tissue)
    cavity = labels == int(np.argmax(sizes))
    print(f"tissue {tissue.sum() * pitch ** 3 / 1000:.1f} mL, "
          f"cavity {cavity.sum() * pitch ** 3 / 1000:.1f} mL")

    target = build(tissue, cavity, args.out, args.pack, resolution, float(pitch))
    print(f"wrote {target} ({target.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
