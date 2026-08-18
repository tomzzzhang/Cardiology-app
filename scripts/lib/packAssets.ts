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
  nodes?: { name?: string; mesh?: number }[];
  meshes?: { name?: string; primitives?: { attributes?: Record<string, number> }[] }[];
  buffers?: { uri?: string; byteLength?: number }[];
  bufferViews?: { buffer?: number; byteOffset?: number; byteStride?: number }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType?: number;
    count?: number;
    type?: string;
  }[];
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

/* -------------------------------------------------------------------------- */
/* R13 — the volume and the mesh describe the same heart                      */
/* -------------------------------------------------------------------------- */

/** Mean position of a named glTF node's POSITION accessor, in model space. */
function nodeCentroid(
  document: GltfDocument, gltfDir: string, name: string,
): [number, number, number] | null {
  const node = (document.nodes ?? []).find((candidate) => candidate.name === name);
  if (!node || node.mesh === undefined) return null;
  const primitive = document.meshes?.[node.mesh]?.primitives?.[0];
  const accessorIndex = primitive?.attributes?.POSITION;
  if (accessorIndex === undefined) return null;

  const accessor = document.accessors?.[accessorIndex];
  // Only the packed float VEC3 case the pipeline writes is read here. Anything
  // else returns null and the structure is skipped rather than mis-measured.
  if (!accessor || accessor.componentType !== 5126 || accessor.type !== 'VEC3') return null;
  const view = document.bufferViews?.[accessor.bufferView ?? -1];
  if (!view || (view.byteStride !== undefined && view.byteStride !== 12)) return null;
  const uri = document.buffers?.[view.buffer ?? 0]?.uri;
  if (uri === undefined) return null;

  // Both shapes the repo actually ships: the pipeline writes an external .bin,
  // the stub generator embeds base64. Excluding the embedded case would leave
  // the one pack whose contents this repository controls unchecked.
  let bytes: Buffer;
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    if (comma < 0 || !uri.slice(0, comma).endsWith(';base64')) return null;
    bytes = Buffer.from(uri.slice(comma + 1), 'base64');
  } else {
    const path = join(gltfDir, uri);
    if (!existsSync(path)) return null;
    bytes = readFileSync(path);
  }
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const count = accessor.count ?? 0;
  if (count === 0 || start + count * 12 > bytes.byteLength) return null;

  const floats = new Float32Array(bytes.buffer, bytes.byteOffset + start, count * 3);
  const sum: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < count; i += 1) {
    sum[0] += floats[i * 3];
    sum[1] += floats[i * 3 + 1];
    sum[2] += floats[i * 3 + 2];
  }
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}

/**
 * Check that the label volume is registered to the mesh it was voxelised from.
 *
 * Every other volume check is about the CONTENTS of the file — right size,
 * declared values. None of them notices if the axes are permuted, because a
 * permuted volume is the same bytes in a different order and passes all of
 * them. That is not hypothetical: the Python pipeline wrote its grid x-slowest
 * while `texImage3D` reads x-fastest, so every pack it produced shipped an
 * x/z-transposed volume. The renderer sampled the transposed heart, the wedge
 * on the model used the untransposed geometry, and the image still looked like
 * an echo of a heart.
 *
 * The check: each declared label's voxel centroid, carried back into model
 * space through the inverse of `mesh_to_volume`, must land near the vertex
 * centroid of the structure it names. The two are computed from different files
 * by different code, so agreement means the registration holds; a permutation
 * moves them tens of millimetres apart.
 *
 * The tolerance is relative to the model's own size, because a vertex centroid
 * and a voxel centroid are not the same statistic — vertex density is not
 * uniform — and the gap this is looking for is an order of magnitude larger
 * than that difference.
 */
export function checkVolumeRegistration(
  gltfPath: string,
  volumePath: string,
  resolution: readonly [number, number, number],
  meshToVolume: readonly number[],
  labels: readonly { id: number; structure: string }[],
  meshNodeOf: (structureId: string) => string | undefined,
): AssetCheck {
  const failures: string[] = [];
  const skipped: string[] = [];

  if (!gltfPath.toLowerCase().endsWith('.gltf') || !existsSync(gltfPath) || !existsSync(volumePath)) {
    skipped.push('volume/mesh registration not checked: an asset is missing or not .gltf JSON');
    return { failures, skipped };
  }

  const [width, height, depth] = resolution;
  const voxels = readFileSync(volumePath);
  if (voxels.byteLength !== width * height * depth) {
    // Size is reported by checkRawVolume; nothing meaningful to measure here.
    return { failures, skipped };
  }

  const inverse = invertAffine(meshToVolume);
  if (inverse === null) {
    failures.push('mesh_to_volume is singular, so no volume position maps back to model space');
    return { failures, skipped };
  }

  let document: GltfDocument;
  try {
    document = JSON.parse(readFileSync(gltfPath, 'utf8')) as GltfDocument;
  } catch {
    return { failures, skipped }; // Reported by checkGltfReferences.
  }
  const gltfDir = dirname(gltfPath);

  // Voxel centroid per label, in one pass. `raw-u8` is x-fastest:
  // offset = x + width * (y + height * z).
  const sums = new Map<number, [number, number, number, number]>();
  for (const { id } of labels) sums.set(id, [0, 0, 0, 0]);
  for (let offset = 0; offset < voxels.byteLength; offset += 1) {
    const entry = sums.get(voxels[offset]);
    if (entry === undefined) continue;
    const x = offset % width;
    const y = Math.floor(offset / width) % height;
    const z = Math.floor(offset / (width * height));
    entry[0] += x + 0.5;
    entry[1] += y + 0.5;
    entry[2] += z + 0.5;
    entry[3] += 1;
  }

  /*
   * Tolerance from the volume's own diagonal in model space, not from the
   * spread of the labels: a pack with a single label has no spread, and a
   * tolerance of zero would fail it for the rounding difference between a
   * vertex centroid and a voxel centroid. An axis permutation displaces a
   * structure by a good fraction of the whole grid, so the two scales are
   * nowhere near each other.
   */
  const diagonal = distance(
    applyAffine(inverse, [0, 0, 0]),
    applyAffine(inverse, [width, height, depth]),
  );
  const tolerance = diagonal * 0.06;

  for (const { id, structure } of labels) {
    const entry = sums.get(id);
    if (!entry || entry[3] === 0) continue; // Absent labels are checkRawVolume's business.
    const meshNode = meshNodeOf(structure);
    if (meshNode === undefined) continue;

    const mesh = nodeCentroid(document, gltfDir, meshNode);
    if (mesh === null) {
      skipped.push(`registration not checked for "${structure}": its POSITION data is not readable`);
      continue;
    }
    const voxel = applyAffine(inverse, [
      entry[0] / entry[3], entry[1] / entry[3], entry[2] / entry[3],
    ]);
    const gap = distance(mesh, voxel);
    if (gap > tolerance) {
      failures.push(
        `label ${id} ("${structure}") sits ${gap.toFixed(1)} units from its mesh node in model `
        + `space (tolerance ${tolerance.toFixed(1)}); the volume is not registered to the mesh — `
        + 'check the raw-u8 axis order, which is x-fastest',
      );
    }
  }

  return { failures, skipped };
}

/** Column-major 4x4 applied to a point. */
function applyAffine(m: readonly number[], p: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/**
 * Invert an affine 4x4 whose linear part is invertible, column-major in and out.
 *
 * Written out rather than pulled from three.js because this runs in the pack
 * validator, which is a Node script with no renderer and no scene.
 */
function invertAffine(m: readonly number[]): number[] | null {
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const determinant =
    a[0] * (a[4] * a[8] - a[5] * a[7])
    - a[3] * (a[1] * a[8] - a[2] * a[7])
    + a[6] * (a[1] * a[5] - a[2] * a[4]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return null;

  const inv = [
    (a[4] * a[8] - a[5] * a[7]) / determinant,
    (a[2] * a[7] - a[1] * a[8]) / determinant,
    (a[1] * a[5] - a[2] * a[4]) / determinant,
    (a[5] * a[6] - a[3] * a[8]) / determinant,
    (a[0] * a[8] - a[2] * a[6]) / determinant,
    (a[2] * a[3] - a[0] * a[5]) / determinant,
    (a[3] * a[7] - a[4] * a[6]) / determinant,
    (a[1] * a[6] - a[0] * a[7]) / determinant,
    (a[0] * a[4] - a[1] * a[3]) / determinant,
  ];
  const t = [m[12], m[13], m[14]];
  return [
    inv[0], inv[1], inv[2], 0,
    inv[3], inv[4], inv[5], 0,
    inv[6], inv[7], inv[8], 0,
    -(inv[0] * t[0] + inv[3] * t[1] + inv[6] * t[2]),
    -(inv[1] * t[0] + inv[4] * t[1] + inv[7] * t[2]),
    -(inv[2] * t[0] + inv[5] * t[1] + inv[8] * t[2]),
    1,
  ];
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
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
