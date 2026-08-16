import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `base` is supplied by the deploying workflow, never hardcoded.
 *
 * GitHub Pages serves a project site under `/<repository-name>/`, so
 * `.github/workflows/pages.yml` sets `BASE_PATH=/${{ github.event.repository.name }}/`.
 * Local dev, `vite preview`, and the Playwright harness all run at `/`.
 *
 * Runtime code must resolve pack and asset URLs through `import.meta.env.BASE_URL`
 * rather than assuming either value.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
