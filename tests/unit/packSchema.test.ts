import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LICENSE_STATES,
  SCHEMA_VERSION,
  hasKeyframes,
  isExploreOnly,
  mayBePublished,
} from '../../src/schema/packV0.ts';
import { validatePack } from '../../src/schema/validate.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stubPath = join(repoRoot, 'public', 'packs', 'stub', 'pack.json');

function stubPack(): Record<string, unknown> {
  return JSON.parse(readFileSync(stubPath, 'utf8')) as Record<string, unknown>;
}

/** Apply a mutation to a fresh copy of the stub pack and return the issue paths. */
function issuePathsAfter(mutate: (pack: any) => void): string[] {
  const pack = stubPack();
  mutate(pack);
  const result = validatePack(pack);
  expect(result.ok).toBe(false);
  return result.issues.map((issue) => issue.path);
}

describe('content pack schema v0', () => {
  it('accepts the shipped stub pack', () => {
    const result = validatePack(stubPack());
    if (!result.ok) {
      throw new Error(`stub pack should validate:\n${result.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`);
    }
    expect(result.pack.meta.schema_version).toBe(SCHEMA_VERSION);
    expect(result.pack.views.length).toBeGreaterThan(0);
  });

  it('rejects a pack declaring a different schema version', () => {
    expect(issuePathsAfter((pack) => {
      pack.meta.schema_version = '1';
    })).toContain('meta.schema_version');
  });

  it('rejects incomplete attribution', () => {
    expect(issuePathsAfter((pack) => {
      delete pack.provenance.license_url;
    })).toContain('provenance.license_url');
  });

  it('rejects a vetted item with no vetters or review date', () => {
    const paths = issuePathsAfter((pack) => {
      pack.provenance.vetted.status = 'vetted';
    });
    expect(paths).toContain('provenance.vetted.vetters');
    expect(paths).toContain('provenance.vetted.last_reviewed');
  });
});

describe('probe pose is the single source of truth', () => {
  it('rejects a non-unit beam axis rather than silently normalizing', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[0].probe.beam_axis = [0, 0, -2];
    })).toContain('views.0.probe.beam_axis');
  });

  it('rejects non-orthogonal beam and lateral axes', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[0].probe.lateral_axis = [0, 0, -1];
    })).toContain('views.0.probe.lateral_axis');
  });

  it('rejects a focus deeper than the fan', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[0].probe.fan.focus_cm = pack.views[0].probe.fan.depth_cm + 1;
    })).toContain('views.0.probe.fan.focus_cm');
  });
});

describe('free cutter / echo wedge separation (build_plan v1.2)', () => {
  it('accepts the free cutter as an interaction default', () => {
    const result = validatePack(stubPack());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.interaction?.free_cut?.offset).toBe(0);
    }
  });

  it('refuses to store a free cutter inside a clinical view', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[0].free_cut = { normal: [0, 0, 1], offset: 0 };
    }).join(' ')).toContain('views.0');
  });

  it('refuses a free cut plane whose normal is not unit length', () => {
    expect(issuePathsAfter((pack) => {
      pack.interaction.free_cut.normal = [0, 0, 3];
    })).toContain('interaction.free_cut.normal');
  });
});

describe('sweeps', () => {
  it('requires degrees for tilt and rotate sweeps', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[1].sweep.range.unit = 'mm';
    })).toContain('views.1.sweep.range.unit');
  });

  it('rejects an empty sweep range', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[1].sweep.range.to = pack.views[1].sweep.range.from;
    })).toContain('views.1.sweep.range');
  });

  it('rejects a swept structure that does not exist', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[1].sweep.structures_in_order = ['not-a-structure'];
    })).toContain('views.1.sweep.structures_in_order.0');
  });
});

describe('cross-references', () => {
  it('rejects an unknown structure in a view', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[0].structures.push('not-a-structure');
    })).toContain('views.0.structures.2');
  });

  it('rejects an unknown structure behind an echo label', () => {
    expect(issuePathsAfter((pack) => {
      pack.echo_volume.labels[0].structure = 'not-a-structure';
    })).toContain('echo_volume.labels.0.structure');
  });

  it('rejects a cycle in the structure hierarchy', () => {
    const paths = issuePathsAfter((pack) => {
      pack.meshes.structures[0].parent = 'stub-core';
    });
    expect(paths.some((path) => path.startsWith('meshes.structures.'))).toBe(true);
  });

  it('rejects duplicate view ids', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[1].view_id = pack.views[0].view_id;
    })).toContain('views.1.view_id');
  });

  it('rejects a structure that is both shown and hidden', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[0].show_hide_preset.hidden.push('stub-shell');
    })).toContain('views.0.show_hide_preset');
  });
});

describe('reserved slots', () => {
  it('requires real_clip_slot to stay empty in v0', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[0].real_clip_slot = { url: 'https://example.invalid/clip.mp4' };
    })).toContain('views.0.real_clip_slot');
  });

  it('tolerates a future volumetric data reference', () => {
    const pack = stubPack();
    (pack as any).volumetric_data = { kind: 'ct', asset: 'assets/future.nii.gz' };
    expect(validatePack(pack).ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* v0.1                                                                        */
/* -------------------------------------------------------------------------- */

describe('EXPLORE-ONLY packs (v0.1: echo_volume is optional)', () => {
  /**
   * The stub with its echo removed — meshes and nothing to image.
   *
   * A pack with no echo volume makes no clinical claim at all, so the only
   * thing it has to offer is its geometry and it has to have measured it. The
   * measurements here are the fixture's own; the real packs are measured by the
   * ingest and checked against this same rule in `packAssets.test.ts`.
   */
  function exploreOnlyStub(): any {
    const pack = stubPack() as any;
    delete pack.echo_volume;
    pack.views = [];
    for (const structure of pack.meshes.structures) {
      structure.topology = {
        watertight: true,
        components: 1,
        boundary_edges: 0,
        nonmanifold_edges: 0,
      };
    }
    return pack;
  }

  it('accepts a pack with meshes and no echo volume', () => {
    const result = validatePack(exploreOnlyStub());
    if (!result.ok) {
      throw new Error(
        `explore-only pack should validate:\n${result.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`,
      );
    }
    expect(isExploreOnly(result.pack)).toBe(true);
    expect(result.pack.echo_volume).toBeUndefined();
  });

  it('reports an echo-capable pack as not explore-only', () => {
    const result = validatePack(stubPack());
    expect(result.ok).toBe(true);
    if (result.ok) expect(isExploreOnly(result.pack)).toBe(false);
  });

  it('rejects views on a pack with nothing to image', () => {
    expect(issuePathsAfter((pack) => {
      delete pack.echo_volume;
    })).toContain('views');
  });

  it('rejects an echo volume with no view to image from', () => {
    expect(issuePathsAfter((pack) => {
      pack.views = [];
    })).toContain('views');
  });
});

describe('licence state (v0.1: required, and it gates publication)', () => {
  it('rejects a pack that declares no licence state', () => {
    expect(issuePathsAfter((pack) => {
      delete pack.provenance.license_state;
    })).toContain('provenance.license_state');
  });

  it('rejects an empty or unknown licence state rather than coercing it', () => {
    expect(issuePathsAfter((pack) => {
      pack.provenance.license_state = '';
    })).toContain('provenance.license_state');
    expect(issuePathsAfter((pack) => {
      pack.provenance.license_state = 'probably-fine';
    })).toContain('provenance.license_state');
  });

  it('refuses a view whose licence state contradicts the pack', () => {
    expect(issuePathsAfter((pack) => {
      pack.views[0].provenance.license_state = 'unconfirmed';
    })).toContain('views.0.provenance.license_state');
  });

  it('lets only a confirmed licence be published', () => {
    expect(LICENSE_STATES.filter(mayBePublished)).toEqual(['confirmed']);
  });
});

describe('keyframed geometry (v0.1: motion, whole meshes only)', () => {
  /** A minimal two-frame block hung on the stub's own glTF. */
  function withKeyframes(pack: any, overrides: Record<string, unknown> = {}): any {
    pack.meshes.keyframes = {
      frames: [
        { gltf: pack.meshes.gltf, label: 'frame-000', phase: 0 },
        { gltf: 'assets/frame-001.gltf', label: 'frame-001', phase: 0.5 },
      ],
      loop: false,
      vertex_correspondence: false,
      coverage: 'end-diastole to end-systole, half a cycle',
      ...overrides,
    };
    return pack;
  }

  it('accepts whole-mesh frames on a normalised phase axis', () => {
    const result = validatePack(withKeyframes(stubPack()));
    if (!result.ok) {
      throw new Error(
        `keyframed pack should validate:\n${result.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}`,
      );
    }
    expect(hasKeyframes(result.pack)).toBe(true);
    expect(hasKeyframes(validatePack(stubPack()).pack!)).toBe(false);
  });

  it('accepts a frame rate in place of a phase axis', () => {
    const pack = withKeyframes(stubPack(), { fps: 30 });
    for (const frame of pack.meshes.keyframes.frames) delete frame.phase;
    expect(validatePack(pack).ok).toBe(true);
  });

  it('refuses frames with no time axis at all', () => {
    expect(issuePathsAfter((pack) => {
      withKeyframes(pack);
      for (const frame of pack.meshes.keyframes.frames) delete frame.phase;
    })).toContain('meshes.keyframes.fps');
  });

  it('refuses a phase axis that does not increase', () => {
    expect(issuePathsAfter((pack) => {
      withKeyframes(pack);
      pack.meshes.keyframes.frames[1].phase = 0;
    })).toContain('meshes.keyframes.frames.1.phase');
  });

  it('refuses duplicate frame labels', () => {
    expect(issuePathsAfter((pack) => {
      withKeyframes(pack);
      pack.meshes.keyframes.frames[1].label = 'frame-000';
    })).toContain('meshes.keyframes.frames.1.label');
  });

  it('refuses a first frame that is not the pack\'s static mesh', () => {
    expect(issuePathsAfter((pack) => {
      withKeyframes(pack);
      pack.meshes.keyframes.frames[0].gltf = 'assets/frame-000.gltf';
    })).toContain('meshes.keyframes.frames.0.gltf');
  });

  it('refuses a single frame, which is not motion', () => {
    expect(issuePathsAfter((pack) => {
      withKeyframes(pack);
      pack.meshes.keyframes.frames = [pack.meshes.keyframes.frames[0]];
    })).toContain('meshes.keyframes.frames');
  });
});

/* -------------------------------------------------------------------------- */
/* the gates that last round's defects had no check for                        */
/* -------------------------------------------------------------------------- */

/**
 * BLOOD POOL IS DECIDED, NEVER DEFAULTED.
 *
 * `pipeline/geometry.py` hardcoded `blood_pool: False` for every structure it
 * emitted, so BodyParts3D's four solid chamber casts — 98 mL and 117 mL of
 * geometry — rendered as tissue and the cut read as a filled cavity
 * (`docs/observations.md` entries 31 and 32). Every gate was green through it,
 * because a boolean cannot tell a decision apart from a default.
 */
describe('blood pool is decided, never defaulted', () => {
  it('rejects a structure that does not say how it was decided', () => {
    expect(issuePathsAfter((pack) => {
      delete pack.meshes.structures[1].blood_pool_decision;
    })).toContain('meshes.structures.1.blood_pool_decision');
  });

  it('rejects a determination with no evidence behind it', () => {
    expect(issuePathsAfter((pack) => {
      pack.meshes.structures[1].blood_pool_decision.evidence = '';
    })).toContain('meshes.structures.1.blood_pool_decision.evidence');
  });

  it('rejects a basis the schema does not know', () => {
    expect(issuePathsAfter((pack) => {
      pack.meshes.structures[1].blood_pool_decision.basis = 'probably';
    })).toContain('meshes.structures.1.blood_pool_decision.basis');
  });

  it('rejects a label match that did not set the flag', () => {
    expect(issuePathsAfter((pack) => {
      pack.meshes.structures[1].blood_pool_decision.basis = 'label_match';
      pack.meshes.structures[1].blood_pool = false;
    })).toContain('meshes.structures.1.blood_pool');
  });

  it('rejects a flag set where nothing matched', () => {
    expect(issuePathsAfter((pack) => {
      pack.meshes.structures[0].blood_pool_decision.basis = 'label_no_match';
      pack.meshes.structures[0].blood_pool = true;
    })).toContain('meshes.structures.0.blood_pool');
  });
});

/**
 * WATERTIGHTNESS IS DECLARED, NEVER DISCOVERED BY A LEARNER.
 *
 * A surface that is not manifold, closed and single-component caps wrongly at
 * the free cutter and can read as several objects. CobivecoX is the honest
 * exception — truncated ventricles, annuli that really are rings — and the
 * point of the rule is that its exception is written down and a silent one is
 * not possible.
 */
describe('watertightness is declared or absent', () => {
  /** The stub with its echo removed, so the geometry-only rule applies. */
  function geometryOnly(topology: unknown): any {
    const pack = stubPack() as any;
    delete pack.echo_volume;
    pack.views = [];
    for (const structure of pack.meshes.structures) structure.topology = topology;
    return pack;
  }

  const clean = { watertight: true, components: 1, boundary_edges: 0, nonmanifold_edges: 0 };

  it('accepts a clean surface with no declaration', () => {
    expect(validatePack(geometryOnly({ ...clean })).ok).toBe(true);
  });

  it('rejects an open surface that the pack does not explain', () => {
    const result = validatePack(geometryOnly({ ...clean, watertight: false, boundary_edges: 312 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path))
        .toContain('meshes.structures.0.topology.declared_reason');
    }
  });

  it('rejects a multi-component surface that the pack does not explain', () => {
    const result = validatePack(geometryOnly({ ...clean, components: 11 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-manifold surface that the pack does not explain', () => {
    const result = validatePack(geometryOnly({ ...clean, nonmanifold_edges: 10 }));
    expect(result.ok).toBe(false);
  });

  it('accepts an open surface the pack declares', () => {
    const result = validatePack(geometryOnly({
      ...clean,
      watertight: false,
      boundary_edges: 312,
      declared_reason: 'truncated at the base; closing it would invent a base plane',
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects a declaration that has outlived its defect', () => {
    const result = validatePack(geometryOnly({ ...clean, declared_reason: 'was open once' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a geometry-only pack that never measured itself', () => {
    const pack = stubPack() as any;
    delete pack.echo_volume;
    pack.views = [];
    const result = validatePack(pack);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path)).toContain('meshes.structures.0.topology');
    }
  });
});

/**
 * GROUPS COME FROM THE PACK.
 *
 * A group is a name in the source's own hierarchy with no geometry of its own —
 * "left coronary artery" over its ten branches. The engine renders whatever
 * tree a pack declares and enumerates no anatomy of its own.
 */
describe('structure groups', () => {
  /** Wrap both stub structures under one group with no mesh. */
  function grouped(pack: any): void {
    pack.meshes.structures.unshift({
      id: 'stub-assembly',
      mesh_node: null,
      display_label: 'Stub assembly',
      parent: null,
      blood_pool: false,
      stylized: false,
    });
    pack.meshes.structures[1].parent = 'stub-assembly';
  }

  it('accepts a group with no mesh over its children', () => {
    const pack = stubPack() as any;
    grouped(pack);
    const result = validatePack(pack);
    if (!result.ok) {
      throw new Error(result.issues.map((i) => `${i.path}: ${i.message}`).join('\n'));
    }
  });

  it('rejects a group that expands into nothing', () => {
    expect(issuePathsAfter((pack) => {
      grouped(pack);
      pack.meshes.structures[1].parent = null;
    })).toContain('meshes.structures.0.mesh_node');
  });

  it('rejects a group carrying geometry state it cannot have', () => {
    expect(issuePathsAfter((pack) => {
      grouped(pack);
      pack.meshes.structures[0].blood_pool = true;
    })).toContain('meshes.structures.0.mesh_node');
  });
});
