/**
 * CI gate: the build ships exactly the published packs and contexts, and nothing else.
 *
 *   npm run build && npm run check:published-packs
 *
 * Most of this repository's packs may never reach the deployed site: two are
 * licence-blocked, and the shelf models are unpublished by rule. `vite.config.ts` prunes them from `dist/`, but a build filter
 * is a piece of code like any other: it can be reordered, disabled by a plugin
 * change, or quietly skipped when `publicDir` handling changes upstream. The
 * failure would be silent and the consequence is a licence breach on a public
 * URL, so the outcome is asserted rather than assumed.
 *
 * It also fails if a PUBLISHED pack is missing, because a build filter that
 * removes too much is just as wrong and much easier to miss.
 *
 * Body contexts get the same treatment for the same reason: they are the other
 * directory copied out of `public/`, they carry several megabytes of
 * third-party thoracic geometry each, and a context ships only if the pack it
 * is bound to ships.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLISHED_CONTEXT_IDS,
  PUBLISHED_PACK_IDS,
  UNPUBLISHED_CONTEXTS,
  UNPUBLISHED_PACKS,
} from '../src/packs/published.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distPacks = join(repoRoot, 'dist', 'packs');

if (!existsSync(distPacks)) {
  console.error(`No packs in the build output at ${distPacks}. Run "npm run build" first.`);
  process.exit(1);
}

const shipped = readdirSync(distPacks, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const failures: string[] = [];

for (const packId of shipped) {
  if ((PUBLISHED_PACK_IDS as readonly string[]).includes(packId)) continue;
  const rejection = UNPUBLISHED_PACKS[packId];
  failures.push(
    `"${packId}" is in the build output but is not published.` +
      (rejection ? `\n    ${rejection.licence}` : ''),
  );
}

for (const packId of PUBLISHED_PACK_IDS) {
  if (!shipped.includes(packId)) {
    failures.push(`"${packId}" is published but missing from the build output`);
  }
}

// The pruning must be complete: no stray assets left behind under a pack id.
for (const packId of Object.keys(UNPUBLISHED_PACKS)) {
  const stray = join(distPacks, packId);
  if (existsSync(stray)) {
    failures.push(`"${packId}" left files behind at ${stray}`);
  }
}

/*
 * Body contexts are the other shippable directory under `public/`, and each one
 * is several megabytes of third-party thoracic geometry. A context whose bound
 * pack was pruned has nothing left to be context for, and shipping it would put
 * that geometry on a public URL for a heart the site does not carry.
 */
const distContexts = join(repoRoot, 'dist', 'body-context');
const shippedContexts = existsSync(distContexts)
  ? readdirSync(distContexts, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];

for (const contextId of shippedContexts) {
  if ((PUBLISHED_CONTEXT_IDS as readonly string[]).includes(contextId)) continue;
  const rejection = UNPUBLISHED_CONTEXTS[contextId];
  failures.push(
    `body context "${contextId}" is in the build output but is not published.` +
      (rejection ? `\n    ${rejection}` : ''),
  );
}

for (const contextId of PUBLISHED_CONTEXT_IDS) {
  if (!shippedContexts.includes(contextId)) {
    failures.push(`body context "${contextId}" is published but missing from the build output`);
  }
}

for (const contextId of Object.keys(UNPUBLISHED_CONTEXTS)) {
  const stray = join(distContexts, contextId);
  if (existsSync(stray)) {
    failures.push(`body context "${contextId}" left files behind at ${stray}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} published-artefact failure(s):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`ok  build ships ${shipped.length} pack(s): ${shipped.join(', ')}`);
console.log(
  `ok  ${Object.keys(UNPUBLISHED_PACKS).length} unpublished pack(s) absent from the build: ` +
    `${Object.keys(UNPUBLISHED_PACKS).join(', ')}`,
);
console.log(
  `ok  build ships ${shippedContexts.length} body context(s): ` +
    `${shippedContexts.join(', ')}`,
);
console.log(
  `ok  ${Object.keys(UNPUBLISHED_CONTEXTS).length} unpublished body context(s) absent from the ` +
    `build: ${Object.keys(UNPUBLISHED_CONTEXTS).join(', ')}`,
);
