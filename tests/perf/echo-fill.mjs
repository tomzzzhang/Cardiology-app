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
import { measureEchoFill } from '../lib/measureEchoFill.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const packId = process.argv[3] ?? 'normal-rodero';
/** Which structure's wall is measured. Its label id is read from the pack. */
const STRUCTURE = process.argv[4] ?? 'lv-myocardium';

/**
 * Polar working resolutions to sweep, as multiples of the shipped one.
 *
 * The PSF's coherent pass divides by `sqrt(sum(w^2))`, which is the
 * normalisation that leaves INDEPENDENT scatterers with the variance they
 * arrived with — so tissue interior is resolution-invariant by construction.
 * A specular boundary return is CORRELATED across the kernel, and its correct
 * normalisation is `sum(w)`, so that term is resolution-DEPENDENT instead:
 * `sum(w)/sqrt(sum(w^2))` grows as `sqrt(sigma)`, and sigma in texels is
 * proportional to the scanline count. `boundaryReflection` was tuned under the
 * shipped sampling and is therefore pinned to it.
 *
 * Whether that pinning matters is a measurement, not an argument, and this is
 * the measurement: rim versus core across a wall, at each sampling.
 */
const POLAR_SCALES = (process.argv[5] ?? '0.5,1,2').split(',').map(Number);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const measureAt = async (scale) => {
  await page.goto(`${url}?freeze=1&pack=${packId}&polar=${scale}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="echo-panel"][data-status="ready"]', { timeout: 60_000 });
  return page.evaluate(measure, { packId, structure: STRUCTURE });
};

const measure = measureEchoFill;

const report = await measureAt(1);
console.log(JSON.stringify(report, null, 2));

/*
 * The resolution sweep, printed as its own table because it answers a different
 * question from the rest of this harness. Everything above asks "does the wall
 * render as a band?"; this asks "does the answer depend on the renderer's
 * internal sampling?", which is a question about whether the tuning constants
 * mean anything outside the one configuration they were set in.
 */
const sweep = [];
for (const scale of POLAR_SCALES) {
  const at = scale === 1 ? report : await measureAt(scale);
  sweep.push({ scale, rimVersusCore: at.rimVersusCore, greyByLabel: at.greyByLabel });
}

console.log('\n=== rim / core against polar working resolution ===');
console.log('  scale   scanlines x samples        rim     core    rim/core    dB vs 1x');
const reference = sweep.find((row) => row.scale === 1)?.rimVersusCore.ratio ?? 1;
for (const row of sweep) {
  const ratio = row.rimVersusCore.ratio;
  const db = 20 * Math.log10(ratio / reference);
  console.log(
    `  ${String(row.scale).padStart(5)}   ` +
    `${String(Math.round(384 * row.scale)).padStart(5)} x ${String(Math.round(512 * row.scale)).padEnd(5)}` +
    `      ${row.rimVersusCore.rim.toFixed(3)}   ${row.rimVersusCore.core.toFixed(3)}` +
    `    ${ratio.toFixed(3)}      ${db >= 0 ? '+' : ''}${db.toFixed(2)} dB`,
  );
}

await context.close();
await browser.close();
