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
 * are now what `distanceToSkin` below returns for F1 at `normal-rodero` v0.1.4
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
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contextIdForPack } from '../src/packs/loadBodyContext.ts';
import { readBodyContext } from '../src/schema/bodyContextV0.ts';
import { validatePack } from '../src/schema/validate.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * How far a probe origin may sit from the skin surface, in millimetres.
 *
 * Not zero, and the reason is measurement rather than generosity: the shipped
 * skin is a decimated surface and a real transducer couples through gel. But it
 * is tight, because the measurement below is point-to-SURFACE: of the fourteen
 * poses actually placed against this body, thirteen sit under 0.1 mm from it and
 * the widest — an aperture `pipeline/migrate_apertures.py` slid onto the wall
 * along its own beam — sits at 3.16 mm. Five millimetres accepts all of them
 * with room to spare and rejects anything that is not in contact.
 */
const TOLERANCE_MM = 5;

/** Families from `docs/view_canon.md`. Anything else makes no window claim. */
const CANON_FAMILIES = new Set(['A', 'B', 'C', 'D', 'E', 'F']);

type Vec3 = readonly [number, number, number];

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

/** Squared distance from a point to one triangle. */
function pointTriangleSquared(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];

  const d1 = ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2];
  const d2 = ac[0] * ap[0] + ac[1] * ap[1] + ac[2] * ap[2];
  let u = 0;
  let v = 0;
  if (!(d1 <= 0 && d2 <= 0)) {
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
    const d3 = ab[0] * bp[0] + ab[1] * bp[1] + ab[2] * bp[2];
    const d4 = ac[0] * bp[0] + ac[1] * bp[1] + ac[2] * bp[2];
    const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const d5 = ab[0] * cp[0] + ab[1] * cp[1] + ab[2] * cp[2];
    const d6 = ac[0] * cp[0] + ac[1] * cp[1] + ac[2] * cp[2];
    const vc = d1 * d4 - d3 * d2;
    const vb = d5 * d2 - d1 * d6;
    const va = d3 * d6 - d5 * d4;

    if (d3 >= 0 && d4 <= d3) { u = 1; v = 0; }
    else if (d6 >= 0 && d5 <= d6) { u = 0; v = 1; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { u = d1 / (d1 - d3); v = 0; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { u = 0; v = d2 / (d2 - d6); }
    else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      u = 1 - w; v = w;
    } else {
      const denom = 1 / (va + vb + vc);
      u = vb * denom; v = vc * denom;
    }
  }

  const q = [a[0] + ab[0] * u + ac[0] * v, a[1] + ab[1] * u + ac[1] * v,
    a[2] + ab[2] * u + ac[2] * v];
  const dx = p[0] - q[0]; const dy = p[1] - q[1]; const dz = p[2] - q[2];
  return dx * dx + dy * dy + dz * dz;
}

function distanceToSkin(point: Vec3, positions: Float32Array, indices: Uint32Array): number {
  let best = Infinity;
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3; const ib = indices[i + 1] * 3; const ic = indices[i + 2] * 3;
    const squared = pointTriangleSquared(
      point,
      [positions[ia], positions[ia + 1], positions[ia + 2]],
      [positions[ib], positions[ib + 1], positions[ib + 2]],
      [positions[ic], positions[ic + 1], positions[ic + 2]],
    );
    if (squared < best) best = squared;
  }
  return Math.sqrt(best);
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
    const distance = distanceToSkin(body, positions, indices);
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
