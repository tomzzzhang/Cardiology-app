/**
 * Asset *semantics* checks for shipped packs.
 *
 * `validate-packs.ts` already confirms that referenced asset files exist. That
 * is not enough: a pack can name a glTF node that is not in the file, or ship a
 * label volume containing voxel values no label declares. Both pass a
 * reference-only check and then fail — or silently mislabel — at runtime.
 *
 * These helpers live apart from the script so the unit tests can drive them
 * directly with fixtures.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assetPathProblem } from '../../src/schema/primitives.ts';

interface GltfDocument {
  nodes?: { name?: string }[];
  meshes?: { name?: string }[];
  buffers?: { uri?: string }[];
  images?: { uri?: string }[];
}

/** Marker for a format whose internals wave 0 deliberately does not inspect. */
export interface AssetCheck {
  failures: string[];
  /** Checks knowingly skipped, so CI can say so out loud instead of implying coverage. */
  skipped: string[];
}

/**
 * Verify that every `mesh_node` resolves inside the referenced glTF, and that
 * the file's external resources are either embedded or present on disk.
 *
 * `.glb` and other container formats are reported as skipped rather than
 * silently passed — binary-container inspection is a tracked technical-slice
 * gap, not something wave 0 claims to cover.
 */
export function checkGltfReferences(gltfPath: string, meshNodes: string[]): AssetCheck {
  const failures: string[] = [];
  const skipped: string[] = [];

  if (!gltfPath.toLowerCase().endsWith('.gltf')) {
    skipped.push(
      `node and resource checks skipped for "${gltfPath}": only .gltf JSON is inspected in wave 0`,
    );
    return { failures, skipped };
  }
  if (!existsSync(gltfPath)) {
    // Existence is reported by the caller; nothing further to say here.
    return { failures, skipped };
  }

  let document: GltfDocument;
  try {
    document = JSON.parse(readFileSync(gltfPath, 'utf8')) as GltfDocument;
  } catch (cause) {
    failures.push(`glTF is not valid JSON: ${(cause as Error).message}`);
    return { failures, skipped };
  }

  const nodeNames = new Set(
    (document.nodes ?? []).map((node) => node.name).filter((name): name is string => !!name),
  );
  for (const meshNode of meshNodes) {
    if (!nodeNames.has(meshNode)) {
      const available = [...nodeNames].sort().join(', ') || '(none named)';
      failures.push(`mesh_node "${meshNode}" is not a named node in the glTF; available: ${available}`);
    }
  }

  const gltfDir = dirname(gltfPath);
  const resources: [string, string | undefined][] = [
    ...(document.buffers ?? []).map((buffer, i): [string, string | undefined] => [
      `buffers.${i}`,
      buffer.uri,
    ]),
    ...(document.images ?? []).map((image, i): [string, string | undefined] => [
      `images.${i}`,
      image.uri,
    ]),
  ];

  for (const [where, uri] of resources) {
    if (uri === undefined) continue; // GLB-style chunk reference; not reachable in .gltf JSON here.
    if (uri.startsWith('data:')) continue; // Embedded.

    const problem = assetPathProblem(uri);
    if (problem !== null) {
      failures.push(`glTF ${where} uri "${uri}" is not a safe pack-relative path: ${problem}`);
      continue;
    }
    if (!existsSync(join(gltfDir, uri))) {
      failures.push(`glTF ${where} references "${uri}", which does not exist`);
    }
  }

  return { failures, skipped };
}

/**
 * Verify a `raw-u8` label volume against its declared resolution and labels.
 *
 * Voxel value `0` is reserved as background and is always permitted; every
 * other value present must be declared in `labels[]`, and no label may claim
 * `0`. An undeclared value would render with no echogenicity or attenuation —
 * invisible in the pack, wrong on screen.
 */
export function checkRawVolume(
  assetPath: string,
  resolution: readonly [number, number, number],
  declaredLabelIds: readonly number[],
): AssetCheck {
  const failures: string[] = [];
  const skipped: string[] = [];

  if (!existsSync(assetPath)) {
    return { failures, skipped };
  }

  const [x, y, z] = resolution;
  const expected = x * y * z;
  const actual = statSync(assetPath).size;
  if (actual !== expected) {
    failures.push(`volume is ${actual} B; resolution ${x}x${y}x${z} implies ${expected} B`);
    return { failures, skipped };
  }

  if (declaredLabelIds.includes(0)) {
    failures.push('label id 0 is reserved for background and must not be declared');
  }

  const permitted = new Set<number>([0, ...declaredLabelIds]);
  const present = new Set<number>();
  for (const value of readFileSync(assetPath)) present.add(value);

  const undeclared = [...present].filter((value) => !permitted.has(value)).sort((a, b) => a - b);
  if (undeclared.length > 0) {
    failures.push(
      `volume contains undeclared voxel values [${undeclared.join(', ')}]; ` +
        'every non-background value must appear in echo_volume.labels',
    );
  }

  const unused = declaredLabelIds.filter((id) => !present.has(id)).sort((a, b) => a - b);
  if (unused.length > 0) {
    failures.push(
      `echo_volume.labels declares [${unused.join(', ')}], which appear nowhere in the volume`,
    );
  }

  return { failures, skipped };
}
