/**
 * CI gate: a transducer stands ON the patient.
 *
 *   npm run check:probe-on-skin
 *
 * This is the most basic fact about transthoracic echocardiography and nothing
 * in this repository enforced it. A probe pose is an origin, a beam and a fan,
 * and every one of those can be perfectly well-formed while the origin sits in
 * mid-air, or inside the mediastinum. Ultrasound does not propagate across an
 * air gap: a transducer that is not in contact with skin images nothing at all,
 * so a pose whose origin is off the body is not a bad view, it is not a view.
 *
 * It was not hypothetical. When this check was written, `normal-rodero`'s
 * right-parasternal bicaval sat **66.05 mm** off the skin and the chamber-labelled
 * pack's reference pose sat **92.31 mm** off it — nine centimetres — and both
 * rendered a confident-looking sector in the viewer. *(Corrected 2026-08-22:
 * these first read 66.5 mm and 92.6 mm, which are nearest-VERTEX distances, in a
 * header that goes on to explain why vertex distance is the wrong measure. They
 * are now what `distanceToSurfaceMm` returns for F1 at `normal-rodero` v0.1.4
 * and for the chamber pack's ingest reference pose as it stands.)*
 *
 * ## What it checks, and what it deliberately does not
 *
 * Only packs with a bound `body-context/v0` registration can be checked at all:
 * without one there is no skin to stand on, and a pack in its own model space is
 * not claiming a body. For those packs, every view in a CANON FAMILY — A to F in
 * `docs/view_canon.md` — must have its probe origin within `TOLERANCE_MM` of the
 * reference chest's skin surface.
 *
 * The `INGEST` family is excluded, and by definition rather than by exception. An
 * ingest reference pose is a mechanically derived pose from the pack's own
 * bounding sphere; it says in its name and in its provenance that it is not a
 * clinical view, it exists because schema v0.1 requires a pack with an
 * `echo_volume` to carry at least one view, and it is the anchor for the ingest
 * replay in `tests/unit/authoringIngest.test.ts`. It makes no claim to be a
 * window on a chest, so the rule about windows does not reach it. There is no
 * exception LIST here, and there should not be one: a view that claims a
 * transthoracic window and cannot reach the skin is wrong, and the fix is to
 * reauthor or withdraw it.
 *
 * ## Measuring it honestly
 *
 * Point-to-TRIANGLE distance against the shipped skin surface, not
 * point-to-nearest-vertex. The chest asset is decimated to a triangle budget, so
 * its vertices are millimetres apart; a probe genuinely resting on the surface
 * can be several millimetres from the nearest vertex, and a vertex-based test
 * would fail correct poses and pass nothing useful in exchange.
 *
 * The tolerance and the distance function live in `src/viewer/skinContact.ts`
 * so that the authoring viewer measures the pose on screen the way this gate
 * measures the pose in the pack. Only their location moved: what this file
 * checks, the canon-family filter and the exclusion of the `INGEST` family are
 * unchanged.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contextIdForPack } from '../src/packs/loadBodyContext.ts';
import { readBodyContext } from '../src/schema/bodyContextV0.ts';
import { validatePack } from '../src/schema/validate.ts';
import {
  SKIN_CONTACT_TOLERANCE_MM, distanceToSurfaceMm, type Point3,
} from '../src/viewer/skinContact.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * How far a probe origin may sit from the skin surface, in millimetres.
 *
 * `SKIN_CONTACT_TOLERANCE_MM`, imported rather than written here so that the
 * viewer's off-skin badge and this gate cannot come to disagree about what
 * contact means. The reasoning for the number is at its definition.
 */
const TOLERANCE_MM = SKIN_CONTACT_TOLERANCE_MM;

/** Families from `docs/view_canon.md`. Anything else makes no window claim. */
const CANON_FAMILIES = new Set(['A', 'B', 'C', 'D', 'E', 'F']);

type Vec3 = Point3;

/** Skin positions and triangle indices, from the context's own chest asset. */
function readSkinSurface(contextDir: string, gltfPath: string, binName: string): {
  positions: Float32Array; indices: Uint32Array;
} {
  const gltf = JSON.parse(readFileSync(join(contextDir, gltfPath), 'utf8')) as {
    meshes: { name: string; primitives: { attributes: { POSITION: number }; indices: number }[] }[];
    accessors: { bufferView: number; componentType: number; count: number; type: string }[];
    bufferViews: { byteOffset?: number; byteLength: number }[];
  };
  const bin = readFileSync(join(contextDir, dirname(gltfPath), binName));

  const mesh = gltf.meshes.find((entry) => entry.name === 'skin');
  if (mesh === undefined) throw new Error('the chest asset carries no "skin" mesh');
  const primitive = mesh.primitives[0];

  const read = (accessorIndex: number) => {
    const accessor = gltf.accessors[accessorIndex];
    const view = gltf.bufferViews[accessor.bufferView];
    const offset = (view.byteOffset ?? 0) + bin.byteOffset;
    const components = accessor.type === 'VEC3' ? 3 : 1;
    const length = accessor.count * components;
    // 5126 float, 5125 uint32, 5123 uint16.
    if (accessor.componentType === 5126) {
      return new Float32Array(bin.buffer.slice(offset, offset + length * 4));
    }
    if (accessor.componentType === 5125) {
      return new Uint32Array(bin.buffer.slice(offset, offset + length * 4));
    }
    return new Uint16Array(bin.buffer.slice(offset, offset + length * 2));
  };

  const positions = read(primitive.attributes.POSITION) as Float32Array;
  const raw = read(primitive.indices);
  return { positions, indices: Uint32Array.from(raw) };
}

const packsDir = join(repoRoot, 'public', 'packs');
const failures: string[] = [];
let checkedPacks = 0;
let checkedViews = 0;

for (const packId of [...new Set(
  readFileSync(join(repoRoot, 'src', 'packs', 'loadBodyContext.ts'), 'utf8')
    .split('\n')
    .flatMap((line) => {
      const match = /^\s*'([a-z0-9-]+)':\s*'[a-z0-9-]+',\s*$/.exec(line);
      return match ? [match[1]] : [];
    }),
)]) {
  const contextId = contextIdForPack(packId);
  if (contextId === null) continue;
  const packPath = join(packsDir, packId, 'pack.json');
  const contextDir = join(repoRoot, 'public', 'body-context', contextId);
  if (!existsSync(packPath) || !existsSync(join(contextDir, 'context.json'))) continue;

  const packResult = validatePack(JSON.parse(readFileSync(packPath, 'utf8')) as unknown);
  if (!packResult.ok) {
    failures.push(`"${packId}" does not validate; probe placement cannot be checked`);
    continue;
  }
  const context = readBodyContext(
    JSON.parse(readFileSync(join(contextDir, 'context.json'), 'utf8')) as unknown,
  );
  if (!context.ok) {
    failures.push(`body context "${contextId}" does not validate: ${context.problem}`);
    continue;
  }
  const asset = context.context.context_assets[0];
  if (asset === undefined) {
    console.log(`skip ${packId} — context "${contextId}" ships no chest geometry`);
    continue;
  }

  const { positions, indices } = readSkinSurface(contextDir, asset.gltf, 'chest.bin');
  const rotation = context.context.model_to_body.rotation_row_major;
  const translation = context.context.model_to_body.translation_mm;
  checkedPacks += 1;

  for (const view of packResult.pack.views) {
    if (!CANON_FAMILIES.has(view.family)) continue;
    checkedViews += 1;
    const [x, y, z] = view.probe.origin;
    const body: Vec3 = [
      rotation[0] * x + rotation[1] * y + rotation[2] * z + translation[0],
      rotation[3] * x + rotation[4] * y + rotation[5] * z + translation[1],
      rotation[6] * x + rotation[7] * y + rotation[8] * z + translation[2],
    ];
    const distance = distanceToSurfaceMm(body, positions, indices);
    const label = `${packId} / ${view.view_id}`;
    if (distance > TOLERANCE_MM) {
      failures.push(
        `${label}: the transducer is ${distance.toFixed(1)} mm from the skin of ` +
          `"${contextId}", over the ${TOLERANCE_MM} mm contact tolerance. Ultrasound does not ` +
          'cross an air gap, so this pose images nothing. Reauthor it onto the chest wall or ' +
          'withdraw it.',
      );
    } else {
      console.log(`ok  ${label} — ${distance.toFixed(2)} mm from skin`);
    }
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} probe-placement failure(s):\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `\n${checkedViews} canon-family view(s) across ${checkedPacks} context-bound pack(s) ` +
    `have their transducer within ${TOLERANCE_MM} mm of skin.`,
);
