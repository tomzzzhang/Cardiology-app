/**
 * Asset-semantics checks (R11, R12) plus the placeholder rule (R15).
 *
 * Before this round the validator confirmed only that the two referenced asset
 * files existed — a pack could name a glTF node that was not in the file, or
 * ship voxel values no label declared, and still pass CI.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkGltfReferences, checkRawVolume } from '../../scripts/lib/packAssets.ts';
import { isPlaceholder } from '../../scripts/lib/placeholders.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stubDir = join(repoRoot, 'public', 'packs', 'stub');

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'pack-assets-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeGltf(document: unknown): string {
  const path = join(workDir, 'model.gltf');
  writeFileSync(path, JSON.stringify(document));
  return path;
}

describe('R11 — glTF node references resolve', () => {
  it('passes the shipped stub pack', () => {
    const result = checkGltfReferences(join(stubDir, 'assets', 'stub.gltf'), [
      'stub_shell',
      'stub_core',
    ]);
    expect(result.failures).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('fails a mesh_node that is not a named node in the file', () => {
    const path = writeGltf({ nodes: [{ name: 'present' }] });
    const result = checkGltfReferences(path, ['present', 'absent']);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/"absent" is not a named node/);
    expect(result.failures[0]).toMatch(/available: present/);
  });

  it('fails an external buffer that does not exist', () => {
    const path = writeGltf({ nodes: [{ name: 'a' }], buffers: [{ uri: 'missing.bin' }] });
    const result = checkGltfReferences(path, ['a']);

    expect(result.failures).toEqual([
      'glTF buffers.0 references "missing.bin", which does not exist',
    ]);
  });

  it('accepts an external buffer that is present', () => {
    writeFileSync(join(workDir, 'present.bin'), Buffer.alloc(4));
    const path = writeGltf({ nodes: [{ name: 'a' }], buffers: [{ uri: 'present.bin' }] });

    expect(checkGltfReferences(path, ['a']).failures).toEqual([]);
  });

  it('accepts an embedded data-URI buffer', () => {
    const path = writeGltf({
      nodes: [{ name: 'a' }],
      buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }],
    });

    expect(checkGltfReferences(path, ['a']).failures).toEqual([]);
  });

  it('fails a glTF resource that points outside the pack', () => {
    const path = writeGltf({ nodes: [{ name: 'a' }], images: [{ uri: '..\\secret.png' }] });
    const result = checkGltfReferences(path, ['a']);

    expect(result.failures[0]).toMatch(/not a safe pack-relative path/);
  });

  it('fails a glTF that is not valid JSON', () => {
    const path = join(workDir, 'broken.gltf');
    writeFileSync(path, '{ nope');

    expect(checkGltfReferences(path, []).failures[0]).toMatch(/not valid JSON/);
  });

  it('reports a binary container as skipped rather than passing it silently', () => {
    const result = checkGltfReferences(join(workDir, 'model.glb'), ['anything']);

    expect(result.failures).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatch(/only \.gltf JSON is inspected/);
  });
});

describe('R12 — raw-u8 volumes declare every value they contain', () => {
  function writeVolume(values: number[]): string {
    const path = join(workDir, 'volume.raw');
    writeFileSync(path, Buffer.from(values));
    return path;
  }

  it('passes the shipped stub volume', () => {
    const result = checkRawVolume(join(stubDir, 'assets', 'stub-volume.raw'), [32, 32, 32], [1, 2]);
    expect(result.failures).toEqual([]);
  });

  it('fails a byte length that contradicts the declared resolution', () => {
    const path = writeVolume([0, 1, 2, 1]);
    expect(checkRawVolume(path, [2, 2, 2], [1, 2]).failures[0]).toMatch(/is 4 B; resolution 2x2x2/);
  });

  it('fails an undeclared voxel value', () => {
    const path = writeVolume([0, 1, 2, 7, 0, 0, 0, 0]);
    const result = checkRawVolume(path, [2, 2, 2], [1, 2]);

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/undeclared voxel values \[7\]/);
  });

  it('reserves value 0 for background and refuses a label claiming it', () => {
    const path = writeVolume([0, 1, 1, 1, 0, 0, 0, 0]);
    const result = checkRawVolume(path, [2, 2, 2], [0, 1]);

    expect(result.failures.some((failure) => /label id 0 is reserved/.test(failure))).toBe(true);
  });

  it('accepts a volume that is entirely background', () => {
    const path = writeVolume([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(checkRawVolume(path, [2, 2, 2], []).failures).toEqual([]);
  });

  it('fails a declared label that appears nowhere in the volume', () => {
    const path = writeVolume([0, 1, 1, 1, 0, 0, 0, 0]);
    const result = checkRawVolume(path, [2, 2, 2], [1, 5]);

    expect(result.failures.some((failure) => /declares \[5\]/.test(failure))).toBe(true);
  });
});

describe('R15 — placeholder attribution is caught at a token boundary', () => {
  it.each(['TBD', 'tbd', '  TODO  ', 'TBD - ask the vetter', 'TODO: licence', 'n/a', 'XXX_'])(
    'flags %j',
    (value) => {
      expect(isPlaceholder(value)).toBe(true);
    },
  );

  it.each([
    'Cardiology app project',
    'University research group',
    'CC BY-NC 4.0',
    'Nashville General Hospital',
    'Tabular data set',
    '',
  ])('does not flag legitimate attribution %j', (value) => {
    expect(isPlaceholder(value)).toBe(false);
  });
});
