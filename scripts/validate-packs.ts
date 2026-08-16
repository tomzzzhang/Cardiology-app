/**
 * CI gate: every shipped pack validates against content-pack schema v0.
 *
 *   npm run validate:packs
 *
 * Beyond the schema, this checks asset *semantics*: referenced files exist,
 * every `mesh_node` resolves to a named node inside the glTF, the glTF's own
 * external resources are embedded or present, and a `raw-u8` volume matches its
 * declared resolution and declares every voxel value it contains. A pack that
 * passes a reference-only check can still fail, or silently mislabel, at
 * runtime.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION } from '../src/schema/packV0.ts';
import { formatIssues, readSchemaVersion, validatePack } from '../src/schema/validate.ts';
import { discoverPacks, relativeToRepo } from './lib/discoverPacks.ts';
import { checkGltfReferences, checkRawVolume } from './lib/packAssets.ts';

const failures: string[] = [];
const notes: string[] = [];

const packs = discoverPacks();
if (packs.length === 0) {
  console.error('No packs found under public/packs/.');
  process.exit(1);
}

for (const found of packs) {
  const label = relativeToRepo(found.jsonPath);

  if (found.problem !== null) {
    failures.push(`${label}: ${found.problem}`);
    continue;
  }

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
  for (const asset of [pack.meshes.gltf, pack.echo_volume.asset]) {
    if (!existsSync(join(found.dir, asset))) {
      failures.push(`${label}: referenced asset "${asset}" does not exist`);
    }
  }

  const gltf = checkGltfReferences(
    join(found.dir, pack.meshes.gltf),
    pack.meshes.structures.map((structure) => structure.mesh_node),
  );
  failures.push(...gltf.failures.map((failure) => `${label}: ${failure}`));
  notes.push(...gltf.skipped.map((skip) => `${label}: ${skip}`));

  if (pack.echo_volume.format === 'raw-u8') {
    const volume = checkRawVolume(
      join(found.dir, pack.echo_volume.asset),
      pack.echo_volume.resolution,
      pack.echo_volume.labels.map((entry) => entry.id),
    );
    failures.push(...volume.failures.map((failure) => `${label}: ${failure}`));
    notes.push(...volume.skipped.map((skip) => `${label}: ${skip}`));
  } else {
    notes.push(
      `${label}: echo_volume format "${pack.echo_volume.format}" — contents not inspected in wave 0`,
    );
  }

  console.log(
    `ok  ${label}  (${pack.meta.id} v${pack.meta.pack_version}, ` +
      `${pack.meshes.structures.length} structures, ${pack.views.length} views)`,
  );
}

for (const note of notes) console.log(`note  ${note}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} pack validation failure(s):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\n${packs.length} pack(s) valid against schema v${SCHEMA_VERSION}.`);
