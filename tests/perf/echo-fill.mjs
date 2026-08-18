/**
 * Does the myocardium render as a filled BAND, or as a bright rim?
 *
 *   npm run measure:echo                       # against a running static server
 *   npm run measure:echo -- http://host:port/  # or anywhere else
 *
 * `contracts/echo-renderer.md` priority 1 is grey-level ordering with
 * myocardium "mid-grey textured". The substrate genuinely carries a thick wall
 * — LV myocardium occupies 135 cm³ of voxels and ray chords through the label
 * have a ~10.7 mm median — so if the rendered wall reads as a thin bright line
 * with a dark interior, that is a renderer finding, not a substrate one, and
 * this script is how the two are told apart.
 *
 * Method. For each scanline of the selected view's fan, march the SAME ray the
 * shader marches, in the same polar geometry, reading two things at each depth:
 *
 *   * the ground truth — the label the pack's own volume carries there;
 *   * the result — the displayed grey at the screen pixel that depth lands on,
 *     obtained by inverting the display pass's screen->polar mapping.
 *
 * Every chord the ray cuts through the myocardial label then yields its true
 * thickness in millimetres and the thickness actually rendered above a
 * brightness floor, plus how the brightness is distributed across the chord —
 * which is the rim-versus-band question stated as a number.
 *
 * Deliberately NOT a Playwright *test*, for the same reason as `echo-bench.mjs`:
 * it reports numbers rather than asserting them. `playwright.config.ts` scopes
 * `testDir` to `tests/visual`, so nothing here runs in `npm run test:visual`.
 *
 * The sweep is parked at the scrub position whose sweep value is ZERO, so the
 * pose being measured is the pack's stored `probe` with no rotation applied.
 * That removes any need to reimplement `poseAt` here and get it subtly wrong.
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const packId = process.argv[3] ?? 'normal-rodero';
/** Which structure's wall is measured. Its label id is read from the pack. */
const STRUCTURE = process.argv[4] ?? 'lv-myocardium';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto(`${url}?freeze=1&pack=${packId}`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="echo-panel"][data-status="ready"]', { timeout: 60_000 });

const report = await page.evaluate(async ({ packId, structure }) => {
  const base = new URL(`packs/${packId}/`, document.baseURI);
  const pack = await (await fetch(new URL('pack.json', base))).json();
  const view = pack.views[0];
  const probe = view.probe;

  /* --- park the sweep at value zero, so `probe` IS the pose ------------- */
  const sweep = view.sweep;
  const t = sweep ? -sweep.range.from / (sweep.range.to - sweep.range.from) : 0;
  const scrub = document.querySelector('[data-testid="echo-scrub"]');
  if (scrub && sweep) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    ).set;
    setter.call(scrub, String(t));
    scrub.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  /* --- the imaging frame, as probeFrame.ts derives it -------------------- */
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => {
    const n = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / n, a[1] / n, a[2] / n];
  };
  const beam = norm(probe.beam_axis);
  const raw = probe.lateral_axis;
  const projected = dot(raw, beam);
  const lateral = norm([
    raw[0] - beam[0] * projected, raw[1] - beam[1] * projected, raw[2] - beam[2] * projected,
  ]);
  const halfAngle = (probe.fan.angle_deg * Math.PI) / 360;
  const depthMm = probe.fan.depth_cm * 10;

  /* --- ground truth: the pack's own label volume ------------------------- */
  const echo = pack.echo_volume;
  const voxels = new Uint8Array(
    await (await fetch(new URL(echo.asset, base))).arrayBuffer(),
  );
  const [vw, vh, vd] = echo.resolution;
  const m = echo.mesh_to_volume; // column-major
  const labelOf = (p) => {
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    // Clamped, exactly as the shader clamps its texture coordinates.
    const i = Math.min(vw - 1, Math.max(0, Math.floor(x)));
    const j = Math.min(vh - 1, Math.max(0, Math.floor(y)));
    const k = Math.min(vd - 1, Math.max(0, Math.floor(z)));
    return voxels[i + vw * (j + vh * k)]; // raw-u8 is x-fastest
  };
  const target = echo.labels.find((entry) => entry.structure === structure);
  if (!target) return { error: `pack declares no label for "${structure}"` };

  /* --- the rendered image ------------------------------------------------ */
  const canvas = document.querySelector('[data-testid="echo-canvas"]');
  const scratch = document.createElement('canvas');
  scratch.width = canvas.width;
  scratch.height = canvas.height;
  const context2d = scratch.getContext('2d');
  context2d.drawImage(canvas, 0, 0);
  const image = context2d.getImageData(0, 0, canvas.width, canvas.height).data;
  const aspect = canvas.width / canvas.height;

  /**
   * Displayed grey at fan angle `a` and depth `d`, by inverting the display
   * pass's screen -> polar mapping. Returns null outside the canvas.
   */
  const greyAt = (a, d) => {
    const radius = (2 * d) / depthMm;
    let px = radius * Math.sin(a);
    let py = radius * Math.cos(a) - 1;
    // Mirrors displayPass.ts: vertex-DOWN is the unflipped case.
    if (probe.display.vertex !== 'down') py = -py;
    if (probe.display.flip_lr) px = -px;
    px /= aspect;
    const ux = (px + 1) / 2;
    const uy = (py + 1) / 2;
    const column = Math.round(ux * canvas.width - 0.5);
    const row = Math.round((1 - uy) * canvas.height - 0.5);
    if (column < 0 || row < 0 || column >= canvas.width || row >= canvas.height) return null;
    return image[(row * canvas.width + column) * 4] / 255;
  };

  /* --- march ------------------------------------------------------------- */
  const STEP_MM = 0.25;
  const SCANLINES = 129;
  const FLOOR = 0.2; // displayed grey a learner would call "tissue, not blood"

  /*
   * Grey per label, over every sample on every scanline.
   *
   * "The wall is filled" is only worth anything alongside this. A renderer that
   * saturates the whole sector also fills the wall, and priority 1 is the
   * ORDERING — blood near-black, myocardium mid-grey — not the brightness of
   * any one structure.
   */
  const perLabel = new Map();
  const chords = [];
  for (let s = 0; s < SCANLINES; s += 1) {
    const u = -1 + (2 * s) / (SCANLINES - 1);
    const angle = u * halfAngle;
    const direction = [
      beam[0] * Math.cos(angle) + lateral[0] * Math.sin(angle),
      beam[1] * Math.cos(angle) + lateral[1] * Math.sin(angle),
      beam[2] * Math.cos(angle) + lateral[2] * Math.sin(angle),
    ];

    let run = null;
    for (let d = 0; d <= depthMm; d += STEP_MM) {
      const point = [
        probe.origin[0] + direction[0] * d,
        probe.origin[1] + direction[1] * d,
        probe.origin[2] + direction[2] * d,
      ];
      const label = labelOf(point);
      const sample = greyAt(angle, d);
      if (sample !== null) {
        const bucket = perLabel.get(label) ?? [];
        bucket.push(sample);
        perLabel.set(label, bucket);
      }

      const inside = label === target.id;
      if (inside) {
        const grey = sample;
        if (grey === null) continue;
        if (run === null) run = { start: d, greys: [] };
        run.greys.push(grey);
      } else if (run !== null) {
        chords.push({ ...run, end: d - STEP_MM });
        run = null;
      }
    }
    if (run !== null) chords.push({ ...run, end: depthMm });
  }

  /* --- statistics -------------------------------------------------------- */
  const median = (values) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const quantile = (values, q) => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  };
  const mean = (values) => (
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
  );

  const measured = chords
    .map((chord) => {
      const thicknessMm = chord.greys.length * STEP_MM;
      // Longest contiguous stretch rendered above the floor: the band a
      // learner would actually see and could measure with a caliper.
      let longest = 0;
      let current = 0;
      for (const grey of chord.greys) {
        current = grey >= FLOOR ? current + 1 : 0;
        longest = Math.max(longest, current);
      }
      // Rim versus core: the outer 1.5 mm at each end against the middle.
      const rimSamples = Math.max(1, Math.round(1.5 / STEP_MM));
      const rim = [...chord.greys.slice(0, rimSamples), ...chord.greys.slice(-rimSamples)];
      const core = chord.greys.slice(rimSamples, chord.greys.length - rimSamples);
      return {
        thicknessMm,
        renderedMm: longest * STEP_MM,
        filled: chord.greys.filter((grey) => grey >= FLOOR).length / chord.greys.length,
        meanGrey: mean(chord.greys),
        rimGrey: mean(rim),
        coreGrey: core.length > 0 ? mean(core) : null,
      };
    })
    .filter((chord) => chord.thicknessMm >= 3);

  /*
   * Near-perpendicular crossings only, for the thickness comparison. A chord
   * through a wall of thickness w at incidence angle theta is w / cos(theta), so
   * a wall imaged edge-on yields an arbitrarily long chord that says nothing
   * about wall thickness — and dropping out edge-on is REQUIRED behaviour, not
   * a defect. The 8-16 mm band brackets the substrate's 10.7 mm median.
   */
  const perpendicular = measured.filter((c) => c.thicknessMm >= 8 && c.thicknessMm <= 16);
  const withCore = measured.filter((c) => c.coreGrey !== null);

  return {
    structure,
    view: view.view_id,
    labelId: target.id,
    echogenicity: target.echogenicity,
    canvas: [canvas.width, canvas.height],
    chords: measured.length,
    trueThicknessMm: {
      p25: quantile(measured.map((c) => c.thicknessMm), 0.25),
      median: median(measured.map((c) => c.thicknessMm)),
      p75: quantile(measured.map((c) => c.thicknessMm), 0.75),
    },
    perpendicularChords: perpendicular.length,
    perpendicular: {
      trueMedianMm: median(perpendicular.map((c) => c.thicknessMm)),
      renderedMedianMm: median(perpendicular.map((c) => c.renderedMm)),
      filledFraction: mean(perpendicular.map((c) => c.filled)),
    },
    greyFloor: FLOOR,
    greyByLabel: [...perLabel.entries()]
      .filter(([, samples]) => samples.length >= 50)
      .map(([id, samples]) => ({
        label: id,
        structure: id === 0
          ? 'background / blood'
          : echo.labels.find((entry) => entry.id === id)?.structure ?? `undeclared ${id}`,
        echogenicity: id === 0 ? null : echo.labels.find((entry) => entry.id === id)?.echogenicity,
        samples: samples.length,
        meanGrey: Number(mean(samples).toFixed(3)),
        medianGrey: Number(median(samples).toFixed(3)),
      }))
      .sort((a, b) => b.meanGrey - a.meanGrey),
    rimVersusCore: {
      rim: mean(withCore.map((c) => c.rimGrey)),
      core: mean(withCore.map((c) => c.coreGrey)),
      ratio: mean(withCore.map((c) => c.rimGrey)) / Math.max(mean(withCore.map((c) => c.coreGrey)), 1e-6),
    },
  };
}, { packId, structure: STRUCTURE });

console.log(JSON.stringify(report, null, 2));

await context.close();
await browser.close();
