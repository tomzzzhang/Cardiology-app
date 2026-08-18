/**
 * A browser that refuses a WebGL context must still get a usable page.
 *
 * Before this was repaired, `THREE.WebGLRenderer` threw inside the effect, React
 * had no boundary, and the whole tree unmounted — a blank page with no message,
 * no pack status, and no "simulated, not diagnostic" disclaimer. Hospital
 * desktops with GPU acceleration disabled are a first-class target
 * (`docs/build_plan.md` "Stack"), and they are exactly where the context is
 * refused. The CI runner has software WebGL, so nothing else in the suite can
 * catch this.
 */
import { expect, test } from '@playwright/test';

// A fresh context is needed because the flags are set at browser launch.
test.use({
  launchOptions: {
    args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'],
  },
});

test.describe('WebGL unavailable', () => {
  test('the shell survives and explains itself', async ({ page }) => {
    await page.goto('/?freeze=1&pack=stub');

    // The anatomy viewer reports its own unavailability rather than disappearing.
    const viewer = page.getByTestId('anatomy-viewer');
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveAttribute('data-status', 'unavailable');
    await expect(page.getByTestId('anatomy-unavailable')).toBeVisible();
    await expect(page.getByTestId('anatomy-unavailable')).toContainText('WebGL');
    await expect(page.locator('.anatomy canvas')).toHaveCount(0);

    // Everything outside the viewer keeps working: the pack still loads and
    // validates, and the non-diagnostic disclaimer is still on screen.
    await expect(page.getByTestId('pack-status')).toHaveAttribute('data-status', 'ok', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('pack-status')).toContainText('Synthetic stub pack');
    await expect(page.locator('body')).toContainText('not for diagnostic use');

    // The echo panel degrades the same way: it reports that it cannot render
    // and keeps its "simulated" label and provenance on screen. A panel that
    // threw here would take the disclaimer down with it.
    await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'unavailable');
    await expect(page.getByTestId('echo-unavailable')).toContainText('WebGL2');
    await expect(page.getByTestId('echo-simulated')).toBeVisible();

    // The page must not be blank.
    const rendered = await page.evaluate(() => document.body.innerText.trim().length);
    expect(rendered).toBeGreaterThan(0);
  });
});
