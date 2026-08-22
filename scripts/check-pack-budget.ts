/**
 * CI gate: a pack's derived assets stay inside the geometry budget.
 *
 *   npm run check:pack-budget
 *
 * `pipeline/geometry.py` has carried a budget since wave 0 — 15 MB of derived
 * assets and 220,000 triangles per pack, from `docs/build_plan.md` — and it
 * enforces it by decimating on the way out. `normal-rodero` lands at 11.9 MB
 * and 222,380 triangles, which is what that budget looks like when it is
 * working.
 *
 * The budget was never a CHECK, though, only a step inside one pipeline. A pack
 * built by a different pipeline never meets it, and that is exactly what
 * happened: `pipeline/vhl_pack.py` writes surfaces straight off an authored
 * 384^3 partition and deliberately does not decimate — "no cross-label blur,
 * smoothing, thin-structure absorption, decimation, hole filling, or invented
 * geometry" is a stated property of that pack and a defensible one. The result
 * is 144 MB and 6.0 million triangles: nine times the byte budget and
 * twenty-seven times the triangle budget, and the reason the viewer is heavy on
 * that pack.
 *
 * So this asserts the outcome rather than trusting the step. The oversized pack
 * is recorded as a NAMED exception with its measured size, in the same spirit as
 * the frozen public-Git rights exceptions: an existing exposure is written down
 * so that it is visible and so that a NEW one cannot arrive unnoticed. Removing
 * an exception is a decision about that pack's geometry, not an edit to this
 * file.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packsDir = join(repoRoot, 'public', 'packs');

/** `pipeline/geometry.py: GEOMETRY_BUDGET_BYTES`. */
const GEOMETRY_BUDGET_BYTES = 15_000_000;

/**
 * Packs known to exceed the budget, with the measured size at the time it was
 * recorded and why it is tolerated. A pack may only sit here because a person
 * decided it should.
 */
const OVER_BUDGET_EXCEPTIONS: Readonly<Record<string, string>> = {
  'normal-vhl-heart0102-chambers':
    'About 144 MB of surfaces extracted from an authored 384^3 partition at grid resolution. ' +
    'pipeline/vhl_pack.py decimates nothing on purpose — the pack states that no smoothing, ' +
    'decimation or hole filling was applied — and that claim is the point of the pack. The ' +
    'cost is real: it is roughly twenty-seven times the triangle budget and it is why the ' +
    'viewer is noticeably heavier on this pack than on normal-rodero. Development-only, never ' +
    'shipped. Decimating it is an owner decision about the pack, not about this check.',
};

function assetBytes(packId: string): number {
  const dir = join(packsDir, packId, 'assets');
  if (!existsSync(dir)) return 0;
  let total = 0;
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else total += statSync(child).size;
    }
  };
  walk(dir);
  return total;
}

const failures: string[] = [];
const rows: string[] = [];

for (const entry of readdirSync(packsDir, { withFileTypes: true }).sort()) {
  if (!entry.isDirectory()) continue;
  const packId = entry.name;
  const bytes = assetBytes(packId);
  const megabytes = (bytes / 1_000_000).toFixed(1);
  const exception = OVER_BUDGET_EXCEPTIONS[packId];

  if (bytes <= GEOMETRY_BUDGET_BYTES) {
    if (exception !== undefined) {
      failures.push(
        `"${packId}" is recorded as an over-budget exception but measures ${megabytes} MB, ` +
          'inside the budget. Remove the exception rather than leaving a stale one.',
      );
    }
    rows.push(`ok  ${packId} — ${megabytes} MB`);
    continue;
  }

  if (exception === undefined) {
    failures.push(
      `"${packId}" ships ${megabytes} MB of derived assets, over the ` +
        `${(GEOMETRY_BUDGET_BYTES / 1_000_000).toFixed(0)} MB budget in pipeline/geometry.py. ` +
        'Decimate it to the budget, or record it in OVER_BUDGET_EXCEPTIONS with the reason and ' +
        'the decision behind it.',
    );
    continue;
  }
  rows.push(`over-budget, by recorded exception: ${packId} — ${megabytes} MB`);
}

for (const row of rows) console.log(row);

if (failures.length > 0) {
  console.error(`\n${failures.length} pack-budget failure(s):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `\n${rows.length} pack(s) checked against the ` +
    `${(GEOMETRY_BUDGET_BYTES / 1_000_000).toFixed(0)} MB geometry budget; ` +
    `${Object.keys(OVER_BUDGET_EXCEPTIONS).length} recorded exception(s).`,
);
