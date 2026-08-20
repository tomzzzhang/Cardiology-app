/**
 * A pack's bounding sphere, read from its glTF JSON alone.
 *
 * The runtime measures the real thing — `THREE.Box3().setFromObject(scene)`
 * walks every vertex — and the unit suite cannot: it runs in Node with no
 * WebGL, no loader and no reason to parse 180k vertices out of a `.bin`. What
 * it CAN do is read the POSITION accessors' declared `min`/`max`, which glTF
 * requires for exactly this purpose, and compose the node transforms above
 * them.
 *
 * The result is CONSERVATIVE: transforming the eight corners of an axis-aligned
 * box under a rotation and re-bounding the corners gives a box at least as
 * large as the true one. That is the right direction for the thing it is used
 * for — a standoff derived from a radius at least as large as the truth still
 * contains the truth — and the test says so rather than pretending the two
 * numbers are the same measurement.
 */
import { readFileSync } from 'node:fs';

interface GltfAccessor { min?: number[]; max?: number[]; type?: string }
interface GltfPrimitive { attributes?: Record<string, number> }
interface GltfMesh { primitives?: GltfPrimitive[] }
interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfDocument {
  accessors?: GltfAccessor[];
  meshes?: GltfMesh[];
  nodes?: GltfNode[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
}

export interface BoundingSphere {
  centre: [number, number, number];
  radius: number;
}

type Matrix = number[]; // 4x4, column-major, as glTF stores it

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function fromTrs(node: GltfNode): Matrix {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function apply(m: Matrix, p: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/**
 * The bounding sphere of a `.gltf` file's default scene, or null.
 *
 * Null rather than an exception when nothing is measurable — a `.glb`, a file
 * with no POSITION minima — because the caller is a test that should SKIP such
 * a pack loudly rather than fail on it.
 */
export function boundingSphereFromGltf(gltfPath: string): BoundingSphere | null {
  if (!gltfPath.endsWith('.gltf')) return null;
  const document = JSON.parse(readFileSync(gltfPath, 'utf8')) as GltfDocument;

  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let seen = false;

  const visit = (index: number, parent: Matrix) => {
    const node = document.nodes?.[index];
    if (!node) return;
    const world = multiply(parent, fromTrs(node));

    const mesh = node.mesh === undefined ? undefined : document.meshes?.[node.mesh];
    for (const primitive of mesh?.primitives ?? []) {
      const accessorIndex = primitive.attributes?.POSITION;
      if (accessorIndex === undefined) continue;
      const accessor = document.accessors?.[accessorIndex];
      const min = accessor?.min;
      const max = accessor?.max;
      if (!min || !max || min.length < 3 || max.length < 3) continue;

      // All eight corners, because a rotation turns a box into something no
      // single pair of opposite corners bounds.
      for (let corner = 0; corner < 8; corner += 1) {
        const point = apply(world, [
          (corner & 1) ? max[0] : min[0],
          (corner & 2) ? max[1] : min[1],
          (corner & 4) ? max[2] : min[2],
        ]);
        for (let axis = 0; axis < 3; axis += 1) {
          if (point[axis] < lo[axis]) lo[axis] = point[axis];
          if (point[axis] > hi[axis]) hi[axis] = point[axis];
        }
        seen = true;
      }
    }

    for (const child of node.children ?? []) visit(child, world);
  };

  const roots = document.scenes?.[document.scene ?? 0]?.nodes
    ?? document.nodes?.map((_, index) => index)
    ?? [];
  for (const root of roots) visit(root, IDENTITY);

  if (!seen) return null;

  const centre: [number, number, number] = [
    (lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2,
  ];
  const radius = Math.hypot(hi[0] - centre[0], hi[1] - centre[1], hi[2] - centre[2]);
  return { centre, radius };
}
