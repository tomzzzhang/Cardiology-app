import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/**
 * Visual-regression infrastructure (wave 0).
 *
 * Wave 0 ships the harness; it does not ship baseline PNGs. Reference images
 * are platform-specific and the trustworthy ones come from the Linux CI runner,
 * which wave 0 has no way to produce locally. So:
 *
 *  - `updateSnapshots: 'none'` — a missing baseline is never written silently;
 *  - the screenshot test SKIPS itself when no baseline exists for the current
 *    project, and activates automatically the moment one is committed;
 *  - `npm run test:visual:update` (i.e. `--update-snapshots`) writes them.
 *
 * Wave 1 seeds Linux baselines from a CI run and the diff becomes a real gate.
 * The deterministic assertions in the same spec gate CI from day one.
 *
 * The app is served at `/` here; `BASE_PATH` is only set by the Pages workflow.
 */
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  updateSnapshots: 'none',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',

  expect: {
    toHaveScreenshot: {
      // Tolerance-based, per build_plan "per-view visual regression".
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: 'disabled',
    },
  },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'phone-portrait',
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: {
    // `--host 127.0.0.1` is required: vite preview otherwise binds ::1 only,
    // which the runner's IPv4 baseURL cannot reach.
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
