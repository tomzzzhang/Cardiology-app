import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Wave 0 visual-regression seed.
 *
 * Two layers, on purpose:
 *  1. deterministic assertions that hold on any platform (canvas present, not
 *     blank, stub pack validated) — these gate CI from the first run;
 *  2. a tolerance-based screenshot comparison, which becomes a real gate once
 *     Linux baselines are committed (see `playwright.config.ts`).
 *
 * `?freeze=1` stops the hello-world animation so frames are reproducible.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/?freeze=1');
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-viewer-ready', 'true');
});

test('renders a non-blank WebGL canvas', async ({ page }) => {
  const canvas = page.locator('.viewer canvas');
  await expect(canvas).toBeVisible();

  const distinctColours = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.viewer canvas');
    if (!canvas) return 0;
    const scratch = document.createElement('canvas');
    scratch.width = 64;
    scratch.height = 64;
    const context = scratch.getContext('2d');
    if (!context) return 0;
    context.drawImage(canvas, 0, 0, 64, 64);
    const { data } = context.getImageData(0, 0, 64, 64);
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return seen.size;
  });

  // A blank or failed context yields a single flat colour.
  expect(distinctColours).toBeGreaterThan(8);
});

test('loads and validates the stub content pack', async ({ page }) => {
  // The shell now defaults to the real Rodero pack, so the stub is requested
  // explicitly. Keeping a stub-backed assertion is deliberate: it is the only
  // pack whose contents are fixed by this repository, so it is the only one
  // that can pin loader behaviour without depending on ingest output.
  await page.goto('/?freeze=1&pack=stub');
  const status = page.getByTestId('pack-status');
  await expect(status).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
  await expect(status).toContainText('Synthetic stub pack');
  await expect(status).toContainText('validated');
  await expect(page.getByTestId('pack-error')).toHaveCount(0);
});

test('renders the simulated echo over the real labelled volume', async ({ page }) => {
  const panel = page.getByTestId('echo-panel');
  await expect(panel).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });

  // The "simulated" label is a contract requirement (contracts/echo-renderer.md
  // "Honesty requirements"), not decoration. It must be on screen with the image.
  await expect(page.getByTestId('echo-simulated')).toBeVisible();
  await expect(page.getByTestId('echo-provenance')).toContainText('Draft');

  // The sector must contain real grey-level STRUCTURE. A renderer that
  // saturated to a flat white fan — which an earlier revision did — would pass
  // any "canvas is not blank" check, so this asserts a spread of mid-greys
  // rather than merely more than one colour.
  const greys = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="echo-canvas"]');
    if (!canvas) return null;
    const scratch = document.createElement('canvas');
    scratch.width = 128;
    scratch.height = 128;
    const context = scratch.getContext('2d');
    if (!context) return null;
    context.drawImage(canvas, 0, 0, 128, 128);
    const { data } = context.getImageData(0, 0, 128, 128);
    let dark = 0;
    let mid = 0;
    let bright = 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i];
      if (value < 24) dark += 1;
      else if (value > 232) bright += 1;
      else mid += 1;
    }
    return { dark, mid, bright, total: data.length / 4 };
  });

  expect(greys).not.toBeNull();
  // Blood and the region outside the sector are dark; tissue is mid-grey.
  expect(greys!.dark).toBeGreaterThan(greys!.total * 0.2);
  expect(greys!.mid).toBeGreaterThan(greys!.total * 0.05);
});

test('scrubbing the sweep changes the image', async ({ page }) => {
  await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });

  const sample = () =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="echo-canvas"]');
      const scratch = document.createElement('canvas');
      scratch.width = 48;
      scratch.height = 48;
      const context = scratch.getContext('2d')!;
      context.drawImage(canvas!, 0, 0, 48, 48);
      return [...context.getImageData(0, 0, 48, 48).data].filter((_, i) => i % 4 === 0);
    });

  const before = await sample();
  await page.getByTestId('echo-scrub').fill('1');
  await page.waitForTimeout(500);
  const after = await sample();

  // The sweep drives a real change in probe pose, so the image must move. If
  // these matched, poseAt() would be returning the same pose for every scrub
  // position and the scrubber would be decorative.
  const changed = before.reduce((count, value, i) => count + (value === after[i] ? 0 : 1), 0);
  expect(changed).toBeGreaterThan(before.length * 0.1);
});

test('no console errors on load', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/?freeze=1');
  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-status', 'ok', {
    timeout: 15_000,
  });

  expect(errors).toEqual([]);
});

test('app shell screenshot', async ({ page }, testInfo) => {
  const baseline = testInfo.snapshotPath('app-shell.png');
  const seeding = !['none', 'missing'].includes(testInfo.config.updateSnapshots);
  test.skip(
    !seeding && !existsSync(baseline),
    `no committed baseline for project "${testInfo.project.name}" yet — ` +
      'seed one with `npm run test:visual:update` on the target platform (wave 1)',
  );

  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-status', 'ok', {
    timeout: 15_000,
  });
  await expect(page).toHaveScreenshot('app-shell.png', { fullPage: true });
});
