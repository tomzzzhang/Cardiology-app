/**
 * CI gate: every shipped pack validates against content-pack schema v0.1.
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
import {
  checkGltfReferences,
  checkRawVolume,
  checkVolumeRegistration,
} from './lib/packAssets.ts';

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
  const echoVolume = pack.echo_volume;
  const referenced = [pack.meshes.gltf, ...(echoVolume ? [echoVolume.asset] : [])];
  for (const asset of referenced) {
    if (!existsSync(join(found.dir, asset))) {
      failures.push(`${label}: referenced asset "${asset}" does not exist`);
    }
  }

  // Groups carry no geometry, so they reference no glTF node and are skipped.
  const meshNodes = pack.meshes.structures
    .map((structure) => structure.mesh_node)
    .filter((node): node is string => node !== null);
  const gltf = checkGltfReferences(join(found.dir, pack.meshes.gltf), meshNodes);
  failures.push(...gltf.failures.map((failure) => `${label}: ${failure}`));
  notes.push(...gltf.skipped.map((skip) => `${label}: ${skip}`));

  /*
   * EVERY keyframe is checked, not just the first.
   *
   * Motion multiplies the ways a pack can be half-built: a frame file that was
   * never written, or one whose node names drifted, produces geometry that
   * vanishes partway through playback. That reads as a renderer bug, and the
   * cheapest place to catch it is here, where the frame list and the files are
   * both in hand.
   */
  const keyframes = pack.meshes.keyframes;
  if (keyframes) {
    for (const [index, frame] of keyframes.frames.entries()) {
      const framePath = join(found.dir, frame.gltf);
      if (!existsSync(framePath)) {
        failures.push(`${label}: keyframe ${index} ("${frame.label}") is missing "${frame.gltf}"`);
        continue;
      }
      if (index === 0) continue; // already checked as meshes.gltf
      const frameGltf = checkGltfReferences(framePath, meshNodes);
      failures.push(
        ...frameGltf.failures.map((failure) => `${label}: keyframe ${index}: ${failure}`),
      );
    }
    console.log(
      `ok  ${label}  keyframes: ${keyframes.frames.length} frames, ` +
        `${keyframes.coverage}` +
        `${keyframes.vertex_correspondence ? '' : ', no vertex correspondence'}`,
    );
  }

  if (echoVolume === undefined) {
    notes.push(`${label}: EXPLORE-ONLY — no echo_volume, and correspondingly no views`);
  } else if (echoVolume.format === 'raw-u8') {
    const volume = checkRawVolume(
      join(found.dir, echoVolume.asset),
      echoVolume.resolution,
      echoVolume.labels.map((entry) => entry.id),
    );
    failures.push(...volume.failures.map((failure) => `${label}: ${failure}`));
    notes.push(...volume.skipped.map((skip) => `${label}: ${skip}`));

    // R13: the volume and the mesh have to describe the same heart in the same
    // orientation. Every check above is satisfied by a permuted volume.
    const meshNodeOf = new Map(
      pack.meshes.structures
        .filter((structure) => structure.mesh_node !== null)
        .map((structure) => [structure.id, structure.mesh_node as string]),
    );
    const registration = checkVolumeRegistration(
      join(found.dir, pack.meshes.gltf),
      join(found.dir, echoVolume.asset),
      echoVolume.resolution,
      echoVolume.mesh_to_volume,
      echoVolume.labels,
      (structure) => meshNodeOf.get(structure),
    );
    failures.push(...registration.failures.map((failure) => `${label}: ${failure}`));
    notes.push(...registration.skipped.map((skip) => `${label}: ${skip}`));
  } else {
    notes.push(
      `${label}: echo_volume format "${echoVolume.format}" — contents not inspected in wave 0`,
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
