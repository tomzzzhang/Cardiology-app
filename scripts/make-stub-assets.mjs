/**
 * Generates the synthetic assets referenced by the stub content pack.
 *
 * The stub pack exists to exercise the loader, the schema, and CI. Its geometry
 * is deliberately non-anatomical: two nested boxes named `stub_shell` and
 * `stub_core`. Wave 0 ships no medical models and invents no clinical content.
 *
 * Output is deterministic — re-running must not produce a diff.
 *
 *   node scripts/make-stub-assets.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'packs', 'stub', 'assets');

/* -------------------------------------------------------------------------- */
/* glTF                                                                       */
/* -------------------------------------------------------------------------- */

/** Axis-aligned box as 24 discrete vertices (4 per face) so normals stay flat. */
function box(halfExtent) {
  const h = halfExtent;
  /** @type {[number, number, number][]} */
  const faces = [
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
  ];
  const positions = [];
  const normals = [];
  const indices = [];

  for (const [nx, ny, nz] of faces) {
    // Build an orthonormal tangent basis for this face.
    const up = Math.abs(ny) === 1 ? [0, 0, 1] : [0, 1, 0];
    const u = [ny * up[2] - nz * up[1], nz * up[0] - nx * up[2], nx * up[1] - ny * up[0]];
    const v = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];

    const base = positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      positions.push(
        (nx + su * u[0] + sv * v[0]) * h,
        (ny + su * u[1] + sv * v[1]) * h,
        (nz + su * u[2] + sv * v[2]) * h,
      );
      normals.push(nx, ny, nz);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return { positions, normals, indices, min: [-h, -h, -h], max: [h, h, h] };
}

const shell = box(1);
const core = box(0.4);

const bufferViews = [];
const accessors = [];
const chunks = [];
let offset = 0;

function pushView(bytes, target) {
  // glTF requires bufferView byteOffset to satisfy the accessor's alignment.
  const padding = (4 - (offset % 4)) % 4;
  if (padding > 0) {
    chunks.push(Buffer.alloc(padding));
    offset += padding;
  }
  const index = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  chunks.push(bytes);
  offset += bytes.length;
  return index;
}

function pushMesh(geometry) {
  const positionView = pushView(Buffer.from(Float32Array.from(geometry.positions).buffer), 34962);
  const normalView = pushView(Buffer.from(Float32Array.from(geometry.normals).buffer), 34962);
  const indexView = pushView(Buffer.from(Uint16Array.from(geometry.indices).buffer), 34963);

  const position = accessors.length;
  accessors.push({
    bufferView: positionView,
    componentType: 5126,
    count: geometry.positions.length / 3,
    type: 'VEC3',
    min: geometry.min,
    max: geometry.max,
  });
  const normal = accessors.length;
  accessors.push({
    bufferView: normalView,
    componentType: 5126,
    count: geometry.normals.length / 3,
    type: 'VEC3',
  });
  const index = accessors.length;
  accessors.push({
    bufferView: indexView,
    componentType: 5123,
    count: geometry.indices.length,
    type: 'SCALAR',
  });

  return { POSITION: position, NORMAL: normal, indices: index };
}

const shellAccessors = pushMesh(shell);
const coreAccessors = pushMesh(core);
const buffer = Buffer.concat(chunks);

const gltf = {
  asset: { version: '2.0', generator: 'cardiology-app scripts/make-stub-assets.mjs' },
  scene: 0,
  scenes: [{ nodes: [0, 1] }],
  nodes: [
    { name: 'stub_shell', mesh: 0 },
    { name: 'stub_core', mesh: 1 },
  ],
  meshes: [
    {
      name: 'stub_shell',
      primitives: [
        {
          attributes: { POSITION: shellAccessors.POSITION, NORMAL: shellAccessors.NORMAL },
          indices: shellAccessors.indices,
          material: 0,
        },
      ],
    },
    {
      name: 'stub_core',
      primitives: [
        {
          attributes: { POSITION: coreAccessors.POSITION, NORMAL: coreAccessors.NORMAL },
          indices: coreAccessors.indices,
          material: 1,
        },
      ],
    },
  ],
  materials: [
    {
      name: 'stub_shell',
      pbrMetallicRoughness: { baseColorFactor: [0.72, 0.35, 0.34, 1], metallicFactor: 0, roughnessFactor: 0.85 },
      doubleSided: true,
    },
    {
      name: 'stub_core',
      pbrMetallicRoughness: { baseColorFactor: [0.2, 0.32, 0.55, 1], metallicFactor: 0, roughnessFactor: 0.6 },
      doubleSided: true,
    },
  ],
  accessors,
  bufferViews,
  buffers: [
    {
      byteLength: buffer.length,
      uri: `data:application/octet-stream;base64,${buffer.toString('base64')}`,
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* labelled volume                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 32^3 `raw-u8` label volume matching the two boxes above.
 * 0 = background, 1 = stub_shell, 2 = stub_core.
 */
const RESOLUTION = 32;
const volume = Buffer.alloc(RESOLUTION ** 3);
for (let z = 0; z < RESOLUTION; z += 1) {
  for (let y = 0; y < RESOLUTION; y += 1) {
    for (let x = 0; x < RESOLUTION; x += 1) {
      // Voxel centre in model space, where the shell spans [-1, 1].
      const nx = ((x + 0.5) / RESOLUTION) * 2 - 1;
      const ny = ((y + 0.5) / RESOLUTION) * 2 - 1;
      const nz = ((z + 0.5) / RESOLUTION) * 2 - 1;
      const chebyshev = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
      let label = 0;
      if (chebyshev <= 0.4) label = 2;
      else if (chebyshev <= 0.9) label = 1;
      volume[x + RESOLUTION * (y + RESOLUTION * z)] = label;
    }
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'stub.gltf'), `${JSON.stringify(gltf, null, 2)}\n`);
writeFileSync(join(outDir, 'stub-volume.raw'), volume);

console.log(`wrote ${join(outDir, 'stub.gltf')} (${buffer.length} B of geometry)`);
console.log(`wrote ${join(outDir, 'stub-volume.raw')} (${volume.length} B, ${RESOLUTION}^3 u8)`);
