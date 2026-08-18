import { rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { PUBLISHED_PACK_IDS } from './src/packs/published.ts';

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

/**
 * Remove unpublished packs from the build output.
 *
 * The repository keeps the rejected wave 1a candidates as evidence, and they stay
 * loadable in `npm run dev` so the substrate comparison remains reproducible. The
 * DEPLOYED site must not carry them: two are licence-blocked, and a pack that is
 * merely hidden behind a runtime flag is still fetchable by anyone who guesses
 * the URL.
 *
 * Vite copies `publicDir` verbatim, and offers no hook to filter that copy, so
 * the copy is pruned afterwards in `closeBundle` — which runs after the public
 * directory has been written. The alternative, keeping the packs outside
 * `public/`, would also make them unreachable in dev, which is the one property
 * worth preserving.
 */
function publishedPacksOnly(): Plugin {
  let outDir = 'dist';
  return {
    name: 'cardiology-published-packs-only',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const packsDir = join(outDir, 'packs');
      if (!existsSync(packsDir)) return;
      for (const entry of readdirSync(packsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if ((PUBLISHED_PACK_IDS as readonly string[]).includes(entry.name)) continue;
        rmSync(join(packsDir, entry.name), { recursive: true, force: true });
        this.info(`excluded unpublished pack "${entry.name}" from the build`);
      }
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), publishedPacksOnly()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
