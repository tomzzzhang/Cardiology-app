import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../../src/schema/packV0.ts';
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
