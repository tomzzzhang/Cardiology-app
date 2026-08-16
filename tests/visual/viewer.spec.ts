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
  const status = page.getByTestId('pack-status');
  await expect(status).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
  await expect(status).toContainText('Synthetic stub pack');
  await expect(status).toContainText('validated');
  await expect(page.getByTestId('pack-error')).toHaveCount(0);
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
