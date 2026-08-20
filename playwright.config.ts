import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const RELEASE_CHECK = process.env.npm_lifecycle_event === 'test:release';
const BASE_PATH = (() => {
  const releaseDefault = RELEASE_CHECK ? '/release-check/' : '/';
  const raw = process.env.BASE_PATH?.trim() || releaseDefault;
  const leading = raw.startsWith('/') ? raw : `/${raw}`;
  return leading.endsWith('/') ? leading : `${leading}/`;
})();
const SERVER_URL = `http://127.0.0.1:${PORT}${BASE_PATH}`;

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
 * The default is `/`. The Pages workflow sets `BASE_PATH` so the same suite
 * exercises the exact project-site artifact it uploads.
 */
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The full local release run is parallel and can briefly contend for WebGL;
  // like CI, retry one isolated timing miss while preserving its diagnostics.
  retries: process.env.CI || RELEASE_CHECK ? 1 : 0,
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
    baseURL: SERVER_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // Preserved for the deferred phone/touch workstream. Normal platform,
      // CI, and release scripts select desktop-chromium explicitly.
      name: 'phone-portrait',
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: {
    /*
     * Serves `dist/` directly rather than through `vite preview`.
     *
     * `vite preview` also serves the project's `publicDir`, so files the build
     * deliberately excluded remain reachable over HTTP. Unpublished packs are
     * licence-blocked and pruned from `dist/` at build time; under preview they
     * were still being served, which made "the production build does not expose
     * them" untestable here. tests/static-server.mjs serves only the artefact
     * that deploys, and 404s like Pages does.
     */
    command: `npm run build && npm run add:404 && node tests/static-server.mjs ${PORT}`,
    url: SERVER_URL,
    env: { BASE_PATH },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
