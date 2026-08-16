/**
 * CI gate: every shipped pack validates against content-pack schema v0.
 *
 *   npm run validate:packs
 *
 * Also checks that referenced assets exist on disk and that the declared
 * `echo_volume` resolution matches the size of a `raw-u8` asset — a mismatch
 * there is invisible to the schema but fatal to the renderer.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION } from '../src/schema/packV0.ts';
import { formatIssues, readSchemaVersion, validatePack } from '../src/schema/validate.ts';
import { discoverPacks, relativeToRepo } from './lib/discoverPacks.ts';

const failures: string[] = [];

const packs = discoverPacks();
if (packs.length === 0) {
  console.error('No packs found under public/packs/.');
  process.exit(1);
}

for (const found of packs) {
  const label = relativeToRepo(found.jsonPath);

  const declared = readSchemaVersion(found.raw);
  if (declared !== SCHEMA_VERSION) {
    failures.push(`${label}: declares schema_version "${declared}"; expected "${SCHEMA_VERSION}"`);
    continue;
  }

  const result = validatePack(found.raw);
  if (!result.ok) {
    failures.push(`${label}: failed schema v${SCHEMA_VERSION} validation:\n${formatIssues(result.issues)}`);
    continue;
  }

  const { pack } = result;
  const assets: string[] = [pack.meshes.gltf, pack.echo_volume.asset];
  for (const asset of assets) {
    const assetPath = join(found.dir, asset);
    if (!existsSync(assetPath)) {
      failures.push(`${label}: referenced asset "${asset}" does not exist`);
    }
  }

  if (pack.echo_volume.format === 'raw-u8') {
    const assetPath = join(found.dir, pack.echo_volume.asset);
    if (existsSync(assetPath)) {
      const [x, y, z] = pack.echo_volume.resolution;
      const expected = x * y * z;
      const actual = statSync(assetPath).size;
      if (actual !== expected) {
        failures.push(
          `${label}: echo_volume "${pack.echo_volume.asset}" is ${actual} B; ` +
            `resolution ${x}x${y}x${z} implies ${expected} B`,
        );
      }
    }
  }

  console.log(
    `ok  ${label}  (${pack.meta.id} v${pack.meta.pack_version}, ` +
      `${pack.meshes.structures.length} structures, ${pack.views.length} views)`,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} pack validation failure(s):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\n${packs.length} pack(s) valid against schema v${SCHEMA_VERSION}.`);
