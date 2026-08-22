import { rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { PUBLISHED_CONTEXT_IDS, PUBLISHED_PACK_IDS } from './src/packs/published.ts';

/**
 * `base` is supplied by the deploying workflow, never hardcoded.
 *
 * GitHub Pages serves a project site under `/<repository-name>/`, so
 * `.github/workflows/pages.yml` sets `BASE_PATH=/${{ github.event.repository.name }}/`.
 * Local dev and `vite preview` normally run at `/`; release checks and Pages
 * supply a non-root path explicitly.
 *
 * Runtime code must resolve pack and asset URLs through `import.meta.env.BASE_URL`
 * rather than assuming either value.
 */
const base = process.env.BASE_PATH ?? '/';

/**
 * The authoring flag, as a build-time literal.
 *
 * `contracts/authoring-mode.md` requires authoring mode to be off by default
 * and unreachable from the learner UI. A `define` is what makes that structural
 * rather than conditional: `__AUTHORING__` is substituted before Rollup runs,
 * so with the flag off every authoring branch folds to a constant `false` and
 * the modules behind it are dropped from the bundle entirely. A runtime toggle
 * would ship the whole surface and hide it behind a string.
 *
 * `scripts/check-authoring-absent.ts` asserts the outcome against the built
 * output, because a build-time guarantee is still a piece of code that can be
 * reordered or broken by an upstream change.
 */
/**
 * Remove unpublished packs and body contexts from the build output.
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

  const prune = (
    plugin: { info: (message: string) => void },
    directory: string,
    allowed: readonly string[],
    what: string,
  ) => {
    const root = join(outDir, directory);
    if (!existsSync(root)) return;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (allowed.includes(entry.name)) continue;
      rmSync(join(root, entry.name), { recursive: true, force: true });
      plugin.info(`excluded unpublished ${what} "${entry.name}" from the build`);
    }
  };

  return {
    name: 'cardiology-published-packs-only',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      prune(this, 'packs', PUBLISHED_PACK_IDS as readonly string[], 'pack');
      // Body contexts are the second shippable directory under `public/`, and
      // several megabytes of third-party thoracic geometry each. A context
      // whose pack was pruned has nothing to be context FOR, so it goes too.
      prune(this, 'body-context', PUBLISHED_CONTEXT_IDS as readonly string[], 'body context');
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite modes are shell-independent, so `npm run dev:authoring` and
  // `npm run build:authoring` work on both macOS and Windows. Keep the
  // environment flag as a compatible override for external tooling.
  const authoring = mode === 'authoring' || process.env.VITE_AUTHORING === '1';

  return {
    base,
    define: { __AUTHORING__: JSON.stringify(authoring) },
    plugins: [react(), publishedPacksOnly()],
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  };
});
