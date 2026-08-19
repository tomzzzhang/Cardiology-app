/**
 * The gates, applied to the packs actually on disk.
 *
 * `packSchema.test.ts` pins what the SCHEMA rejects, by mutating a fixture.
 * This file pins what the REPOSITORY contains, because the six defects the
 * owner found last round were all found by opening the app rather than by a
 * test, and a rule that only ever meets a synthetic fixture never meets the
 * pack that breaks it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validatePack } from '../../src/schema/validate.ts';
import { topologyIsClean, type Pack } from '../../src/schema/packV0.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packsDir = join(repoRoot, 'public', 'packs');

function everyPack(): { id: string; pack: Pack }[] {
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const raw = JSON.parse(readFileSync(join(packsDir, entry.name, 'pack.json'), 'utf8'));
      const result = validatePack(raw);
      if (!result.ok) {
        throw new Error(
          `${entry.name} does not validate:\n` +
            result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'),
        );
      }
      return { id: entry.name, pack: result.pack };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

describe('every structure in the repository says how blood pool was decided', () => {
  for (const { id, pack } of everyPack()) {
    it(`${id}`, () => {
      for (const structure of pack.meshes.structures) {
        if (structure.mesh_node === null) continue; // a group has no surface
        expect(structure.blood_pool_decision, `${id}/${structure.id}`).toBeDefined();
        expect(structure.blood_pool_decision!.evidence.length).toBeGreaterThan(0);
      }
    });
  }

  it('the four BodyParts3D chamber casts and the three vessel stubs are lumen', () => {
    const pack = everyPack().find((entry) => entry.id === 'anatomy-bodyparts3d-heart')!.pack;
    const pools = pack.meshes.structures.filter((s) => s.blood_pool).map((s) => s.id).sort();
    expect(pools).toEqual([
      'ascending-aorta',
      'cavity-of-left-atrium',
      'cavity-of-left-ventricle',
      'cavity-of-right-atrium',
      'cavity-of-right-ventricle',
      'pulmonary-trunk',
      'superior-vena-cava',
    ]);
    for (const structure of pack.meshes.structures) {
      if (structure.blood_pool) expect(structure.blood_pool_decision!.basis).toBe('label_match');
    }
  });

  it('the shipped pack carries no lumen casts, and says so per structure', () => {
    const pack = everyPack().find((entry) => entry.id === 'normal-rodero')!.pack;
    expect(pack.meshes.structures.some((s) => s.blood_pool)).toBe(false);
    for (const structure of pack.meshes.structures) {
      expect(structure.blood_pool_decision!.basis).toBe('source_tag');
    }
  });
});

describe('every geometry-only pack measures its surfaces and declares the unclean ones', () => {
  const geometryOnly = everyPack().filter(({ pack }) => pack.echo_volume === undefined);

  it('there are geometry-only packs to check', () => {
    expect(geometryOnly.map(({ id }) => id)).toEqual([
      'anatomy-bodyparts3d-heart',
      'motion-biv-cinemri',
      'motion-straus-us-patient01',
      'normal-kit-four-chamber',
      'tof-cobivecox-chd0017001',
    ]);
  });

  for (const { id, pack } of geometryOnly) {
    it(`${id}`, () => {
      for (const structure of pack.meshes.structures) {
        if (structure.mesh_node === null) continue;
        const topology = structure.topology;
        expect(topology, `${id}/${structure.id} has no measurement`).toBeDefined();
        if (topologyIsClean(topology!)) {
          expect(topology!.declared_reason, `${id}/${structure.id}`).toBeUndefined();
        } else {
          expect(topology!.declared_reason?.length ?? 0).toBeGreaterThan(0);
        }
      }
    });
  }

  /*
   * The honest exception, named. CobivecoX's ventricles are genuinely truncated
   * at the base and its annuli are rings — open by construction, not by damage —
   * and the rule exists so that stays a written declaration rather than a silent
   * pass. All eight of its surfaces are open and all eight say why.
   */
  it('CobivecoX declares all eight of its open surfaces', () => {
    const pack = everyPack().find((entry) => entry.id === 'tof-cobivecox-chd0017001')!.pack;
    const declared = pack.meshes.structures.filter((s) => s.topology?.declared_reason);
    expect(declared).toHaveLength(8);
    for (const structure of declared) {
      expect(structure.topology!.declared_reason).toContain('OPEN BY CONSTRUCTION');
    }
  });

  it('STRAUS needs no declaration at all', () => {
    const pack = everyPack().find((entry) => entry.id === 'motion-straus-us-patient01')!.pack;
    for (const structure of pack.meshes.structures) {
      expect(topologyIsClean(structure.topology!)).toBe(true);
    }
  });
});

describe('the pack declares the hierarchy, and the engine is told nothing', () => {
  it('BodyParts3D groups its 86 parts by the source concept map', () => {
    const pack = everyPack().find((entry) => entry.id === 'anatomy-bodyparts3d-heart')!.pack;
    const groups = pack.meshes.structures.filter((s) => s.mesh_node === null);
    const leaves = pack.meshes.structures.filter((s) => s.mesh_node !== null);
    expect(leaves).toHaveLength(86);
    expect(groups.length).toBeGreaterThan(10);

    // The case the feature exists for: many sibling branches under one artery.
    const byId = new Map(pack.meshes.structures.map((s) => [s.id, s]));
    const coronary = groups.find((g) => g.display_label === 'left coronary artery');
    expect(coronary).toBeDefined();
    const descendants = leaves.filter((leaf) => {
      let cursor = leaf.parent;
      while (cursor) {
        if (cursor === coronary!.id) return true;
        cursor = byId.get(cursor)?.parent ?? null;
      }
      return false;
    });
    expect(descendants.length).toBeGreaterThan(15);
  });

  it('every other pack declares a flat list, and the engine must cope with that', () => {
    for (const { id, pack } of everyPack()) {
      if (id === 'anatomy-bodyparts3d-heart' || id === 'stub') continue;
      expect(pack.meshes.structures.every((s) => s.parent === null), id).toBe(true);
    }
  });
});
