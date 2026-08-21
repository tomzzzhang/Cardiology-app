"""
Chamber labeller on the real mesh, using the app's own engine and cut plane.

Two earlier attempts are recorded here because each failed for a reason worth
not repeating.

FIRST, slices (`vhl_label_tool`). Correct and unusable: reading a chamber off an
isolated binary cross-section is a trained radiological skill, and without it
the slices carry no spatial context to recognise.

SECOND, a voxel splat renderer with a clipping plane. Better, still not good
enough — a 128^3 point cloud is too coarse to read anatomy from, and clicking
into a rendered volume leaves the reader guessing what depth the click landed
at. Two useful negatives came out of it and are kept:

  * Showing the BLOOD POOL alone, as an angiographic cast, does not work on this
    source. The trabeculation is heavy enough that the cast is a lumpy mass with
    fingers everywhere, whether taken raw or opened at 2-5 mm to strip the
    interstitial film. Muscle against cavity in section is what reads.
  * A clipped point cloud must keep INTERIOR voxels, not only surface ones, or
    the cut reveals the inside of a hollow shell and the viewer sees straight
    through the model.

THIS version answers both by using what the application itself uses.

* **three.js, the app's own renderer and version**, inlined from `node_modules`
  so the file stays offline and self-contained.

* **The app's stencil-cap algorithm**, mirrored from `src/viewer/caps.ts`: draw
  the clipped solid writing only stencil, back faces incrementing and front
  faces decrementing with the depth test off, then paint a plane-aligned quad
  masked to a non-zero counter. Away from the cut every back face is matched by
  a front face and the count returns to zero; where the plane removed the near
  surface the match is missing, so the counter is non-zero over exactly the
  cross-section. `contracts/viewer-core.md` puts it plainly: a hollow cut is a
  bug, not a style.

* **Seeds land ON the cut plane, by construction.** The click is intersected
  with the mathematical plane — not with geometry, not with a depth buffer — so
  there is no depth for the reader to be wrong about. The point is then looked
  up in an occupancy grid shipped alongside, which decides whether it fell in
  cavity or in muscle and refuses the seed if it fell in neither.

* **The real decimated surface**, 110k triangles with smooth normals, quantised
  to 16-bit positions and 8-bit normals with 16-bit indices. About 1.1 MB of
  geometry rather than 5 MB of float32, and it reads as anatomy, not as blocks.

Seeds export in the slice tool's schema, so `seeds_to_markers` and `consistency`
read this tool's output unchanged.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np

from vhl_label_tool import TAG_CHOICES
from vhl_partition import (analyse_debris, components, epicardial_envelope,
                           strip_debris, write_png)

#: A seventh, non-anatomical label: "this space is not LUMEN".
#:
#: Named for lumen, not for "chamber". The aorta and the pulmonary artery are
#: great vessels and not chambers in any anatomical sense, but they ARE tags 5
#: and 6 and their blood space is exactly what must be kept. A barrier called
#: "not a chamber" invites an anatomically correct reader to mark the aorta with
#: it and delete a structure this experiment is trying to recover.
#:
#: The flood leaks because the space it runs through is not only chamber. The
#: film between the true epicardium and the morphological envelope, and the
#: trabecular interstices, are connected sheets wrapping the whole organ, so
#: whichever chamber touches one first inherits all of it — the right ventricle
#: took 257 mL that way, wrapping the heart.
#:
#: A barrier label fixes it with the machinery already here rather than with a
#: better mask: mark the leak as its own territory and it competes for that
#: space on equal terms, so no chamber can cross through it. 99 rather than 7,
#: because 7-10 are the valve-plane tags in `anatomy.py` and a collision there
#: would be silent.
EXCLUDE_TAG = 99
EXCLUDE_LABEL = "Not lumen"
EXCLUDE_COLOUR = "#78909c"

#: Triangle budget. The largest that keeps the vertex count under 65,535 so
#: indices fit in Uint16 — that one constraint halves the index buffer, which is
#: the biggest single part of the payload.
TRIANGLE_BUDGET = 110_000

#: Occupancy grid shipped for hit-testing a click. Only ever asked "cavity,
#: muscle or neither" at a point, so it needs far less resolution than the mesh.
HIT_GRID = 128
TILE_COLUMNS = 12


def build_mesh(vertices: np.ndarray, faces: np.ndarray) -> dict:
    """Decimate, compute smooth normals, and quantise for transport."""
    import fast_simplification

    report = analyse_debris(vertices, faces)
    clean_v, clean_f = strip_debris(vertices, faces, report)
    reduction = 1.0 - TRIANGLE_BUDGET / len(clean_f)
    points, triangles = fast_simplification.simplify(
        clean_v.astype(np.float32), clean_f.astype(np.int32),
        min(max(reduction, 0.0), 0.99))
    points = np.asarray(points, dtype=np.float64)
    triangles = np.asarray(triangles, dtype=np.int64)
    if len(points) > 65535:
        raise ValueError(f"{len(points)} vertices exceeds the Uint16 index limit")

    # Area-weighted vertex normals: accumulating the raw cross product rather
    # than a per-face unit normal is what stops a fan of slivers on a trabecula
    # from outvoting the large faces around it.
    a, b, c = points[triangles[:, 0]], points[triangles[:, 1]], points[triangles[:, 2]]
    face_normal = np.cross(b - a, c - a)
    normals = np.zeros_like(points)
    for column in range(3):
        np.add.at(normals, triangles[:, column], face_normal)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    # A vertex whose incident faces cancel out — 61 of them here, on slivers left
    # by decimation — would otherwise ship a zero normal and shade black under
    # Phong. Point it outward from the centroid instead: wrong in detail, right
    # in sign, and invisible at 0.1% of vertices.
    degenerate = lengths[:, 0] < 1e-12
    if degenerate.any():
        outward = points[degenerate] - points.mean(axis=0)
        fallback = np.linalg.norm(outward, axis=1, keepdims=True)
        fallback[fallback == 0] = 1.0
        normals[degenerate] = outward / fallback
        lengths[degenerate] = 1.0
    lengths[lengths == 0] = 1.0
    normals /= lengths

    low, high = points.min(axis=0), points.max(axis=0)
    span = float((high - low).max())
    quantised = np.round((points - low) / span * 65534.0 - 32767.0).astype(np.int16)
    normal_bytes = np.round(np.clip(normals, -1, 1) * 127.0).astype(np.int8)

    return {
        "positions": base64.b64encode(quantised.tobytes()).decode("ascii"),
        "normals": base64.b64encode(normal_bytes.tobytes()).decode("ascii"),
        "indices": base64.b64encode(triangles.astype(np.uint16).tobytes()).decode("ascii"),
        "vertexCount": int(len(points)),
        "triangleCount": int(len(triangles)),
        "quantLow": [float(v) for v in low],
        "quantSpan": span,
    }


def downsample(mask: np.ndarray, factor: int) -> np.ndarray:
    size = mask.shape[0] // factor
    trimmed = mask[:size * factor, :size * factor, :size * factor]
    return trimmed.reshape(size, factor, size, factor, size, factor).any(axis=(1, 3, 5))


def pack_hit_grid(tissue: np.ndarray, cavity: np.ndarray, path: Path) -> tuple[int, int]:
    """Tile the occupancy grid into one RGB image: red = muscle, green = cavity."""
    n = tissue.shape[0]
    rows = (n + TILE_COLUMNS - 1) // TILE_COLUMNS
    image = np.zeros((rows * n, TILE_COLUMNS * n, 3), dtype=np.uint8)
    for k in range(n):
        ty, tx = divmod(k, TILE_COLUMNS)
        image[ty * n:(ty + 1) * n, tx * n:(tx + 1) * n, 0] = tissue[k] * 255
        image[ty * n:(ty + 1) * n, tx * n:(tx + 1) * n, 1] = cavity[k] * 255
    write_png(path, image)
    return image.shape[1], image.shape[0]


def build(mesh: dict, tissue: np.ndarray, cavity: np.ndarray, grid_origin: np.ndarray,
          grid_pitch: float, full_resolution: int, out: Path, pack_id: str,
          three_source: str) -> Path:
    factor = tissue.shape[0] // HIT_GRID
    scratch = out / "_hit.png"
    width, height = pack_hit_grid(downsample(tissue, factor), downsample(cavity, factor), scratch)
    hit_png = base64.b64encode(scratch.read_bytes()).decode("ascii")
    scratch.unlink()

    payload = {
        "pack": pack_id,
        "mesh": mesh,
        "hit": {
            "grid": HIT_GRID, "tileColumns": TILE_COLUMNS,
            "imageWidth": width, "imageHeight": height,
            "origin": [float(v) for v in grid_origin],
            "pitch": float(grid_pitch) * factor,
            "scaleToFull": factor,
        },
        "fullResolution": full_resolution,
        "tags": ([{"tag": t, "label": lab, "colour": col} for t, lab, col in TAG_CHOICES]
                 + [{"tag": EXCLUDE_TAG, "label": EXCLUDE_LABEL, "colour": EXCLUDE_COLOUR}]),
        "excludeTag": EXCLUDE_TAG,
    }

    if "</script>" in three_source:
        raise ValueError("three bundle contains a closing script tag")

    html = (_TEMPLATE
            .replace("__PAYLOAD__", json.dumps(payload))
            .replace("__HITPNG__", hit_png)
            .replace("__THREE__", three_source))
    target = out / "label-tool-3d.html"
    target.write_text(html)
    return target


_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Chamber labeller</title>
<style>
  :root { --panel:#fff; --ink:#1b1b1f; --muted:#6b6b76; --line:#dcdce3; --accent:#1565c0; }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         background:#f6f6f8; color:var(--ink); }
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
  button.on { background:#eef4fd; border-color:var(--accent); }
  .tag { display:flex; align-items:center; gap:8px; width:100%; text-align:left; margin-bottom:5px; }
  .tag.active { box-shadow:inset 0 0 0 2px var(--ink); }
  .swatch { width:13px; height:13px; border-radius:4px; flex:none; }
  .key { margin-left:auto; color:var(--muted); font-size:12px; }
  #gl { display:block; width:100%; border-radius:8px; background:#eef0f4; cursor:crosshair;
        touch-action:none; }
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
  <h1>Chamber labeller</h1>
  <span class="muted" id="packLine"></span>
</header>
<main>
  <div class="stage">
    <div class="row" style="margin-bottom:8px">
      <button id="reset">Reset view</button>
      <span class="muted">slice through</span>
      <button data-axis="0" title="Cut along the model's first axis">Axis 1</button>
      <button data-axis="1" title="Cut along the model's second axis">Axis 2</button>
      <button data-axis="2" title="Cut along the model's third axis">Axis 3</button>
      <button data-axis="v" title="Cut square-on to the camera, wherever you have rotated to">Face me</button>
      <button id="flip" title="Cut from the other side">Reverse</button>
      <span class="muted" style="margin-left:auto">drag rotate &middot; scroll zoom &middot; click the cut face</span>
    </div>
    <canvas id="gl"></canvas>
    <label class="ctl">Cut depth <input type="range" id="depth" min="0" max="1000" value="500"></label>
    <p id="status" class="warn" style="margin:10px 0 0">
      Loading&hellip; if this stays, the file is being shown by something that blocks scripts.
      Save it to disk and open the saved file in Chrome or Safari.
    </p>
    <p class="muted" id="hint" style="display:none;margin:8px 0 0">
      <strong>Red is muscle, cream is the space inside a chamber.</strong> Click the cut face and
      the dot lands exactly on the cutting plane. Click anywhere else and it lands on the nearest
      surface facing you. Either way there is nothing to judge about depth.
      <br><strong>If a label leaks</strong>, click the space it leaked into with
      <em>Not lumen</em>. That space then belongs to nothing and no label can spread through
      it &mdash; the fastest way to stop the right ventricle wrapping the heart.
      <br><em>Lumen</em> means blood space belonging to one of the six tags. The aorta and
      pulmonary artery ARE lumen even though they are vessels rather than chambers &mdash;
      do not mark them. <em>Not lumen</em> means the rim of space outside the heart's own
      surface, and the crevices between trabeculae: space blood does not occupy.
      <br><em>Axis 1/2/3</em> choose which way the knife points; the model's orientation is
      unverified, so they are named by axis rather than by anatomy. <em>Face me</em> cuts
      square-on to wherever you have rotated. <em>Reverse</em> cuts from the other side.
      Nothing is pre-labelled &mdash; the cream is the undivided cavity, not any guess about where
      the chambers divide.
    </p>
  </div>
  <div class="side">
    <div class="card"><h2>Label to place</h2><div id="tags"></div>
      <label class="ctl"><input type="checkbox" id="unsure"> mark next click unsure</label></div>
    <div class="card"><h2>Seeds</h2><div id="seedList" style="max-height:190px;overflow:auto"></div>
      <div class="row" style="margin-top:8px"><button id="undo">Undo</button>
      <button id="clear">Clear all</button></div></div>
    <div class="card"><h2>Progress</h2><div id="counts" style="font-size:13px"></div>
      <p class="muted" id="progressNote" style="margin:8px 0 0"></p></div>
    <div class="card"><h2>Finish</h2>
      <div class="row"><button class="primary" id="download">Download seeds.json</button>
      <button id="copy">Copy</button></div>
      <p class="muted" id="saveNote" style="margin:8px 0 0"></p></div>
    <div class="warn">Never asks which side is patient-left. Name the chambers you recognise; the
      orientation is worked out afterwards from where they turn out to be.</div>
  </div>
</main>

<img id="hitimg" alt="" style="display:none" src="data:image/png;base64,__HITPNG__">
<!-- three.js as a CLASSIC script exposing a global, NOT an ES module.
     ES modules are fetched with CORS, and a file:// document has an opaque
     origin, so `import` and `import()` are refused there — including from a
     Blob URL. The first build of this tool used a module and died silently on
     exactly that, leaving an empty canvas and a stuck banner. esbuild bundles
     three into an IIFE at build time so the page has no module loading at all. -->
<script>__THREE__</script>
<script>
const CFG = __PAYLOAD__;
try {

/* ---------------- geometry ---------------- */
function bytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const M = CFG.mesh;
const qpos = new Int16Array(bytes(M.positions).buffer);
const qnrm = new Int8Array(bytes(M.normals).buffer);
const idx  = new Uint16Array(bytes(M.indices).buffer);

const positions = new Float32Array(qpos.length);
for (let i = 0; i < qpos.length; i++) {
  positions[i] = (qpos[i] + 32767) / 65534 * M.quantSpan + M.quantLow[i % 3];
}
const normals = new Float32Array(qnrm.length);
for (let i = 0; i < qnrm.length; i++) normals[i] = qnrm[i] / 127;

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
geometry.setIndex(new THREE.BufferAttribute(idx, 1));
geometry.computeBoundingSphere();
const bounds = geometry.boundingSphere;

/* ---------------- scene ---------------- */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.setClearColor(0xeef0f4, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 4000);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.5); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); scene.add(fill);

const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
const MUSCLE = 0xc0605a, CAVITY = 0xf0e08c;

const muscle = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
  color: MUSCLE, shininess: 12, side: THREE.DoubleSide, clippingPlanes: [plane],
}));
scene.add(muscle);

/* ---- stencil cap, mirroring src/viewer/caps.ts ----
   Back faces increment and front faces decrement with the depth test OFF, so
   every face along the ray is counted; a depth test would drop the ones behind
   nearer geometry and leave the parity wrong. Away from the cut the counter
   returns to zero. Where the plane removed the near surface the matching front
   face is missing, so the counter is non-zero over exactly the cross-section,
   and a plane-aligned quad masked to `stencil != 0` paints it solid. */
function stencilMaterial(side, op) {
  return new THREE.MeshBasicMaterial({
    depthWrite: false, depthTest: false, colorWrite: false,
    stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, side,
    stencilFail: op, stencilZFail: op, stencilZPass: op,
    clippingPlanes: [plane],
  });
}
const backFaces = new THREE.Mesh(geometry,
  stencilMaterial(THREE.BackSide, THREE.IncrementWrapStencilOp));
const frontFaces = new THREE.Mesh(geometry,
  stencilMaterial(THREE.FrontSide, THREE.DecrementWrapStencilOp));
backFaces.renderOrder = 1; frontFaces.renderOrder = 2;
scene.add(backFaces, frontFaces);

const capMaterial = new THREE.MeshBasicMaterial({
  color: CAVITY, side: THREE.DoubleSide, depthTest: false,
  stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
  stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp,
  stencilZPass: THREE.ReplaceStencilOp,
});
const cap = new THREE.Mesh(new THREE.PlaneGeometry(bounds.radius * 4, bounds.radius * 4), capMaterial);
cap.renderOrder = 3;
scene.add(cap);

const markers = new THREE.Group(); scene.add(markers);

/* ---------------- hit grid ---------------- */
let hitVol = null;
function decodeHit(img) {
  const H = CFG.hit, c = document.createElement('canvas');
  c.width = H.imageWidth; c.height = H.imageHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, H.imageWidth, H.imageHeight).data;
  const n = H.grid, v = new Uint8Array(n * n * n);
  for (let k = 0; k < n; k++) {
    const tx = (k % H.tileColumns) * n, ty = ((k / H.tileColumns) | 0) * n;
    for (let j = 0; j < n; j++) {
      const row = ((ty + j) * H.imageWidth + tx) * 4, base = (k * n + j) * n;
      for (let i = 0; i < n; i++) {
        const o = row + i * 4;
        v[base + i] = (d[o] > 127 ? 1 : 0) | (d[o + 1] > 127 ? 2 : 0);
      }
    }
  }
  return v;
}
/** Model-space point -> {voxel, kind}, from the shipped occupancy grid. */
function classify(point) {
  const H = CFG.hit, n = H.grid;
  const k = Math.round((point.x - H.origin[0]) / H.pitch - 0.5);
  const j = Math.round((point.y - H.origin[1]) / H.pitch - 0.5);
  const i = Math.round((point.z - H.origin[2]) / H.pitch - 0.5);
  if (k < 0 || j < 0 || i < 0 || k >= n || j >= n || i >= n) return null;
  const direct = hitVol[(k * n + j) * n + i];
  if (direct & 2) return { voxel: [k, j, i], kind: 'cavity' };
  // A click on the cut face can land a voxel inside the wall. Search outward a
  // little rather than refusing: the reader pointed at a chamber, and this grid
  // is coarser than their aim.
  for (let r = 1; r <= 3; r++)
    for (let dk = -r; dk <= r; dk++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          const a = k + dk, b = j + dj, c2 = i + di;
          if (a < 0 || b < 0 || c2 < 0 || a >= n || b >= n || c2 >= n) continue;
          if (hitVol[(a * n + b) * n + c2] & 2) return { voxel: [a, b, c2], kind: 'cavity' };
        }
  return direct & 1 ? { voxel: [k, j, i], kind: 'muscle' } : null;
}

/* ---------------- camera and plane ---------------- */
const view = { az: 0.9, el: 0.25, dist: bounds.radius * 3.0, axis: 2, sign: -1, depth: 0.5 };
const target = bounds.center.clone();
const state = { tag: 1, seeds: [] };

function placeCamera() {
  const ce = Math.cos(view.el), se = Math.sin(view.el);
  camera.position.set(
    target.x + view.dist * ce * Math.sin(view.az),
    target.y + view.dist * se,
    target.z + view.dist * ce * Math.cos(view.az));
  camera.lookAt(target);
  key.position.copy(camera.position).add(new THREE.Vector3(0, bounds.radius, 0));
  fill.position.copy(camera.position).multiplyScalar(-1);
}

function updatePlane() {
  const normal = new THREE.Vector3();
  if (view.axis === 'v') camera.getWorldDirection(normal);
  else { normal.setComponent(view.axis, 1); normal.multiplyScalar(view.sign); }
  normal.normalize();
  const offset = target.dot(normal) + (view.depth - 0.5) * bounds.radius * 2;
  plane.set(normal, -offset);
  cap.position.copy(normal).multiplyScalar(offset);
  cap.lookAt(cap.position.clone().add(normal));
}

function draw() {
  const w = canvas.clientWidth || 620, h = Math.round((canvas.clientWidth || 620) * 0.8);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  placeCamera(); updatePlane();
  renderer.clearStencil();
  renderer.render(scene, camera);
}

/* ---------------- interaction ---------------- */
let drag = null;
canvas.addEventListener('pointerdown', e => {
  drag = { x: e.clientX, y: e.clientY, az: view.az, el: view.el, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  view.az = drag.az - dx * 0.008;
  view.el = Math.max(-1.4, Math.min(1.4, drag.el + dy * 0.008));
  draw();
});
canvas.addEventListener('pointerup', e => {
  const wasDrag = drag && drag.moved; drag = null;
  if (wasDrag) return;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);

  // Take whichever comes first along the ray: the cut plane, or the model
  // surface you are actually looking at. Using the plane alone is wrong
  // whenever the plane sits BEHIND the visible surface — the click then lands
  // somewhere the reader cannot see and never intended.
  //
  // Mesh hits on the clipped-away side are discarded: raycasting ignores
  // clipping planes entirely, so without this it happily returns the surface
  // that was cut off and is no longer on screen.
  const planePoint = new THREE.Vector3();
  const hasPlane = !!ray.ray.intersectPlane(plane, planePoint);
  const planeDist = hasPlane ? ray.ray.origin.distanceTo(planePoint) : Infinity;

  let surfaceDist = Infinity, surfacePoint = null;
  for (const it of ray.intersectObject(muscle, false)) {
    if (plane.distanceToPoint(it.point) < 0) continue;   // this bit was cut away
    surfaceDist = it.distance; surfacePoint = it.point.clone(); break;
  }

  let point;
  if (surfacePoint && surfaceDist < planeDist) {
    // Step a little back toward the camera so the seed sits in the space just
    // in FRONT of the surface rather than inside the wall it landed on.
    point = surfacePoint.addScaledVector(ray.ray.direction, -0.6);
  } else if (hasPlane) {
    point = planePoint;
  } else {
    note('Nothing under the cursor — rotate, or move the cut.'); return;
  }
  const hit = classify(point);
  if (!hit) { note('That is outside the heart.'); return; }
  if (hit.kind === 'muscle') {
    note(state.tag === CFG.excludeTag
      ? 'That is muscle. For "Not lumen" click the empty space, not the wall.'
      : 'That looks like muscle. Click the cream area.');
    return;
  }
  state.seeds.push({ voxel: hit.voxel, point: [point.x, point.y, point.z], tag: state.tag,
    confidence: document.getElementById('unsure').checked ? 'unsure' : 'sure' });
  document.getElementById('unsure').checked = false;
  refresh();
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  view.dist = Math.max(bounds.radius * 1.1,
    Math.min(bounds.radius * 8, view.dist * (e.deltaY > 0 ? 1.08 : 0.92)));
  draw();
}, { passive: false });

document.getElementById('depth').oninput = e => { view.depth = e.target.value / 1000; draw(); };
document.getElementById('flip').onclick = () => { view.sign *= -1; draw(); };
document.querySelectorAll('[data-axis]').forEach(b => b.onclick = () => {
  view.axis = b.dataset.axis === 'v' ? 'v' : +b.dataset.axis;
  document.querySelectorAll('[data-axis]').forEach(o => o.classList.toggle('on', o === b));
  draw();
});
document.getElementById('reset').onclick = () => {
  view.az = 0.9; view.el = 0.25; view.dist = bounds.radius * 3.0; view.depth = 0.5;
  document.getElementById('depth').value = 500; draw();
};
document.getElementById('undo').onclick = () => { state.seeds.pop(); refresh(); };
document.getElementById('clear').onclick = () => { state.seeds = []; refresh(); };
window.addEventListener('resize', draw);

/* ---------------- seeds ---------------- */
function note(t) { document.getElementById('saveNote').textContent = t; }
function colourOf(tag) { return CFG.tags.find(t => t.tag === tag).colour; }

function rebuildMarkers() {
  markers.clear();
  const size = bounds.radius * 0.03;
  state.seeds.forEach(s => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 12),
      new THREE.MeshBasicMaterial({ color: colourOf(s.tag), depthTest: false,
        transparent: s.confidence === 'unsure', opacity: s.confidence === 'unsure' ? 0.5 : 1 }));
    m.position.set(s.point[0], s.point[1], s.point[2]);
    m.renderOrder = 4;
    markers.add(m);
  });
}
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
  state.seeds.forEach((s, i) => {
    const t = CFG.tags.find(x => x.tag === s.tag);
    const row = document.createElement('div'); row.className = 'seed';
    row.innerHTML = '<span class="swatch" style="background:' + t.colour + '"></span><span>' +
      t.label + (s.confidence === 'unsure' ? ' <em>(unsure)</em>' : '') + '</span>';
    const del = document.createElement('button'); del.textContent = 'x'; del.style.marginLeft = 'auto';
    del.onclick = () => { state.seeds.splice(i, 1); refresh(); };
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
  const chambers = CFG.tags.filter(t => t.tag !== CFG.excludeTag);
  const covered = chambers.filter(t =>
    state.seeds.some(s => s.tag === t.tag && s.confidence !== 'unsure')).length;
  const barriers = state.seeds.filter(s => s.tag === CFG.excludeTag).length;
  document.getElementById('progressNote').innerHTML =
    (covered === chambers.length ? '<span class="done">All six chambers labelled.</span>'
                                 : covered + ' of 6 chambers labelled.') +
    '<br>' + barriers + ' "not a chamber" marks placed.';
  rebuildMarkers(); draw();
}
function payload() {
  return JSON.stringify({
    pack: CFG.pack, resolution: CFG.fullResolution, source: '3d-mesh', slices: [],
    seeds: state.seeds.map(s => ({
      slice: '3d', axis: -1,
      voxel: s.voxel.map(v => v * CFG.hit.scaleToFull + ((CFG.hit.scaleToFull / 2) | 0)),
      model_point_mm: s.point, tag: s.tag, confidence: s.confidence
    }))
  }, null, 2);
}
document.getElementById('download').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([payload()], { type: 'application/json' }));
  a.download = 'seeds.json'; a.click(); note('Saved ' + state.seeds.length + ' seeds.');
};
document.getElementById('copy').onclick = async () => {
  await navigator.clipboard.writeText(payload()); note('Copied.');
};
window.addEventListener('keydown', e => {
  if (e.key >= '1' && e.key <= '7' && CFG.tags[+e.key - 1]) {
    state.tag = CFG.tags[+e.key - 1].tag; drawTags();
  }
  else if (e.key === 'u') { const c = document.getElementById('unsure'); c.checked = !c.checked; }
  else if ((e.metaKey || e.ctrlKey) && e.key === 'z') { state.seeds.pop(); refresh(); }
});

/* ---------------- start ---------------- */
function start() {
  hitVol = decodeHit(document.getElementById('hitimg'));
  document.getElementById('packLine').textContent =
    CFG.pack + ' · ' + M.triangleCount.toLocaleString() + ' triangles · stencil cap cut face';
  document.querySelector('[data-axis="2"]').classList.add('on');
  document.getElementById('status').style.display = 'none';
  document.getElementById('hint').style.display = '';
  drawTags(); refresh();
}
const hitImg = document.getElementById('hitimg');
if (hitImg.complete && hitImg.naturalWidth) start(); else hitImg.onload = start;

} catch (err) {
  // Never fail blank again. Two earlier versions showed an empty canvas and a
  // stuck "Loading" banner, which is indistinguishable from a broken file and
  // gives whoever opened it nothing to report back.
  const box = document.getElementById('status');
  box.textContent = 'Could not start: ' + (err && err.message ? err.message : err);
  box.style.background = '#fdecea'; box.style.borderColor = '#f5c6c2';
  throw err;
}
</script>
</body>
</html>
"""


def bundle_three(root: Path) -> str:
    """
    Bundle three.js into a CLASSIC script that sets a global.

    `three.module.min.js` is an ES module that re-exports from
    `three.core.min.js`, so it is neither self-contained nor loadable without a
    module loader — and a module CANNOT be loaded from a `file://` page, because
    module fetches use CORS and a file document has an opaque origin. That is
    what made the first build of this tool open to a blank canvas. esbuild is
    already present as a vite dependency, so the bundle is produced at build
    time rather than adding anything at runtime.
    """
    import subprocess
    import tempfile

    esbuild = root / "node_modules/.bin/esbuild"
    if not esbuild.exists():
        raise FileNotFoundError(f"esbuild not found at {esbuild}")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "three.iife.js"
        subprocess.run(
            [str(esbuild), str(root / "node_modules/three/build/three.module.js"),
             "--bundle", "--format=iife", "--global-name=THREE", "--minify",
             f"--outfile={out}"],
            check=True, capture_output=True)
        return out.read_text()


def main() -> int:
    import argparse
    import sys

    root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(root / "pipeline"))

    parser = argparse.ArgumentParser(description="Build the mesh chamber labeller.")
    parser.add_argument("--pack", default="normal-vhl-heart0102")
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
    mesh = build_mesh(surface.vertices.astype(np.float64), surface.faces.astype(np.int64))
    print(f"mesh: {mesh['triangleCount']} triangles, {mesh['vertexCount']} vertices")

    grid = voxelise(surface.vertices, surface.faces, args.resolution)
    envelope = epicardial_envelope(grid.mask, 10.0, grid.pitch)
    labels, sizes = components(envelope & ~grid.mask)
    cavity = labels == int(np.argmax(sizes))
    print(f"cavity {cavity.sum() * grid.pitch ** 3 / 1000:.1f} mL")

    three = bundle_three(root)
    target = build(mesh, grid.mask, cavity, grid.origin, grid.pitch,
                   args.resolution, args.out, args.pack, three)
    print(f"wrote {target} ({target.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
