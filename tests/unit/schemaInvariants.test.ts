/**
 * Adversarial coverage for the schema invariants hardened after the Wave 0 review.
 *
 * Every case here was ACCEPTED by the schema before that round — the labels R7
 * through R10 identify the repairs in the Git history.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AssetPath, IsoDate, assetPathProblem } from '../../src/schema/primitives.ts';
import { orientationProblem } from '../../src/schema/packV0.ts';
import { validatePack } from '../../src/schema/validate.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stubPath = join(repoRoot, 'public', 'packs', 'stub', 'pack.json');

function stubPack(): any {
  return JSON.parse(readFileSync(stubPath, 'utf8'));
}

function issuePathsAfter(mutate: (pack: any) => void): string[] {
  const pack = stubPack();
  mutate(pack);
  const result = validatePack(pack);
  expect(result.ok).toBe(false);
  return result.issues.map((issue) => issue.path);
}

describe('R7 — asset paths cannot escape the pack directory', () => {
  // Every one of these resolved outside the pack directory through the WHATWG
  // URL parser while the schema accepted them.
  const escapes = [
    '..\\outside.gltf',
    'a\\..\\..\\outside.gltf',
    '%2e%2e/outside.gltf',
    'a/%2e%2e/%2e%2e/outside.gltf',
    '%2E%2E/outside.gltf',
    '../outside.gltf',
    './assets/stub.gltf',
    '/assets/stub.gltf',
    'https://elsewhere.invalid/a.gltf',
    'C:\\assets\\stub.gltf',
    'assets/stub.gltf?v=2',
    'assets/stub.gltf#frag',
    'assets//stub.gltf',
    '',
  ];

  it.each(escapes)('rejects %j', (candidate) => {
    expect(AssetPath.safeParse(candidate).success).toBe(false);
    expect(assetPathProblem(candidate)).not.toBeNull();
  });

  const accepted = ['assets/stub.gltf', 'stub.gltf', 'a/b/c/stub-volume.raw', 'assets/with%20space.gltf'];

  it.each(accepted)('accepts the ordinary pack-relative path %j', (candidate) => {
    expect(assetPathProblem(candidate)).toBeNull();
    expect(AssetPath.safeParse(candidate).success).toBe(true);
  });

  it('rejects a traversing gltf reference inside a real pack', () => {
    expect(issuePathsAfter((pack) => {
      pack.meshes.gltf = '..\\..\\outside.gltf';
    })).toContain('meshes.gltf');
  });
});

describe('R8 — orientation must be a coherent frame', () => {
  it('accepts the shipped right-handed frame', () => {
    expect(
      orientationProblem({ up: '+y', anterior: '+z', patient_left: '+x', handedness: 'right' }),
    ).toBeNull();
  });

  it('accepts a left-handed frame that declares itself left-handed', () => {
    expect(
      orientationProblem({ up: '+y', anterior: '-z', patient_left: '+x', handedness: 'left' }),
    ).toBeNull();
  });

  it('rejects a frame naming one axis three times', () => {
    expect(issuePathsAfter((pack) => {
      pack.meshes.orientation = {
        up: '+y',
        anterior: '+y',
        patient_left: '+y',
        handedness: 'right',
      };
    })).toContain('meshes.orientation');
  });

  it('rejects two anatomical directions sharing an axis', () => {
    expect(
      orientationProblem({ up: '+y', anterior: '-y', patient_left: '+x', handedness: 'right' }),
    ).toMatch(/distinct axes/);
  });

  it('rejects a handedness the axis mapping contradicts', () => {
    expect(issuePathsAfter((pack) => {
      pack.meshes.orientation.handedness = 'left';
    })).toContain('meshes.orientation');
  });
});

describe('R9 — provenance dates must exist on the calendar', () => {
  it.each(['2026-13-45', '2026-02-30', '2026-00-10', '0000-00-00', '2025-02-29'])(
    'rejects %s',
    (candidate) => {
      expect(IsoDate.safeParse(candidate).success).toBe(false);
    },
  );

  it.each(['2026-08-16', '2024-02-29', '2026-12-31'])('accepts %s', (candidate) => {
    expect(IsoDate.safeParse(candidate).success).toBe(true);
  });

  it('rejects an impossible vetting date inside a real pack', () => {
    const paths = issuePathsAfter((pack) => {
      pack.provenance.vetted.status = 'vetted';
      pack.provenance.vetted.last_reviewed = '2026-02-30';
      pack.provenance.vetted.vetters = [{ role: 'fellow', date: '2026-02-30' }];
    });
    expect(paths).toContain('provenance.vetted.last_reviewed');
    expect(paths).toContain('provenance.vetted.vetters.0.date');
  });
});

describe('R10 — a camera state must describe a buildable camera', () => {
  it('rejects a position equal to its target', () => {
    expect(issuePathsAfter((pack) => {
      pack.interaction.camera.position = [0, 0, 0];
      pack.interaction.camera.target = [0, 0, 0];
    })).toContain('interaction.camera.target');
  });

  it('rejects an up vector parallel to the view direction', () => {
    expect(issuePathsAfter((pack) => {
      pack.interaction.camera.position = [0, 5, 0];
      pack.interaction.camera.target = [0, 0, 0];
      pack.interaction.camera.up = [0, 1, 0];
    })).toContain('interaction.camera.up');
  });

  it('still accepts the shipped camera', () => {
    expect(validatePack(stubPack()).ok).toBe(true);
  });
});
