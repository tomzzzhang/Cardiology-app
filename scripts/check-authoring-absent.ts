/**
 * CI gate: the authoring surface is not in the build.
 *
 *   npm run build && npm run check:authoring-absent
 *
 * `contracts/authoring-mode.md` — "Gating": authoring mode is off by default
 * and not reachable from the learner UI. `vite.config.ts` makes that structural
 * by substituting `__AUTHORING__` with a literal `false`, after which Rollup
 * folds every authoring branch away and drops the modules behind them.
 *
 * That is a guarantee produced by a build pipeline, and a build pipeline is a
 * piece of code like any other: a plugin ordering change, a `define` that stops
 * being applied, or a stray dynamic import would each turn the guarantee off
 * silently. The consequence is an editing surface on a public URL, so the
 * OUTCOME is asserted against the emitted JavaScript rather than assumed from
 * the configuration.
 *
 * It fails, deliberately, when the build was made with `VITE_AUTHORING=1`. That
 * is not a false positive: such a build must never be what gets deployed, and a
 * gate that passed on it would be asserting nothing.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'dist');

/**
 * Strings that exist only in the authoring surface.
 *
 * Chosen to be things the bundler cannot rename: user-visible text, test ids,
 * the IndexedDB database name, and the error text of the guard. Identifiers are
 * useless here — minification renames them — and a check that looked for
 * `AuthoringControls` would pass on a bundle that still contained the whole
 * component under another name.
 */
const MARKERS: { needle: string; what: string }[] = [
  { needle: 'Place from camera', what: 'the placement button’s label' },
  { needle: 'sets z axis', what: 'the four-chamber frame hint' },
  { needle: 'Standard views (docs/view_canon.md)', what: 'the view canon group label' },
  { needle: 'Level holds z vertical', what: 'the derived-axis readout' },
  { needle: 'authoring-controls', what: 'the authoring panel’s test id' },
  { needle: 'authoring-anchor', what: 'the anchor button’s test id' },
  { needle: 'authoring-save-centre', what: 'the destructive save control’s test id' },
  { needle: 'cardiology-authoring', what: 'the authoring IndexedDB database name' },
  { needle: 'is authoring-mode only', what: 'the authoring guard’s error text' },
];

function jsFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...jsFiles(path));
    } else if (entry.name.endsWith('.js')) {
      found.push(path);
    }
  }
  return found;
}

let bundles: string[];
try {
  bundles = jsFiles(join(distDir, 'assets'));
} catch {
  console.error(`No build output at ${join(distDir, 'assets')}. Run "npm run build" first.`);
  process.exit(1);
}

if (bundles.length === 0) {
  console.error(`No JavaScript in ${join(distDir, 'assets')}. Run "npm run build" first.`);
  process.exit(1);
}

const failures: string[] = [];
let bytes = 0;

for (const bundle of bundles) {
  bytes += statSync(bundle).size;
  const source = readFileSync(bundle, 'utf8');
  for (const marker of MARKERS) {
    if (source.includes(marker.needle)) {
      failures.push(
        `${bundle.slice(repoRoot.length + 1)} contains ${marker.what} ("${marker.needle}"). `
        + 'The authoring surface is in the learner build.',
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} authoring-gate failure(s):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    '\nIf this build was made with VITE_AUTHORING=1, it is not a deployable build. '
    + 'Rebuild without it.',
  );
  process.exit(1);
}

console.log(
  `ok  no authoring surface in ${bundles.length} bundle(s), ${(bytes / 1024).toFixed(0)} kB scanned`,
);
