/**
 * Echo renderer benchmark — laptop and phone-portrait viewports.
 *
 *   npm run bench:echo                       # against a running dev server
 *   npm run bench:echo -- http://host:port/  # or anywhere else
 *
 * Deliberately NOT a Playwright *test*: it reports numbers rather than
 * asserting them, and a perf threshold that fails CI on a busy machine is worse
 * than no threshold at all. `playwright.config.ts` scopes `testDir` to
 * `tests/visual`, so nothing here runs as part of `npm run test:visual`.
 *
 * Timing is wall-clock around `render()` followed by a 1x1 `readPixels`, which
 * blocks until the GPU has finished. Without that sync the numbers measure how
 * fast the driver accepts commands, not how fast it draws — usually off by an
 * order of magnitude.
 */
import { chromium, devices } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:5173/';

const VIEWPORTS = [
  { name: 'laptop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  { name: 'phone-portrait', ...devices['Pixel 7'] },
];

const browser = await chromium.launch();
const results = [];

for (const profile of VIEWPORTS) {
  const context = await browser.newContext(profile);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  const status = await page
    .waitForSelector('[data-testid="echo-panel"][data-status="ready"]', { timeout: 60000 })
    .then(() => 'ready')
    .catch(() => 'unavailable');

  if (status !== 'ready') {
    results.push({ profile: profile.name, status });
    await context.close();
    continue;
  }

  const measured = await page.evaluate(async () => {
    const canvas = document.querySelector('[data-testid="echo-canvas"]');
    const gl = canvas.getContext('webgl2');
    const pixel = new Uint8Array(4);
    const scrub = document.querySelector('[data-testid="echo-scrub"]');

    // Drive the sweep end to end through the real control, so the numbers cover
    // the whole saved range rather than one convenient pose.
    const set = (value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value',
      ).set;
      setter.call(scrub, String(value));
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const times = [];
    const positions = [];
    for (let step = 0; step <= 40; step += 1) {
      const t = step / 40;
      const start = performance.now();
      set(t);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      times.push(performance.now() - start);
      positions.push(t);
    }

    const warm = times.slice(5).sort((a, b) => a - b);
    const at = (p) => +warm[Math.floor(warm.length * p)].toFixed(1);
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      // Reported because it decides whether the numbers mean anything: headless
      // Chromium falls back to SwiftShader (software) unless a GPU is exposed,
      // and a software number is not a laptop number.
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      canvas: [canvas.width, canvas.height],
      frames: Number(canvas.dataset.echoFrame ?? 0),
      sweepPositions: positions.length,
      frameMs: { p50: at(0.5), p95: at(0.95), max: +warm[warm.length - 1].toFixed(1) },
      fps: { median: +(1000 / at(0.5)).toFixed(1), worst5pct: +(1000 / at(0.95)).toFixed(1) },
    };
  });

  results.push({ profile: profile.name, status, ...measured });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
