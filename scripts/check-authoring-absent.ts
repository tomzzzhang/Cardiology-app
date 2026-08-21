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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
export const AUTHORING_BUNDLE_MARKERS: readonly { needle: string; what: string }[] = [
  { needle: 'Place from camera', what: 'the placement button’s label' },
  { needle: 'sets z axis', what: 'the four-chamber frame hint' },
  { needle: 'Standard views (docs/view_canon.md)', what: 'the view canon group label' },
  { needle: 'Level holds z vertical', what: 'the derived-axis readout' },
  { needle: 'authoring-controls', what: 'the authoring panel’s test id' },
  { needle: 'authoring-anchor', what: 'the anchor button’s test id' },
  { needle: 'authoring-save-centre', what: 'the destructive save control’s test id' },
  { needle: 'cardiology-authoring', what: 'the authoring IndexedDB database name' },
  { needle: 'is authoring-mode only', what: 'the authoring guard’s error text' },
  { needle: 'authoring-transition-note', what: 'the authoring transition notice’s test id' },
  { needle: 'Prevent auto-rotation', what: 'the authoring auto-rotation toggle label' },
  {
    needle: 'authoring-prevent-auto-rotation',
    what: 'the authoring auto-rotation toggle’s test id',
  },
  { needle: 'data-prevent-auto-rotation', what: 'the authoring auto-rotation state' },
  {
    needle: 'data-authoring-camera-orientation',
    what: 'the authoring camera-orientation test seam',
  },
  {
    needle: 'Moving between saved views. This intermediate plane cannot be saved.',
    what: 'the authoring transition notice',
  },
  { needle: 'probeTransition', what: 'the authoring probe-transition dataset state' },
  { needle: 'data-transitioning', what: 'the authoring echo-transition state' },
  { needle: 'Transition — not a saved view', what: 'the authoring transition heading' },
  {
    needle: 'Simulated echocardiogram, unauthored transition between saved views',
    what: 'the authoring transition image label',
  },
  {
    needle: 'Unvetted intermediate plane — animation between saved views',
    what: 'the authoring transition provenance label',
  },
];

/**
 * The literal build flag is harmless and necessarily imported by learner code.
 * Every other module below `src/authoring/` is implementation that must be
 * severed from the learner graph, even if minification removes all useful
 * identifiers and its current strings happen not to match a marker above.
 */
const ALLOWED_AUTHORING_SOURCES = new Set(['src/authoring/flag.ts']);

export function findAuthoringBundleLeaks(label: string, source: string): string[] {
  const failures: string[] = [];
  for (const marker of AUTHORING_BUNDLE_MARKERS) {
    if (source.includes(marker.needle)) {
      failures.push(
        `${label} contains ${marker.what} ("${marker.needle}"). `
        + 'The authoring surface is in the learner build.',
      );
    }
  }
  return failures;
}

function repoAuthoringSource(source: string): string | null {
  const normalized = source.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('src/authoring/');
  if (index < 0) return null;
  return normalized.slice(index);
}

export function findAuthoringSourceMapLeaks(label: string, source: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(source) as unknown;
  } catch (error) {
    return [`${label} is not valid JSON, so authoring-module absence cannot be proved: ${(error as Error).message}`];
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return [`${label} is not a source-map object, so authoring-module absence cannot be proved.`];
  }
  const sources = (raw as { sources?: unknown }).sources;
  if (!Array.isArray(sources) || !sources.every((entry) => typeof entry === 'string')) {
    return [`${label} has no string sources list, so authoring-module absence cannot be proved.`];
  }

  const leakedSources = new Set<string>();
  for (const sourcePath of sources) {
    const authoringPath = repoAuthoringSource(sourcePath);
    if (authoringPath !== null && !ALLOWED_AUTHORING_SOURCES.has(authoringPath)) {
      leakedSources.add(authoringPath);
    }
  }
  return [...leakedSources].sort().map(
    (sourcePath) => `${label} maps emitted code to ${sourcePath}. `
      + 'An authoring implementation module is in the learner build.',
  );
}

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

function main(): void {
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
  let sourceMaps = 0;

  for (const bundle of bundles) {
    bytes += statSync(bundle).size;
    const label = bundle.slice(repoRoot.length + 1);
    failures.push(...findAuthoringBundleLeaks(label, readFileSync(bundle, 'utf8')));

    const sourceMap = `${bundle}.map`;
    if (!existsSync(sourceMap)) {
      failures.push(
        `${label} has no external source map, so authoring-module absence cannot be proved.`,
      );
      continue;
    }
    sourceMaps += 1;
    failures.push(...findAuthoringSourceMapLeaks(
      sourceMap.slice(repoRoot.length + 1),
      readFileSync(sourceMap, 'utf8'),
    ));
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
    `ok  no authoring surface in ${bundles.length} bundle(s) and ${sourceMaps} source map(s), `
      + `${(bytes / 1024).toFixed(0)} kB JavaScript scanned`,
  );
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) main();
