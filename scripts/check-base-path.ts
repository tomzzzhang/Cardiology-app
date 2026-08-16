/**
 * CI gate: the production base path actually reaches the emitted site.
 *
 *   npm run check:base-path
 *
 * The Pages workflow builds with `BASE_PATH=/<repository-name>/`; every other
 * check builds and runs at `/`. So a regression that hardcodes a root-absolute
 * URL — exactly the bug the derived-base design exists to prevent — would pass
 * typecheck, lint, unit tests, and the visual suite, and only surface on the
 * deployed site after a merge to `main`.
 *
 * This builds once with a sentinel base into a throwaway output directory and
 * asserts the sentinel reaches the HTML entry points, the emitted JavaScript,
 * and the pack URL that `import.meta.env.BASE_URL` feeds.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from './lib/discoverPacks.ts';

const SENTINEL = '/base-path-check/';

const outDir = mkdtempSync(join(tmpdir(), 'base-path-check-'));
const failures: string[] = [];

try {
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], {
    cwd: repoRoot,
    env: { ...process.env, BASE_PATH: SENTINEL },
    stdio: 'pipe',
  });

  const html = readFileSync(join(outDir, 'index.html'), 'utf8');
  if (!html.includes(`${SENTINEL}assets/`)) {
    failures.push(`index.html does not reference "${SENTINEL}assets/"`);
  }
  for (const rootAbsolute of ['src="/assets/', "src='/assets/", 'href="/assets/']) {
    if (html.includes(rootAbsolute)) {
      failures.push(`index.html contains a root-absolute asset reference: ${rootAbsolute}`);
    }
  }

  const assetsDir = join(outDir, 'assets');
  const scripts = readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
  if (scripts.length === 0) {
    failures.push('the build emitted no JavaScript to inspect');
  }

  const bundles = scripts.map((name) => readFileSync(join(assetsDir, name), 'utf8'));
  if (!bundles.some((bundle) => bundle.includes(`${SENTINEL}packs/`))) {
    failures.push(
      `no emitted bundle resolves pack URLs under "${SENTINEL}packs/" — ` +
        'a pack URL is being built without import.meta.env.BASE_URL',
    );
  }
  if (bundles.some((bundle) => bundle.includes('"/packs/') || bundle.includes("'/packs/"))) {
    failures.push('an emitted bundle contains a root-absolute "/packs/" URL');
  }

  if (failures.length > 0) {
    console.error(`\nProduction base path check failed with base "${SENTINEL}":\n`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`ok  production base "${SENTINEL}" reaches index.html, the bundle, and pack URLs.`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
