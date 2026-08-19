/**
 * CI gate: the build ships exactly the published packs, and nothing else.
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
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLISHED_PACK_IDS, UNPUBLISHED_PACKS } from '../src/packs/published.ts';

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

if (failures.length > 0) {
  console.error(`\n${failures.length} published-pack failure(s):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`ok  build ships ${shipped.length} pack(s): ${shipped.join(', ')}`);
console.log(
  `ok  ${Object.keys(UNPUBLISHED_PACKS).length} unpublished pack(s) absent from the build: ` +
    `${Object.keys(UNPUBLISHED_PACKS).join(', ')}`,
);
