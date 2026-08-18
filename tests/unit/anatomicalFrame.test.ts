/**
 * `meshes.anatomical_frame` — the evidence behind a pack's declared orientation.
 *
 * The block exists because declaring an orientation is cheap and says nothing
 * about whether the declaration is true. An earlier pipeline derived "superior"
 * from the ventricular centroid to the aortic-wall centroid and produced a
 * frame in which the inferior vena cava sits SUPERIOR to the valve plane; the
 * `orientation` block it wrote was byte-identical to a correct one.
 *
 * So these tests pin the two things that make the record worth having: a basis
 * that is genuinely a right-handed orthonormal frame, and a summary that cannot
 * quietly disagree with the checks it summarises.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AnatomicalFrame } from '../../src/schema/packV0.ts';
import { validatePack } from '../../src/schema/validate.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function packJson(id: string) {
  return JSON.parse(readFileSync(join(repoRoot, 'public', 'packs', id, 'pack.json'), 'utf8'));
}

/** A minimal valid record, as a base for the negative cases below. */
function record(): {
  method: string;
  description: string;
  inputs: Record<string, unknown>;
  landmarks_source_mm: Record<string, unknown>;
  basis_source_to_pack: { patient_left: number[]; basal: number[]; anterior: number[] };
  measurements: Record<string, unknown>;
  checks: Record<string, boolean>;
  checks_passed: number;
  checks_total: number;
  valve_identification?: Record<string, unknown>;
} {
  return {
    method: 'cardiac-landmarks-v1',
    description: 'derived from landmarks',
    inputs: { apex: { tag: 1 } },
    landmarks_source_mm: { apex: [0, 0, 0] },
    basis_source_to_pack: {
      patient_left: [1, 0, 0],
      basal: [0, 1, 0],
      anterior: [0, 0, 1],
    },
    measurements: { long_axis_mm: 86.68 },
    checks: { 'apex apical to every valve ring': true, 'mitral valve left of tricuspid valve': true },
    checks_passed: 2,
    checks_total: 2,
  };
}

describe('AnatomicalFrame', () => {
  it('accepts a right-handed orthonormal basis with a consistent summary', () => {
    expect(AnatomicalFrame.safeParse(record()).success).toBe(true);
  });

  it('rejects a left-handed basis', () => {
    /*
     * The failure this guards against is silent: a mirrored frame places
     * right-sided structures on the left, and every view derived from it looks
     * entirely plausible while being anatomically reversed.
     */
    const mirrored = record();
    mirrored.basis_source_to_pack.anterior = [0, 0, -1];
    const result = AnatomicalFrame.safeParse(mirrored);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('right-handed');
  });

  it('rejects a basis whose axes are not orthogonal', () => {
    const skewed = record();
    skewed.basis_source_to_pack.basal = [0.7071, 0.7071, 0];
    expect(AnatomicalFrame.safeParse(skewed).success).toBe(false);
  });

  it('rejects a summary that overstates the checks', () => {
    const flattering = record();
    flattering.checks['superior vena cava basal to the valve plane'] = false;
    flattering.checks_total = 3;
    flattering.checks_passed = 3; // the lie
    const result = AnatomicalFrame.safeParse(flattering);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('disagree with checks');
  });

  it('records a failing check rather than forbidding it', () => {
    // A frame that fails a check must be publishable-and-visible, not
    // unrepresentable: hiding the failure is the outcome this block prevents.
    const honest = record();
    honest.checks['superior vena cava basal to the valve plane'] = false;
    honest.checks_total = 3;
    honest.checks_passed = 2;
    expect(AnatomicalFrame.safeParse(honest).success).toBe(true);
  });

  it('is optional, so a source that cannot derive a frame omits it', () => {
    const pack = packJson('stub');
    expect(pack.meshes.anatomical_frame).toBeUndefined();
    expect(validatePack(pack).ok).toBe(true);
  });
});

describe('the shipped Rodero frame', () => {
  const frame = packJson('normal-rodero').meshes.anatomical_frame;

  it('is present and passes every check it records', () => {
    expect(frame).toBeDefined();
    expect(frame.checks_total).toBeGreaterThanOrEqual(9);
    expect(frame.checks_passed).toBe(frame.checks_total);
  });

  it('measures a long axis of a plausible adult length', () => {
    // A population-average adult four-chamber mesh. A value far outside this
    // band means the apex or the valve plane has been located wrongly, which
    // is the failure the whole derivation exists to avoid.
    expect(frame.measurements.long_axis_mm).toBeGreaterThan(60);
    expect(frame.measurements.long_axis_mm).toBeLessThan(110);
  });

  it('corroborates the long axis against an independently fitted base plane', () => {
    // The apex comes from the universal ventricular coordinates and the base
    // plane from the valve-ring centroids — different evidence. Their agreeing
    // is the check; a large angle means one of the two is wrong.
    expect(frame.measurements.base_normal_vs_long_axis_deg).toBeLessThan(15);
  });

  it('does not claim a body frame it cannot derive', () => {
    expect(frame.description.toLowerCase()).toContain('cardiac');
    expect(frame.description.toLowerCase()).toContain('no body frame is claimed');
    expect(frame.basis_source_to_pack.basal).toHaveLength(3);
  });
});

describe('valve identification by face adjacency', () => {
  const frame = packJson('normal-rodero').meshes.anatomical_frame;
  const valves = frame.valve_identification;

  /**
   * The published Rodero/CEMRG mapping, and the chamber pair that DEFINES each
   * valve. The pair is the anatomy; the tag is the convention being checked.
   */
  const PUBLISHED: Record<string, { tag: number; borders: [string, string] }> = {
    mitral: { tag: 7, borders: ['lv', 'la'] },
    tricuspid: { tag: 8, borders: ['rv', 'ra'] },
    aortic: { tag: 9, borders: ['lv', 'aorta'] },
    pulmonary: { tag: 10, borders: ['rv', 'pa'] },
  };

  it('is shipped, so a reader holding only the pack can re-run it', () => {
    expect(valves).toBeDefined();
    expect(valves.method).toBe('tag-face-adjacency-v1');
    expect(Object.keys(valves.valves).sort()).toEqual(Object.keys(PUBLISHED).sort());
  });

  it('agrees with the published Rodero mapping', () => {
    /*
     * The gate. Disagreement means the mesh is Strocchi-tagged or re-exported
     * under another convention, and every number derived from the rings — the
     * base plane, the long axis, the four-chamber pose — is wrong in a way that
     * still looks plausible.
     */
    expect(valves.agrees_with_published).toBe(true);
    for (const [name, expected] of Object.entries(PUBLISHED)) {
      expect(valves.valves[name].tag).toBe(expected.tag);
      expect(valves.published_tags[name]).toBe(expected.tag);
    }
  });

  it('identifies each valve by the two chambers it separates', () => {
    for (const [name, expected] of Object.entries(PUBLISHED)) {
      const borders = valves.valves[name].borders;
      const tags = expected.borders.map((chamber) => String(valves.chamber_tags[chamber]));
      expect(Object.keys(borders).sort()).toEqual([...tags].sort());
      // Every border is a real shared surface, not a graze at a seam.
      for (const shared of Object.values(borders)) {
        expect(shared as number).toBeGreaterThan(20);
      }
    }
  });

  it('names the four ring landmarks by valve rather than by tag number', () => {
    // A landmark keyed by a bare tag is only readable next to the tag table it
    // came from; keyed by valve it survives on its own.
    expect(Object.keys(frame.landmarks_source_mm.valve_rings).sort())
      .toEqual(Object.keys(PUBLISHED).sort());
  });

  it('rejects a record whose valve borders three chambers', () => {
    const impossible = record();
    impossible.valve_identification = {
      method: 'tag-face-adjacency-v1',
      description: 'test',
      chamber_tags: { lv: 1, la: 3, ra: 4 },
      valves: { mitral: { tag: 7, borders: { '1': 766, '3': 893, '4': 12 } } },
      published_tags: { mitral: 7 },
      agrees_with_published: true,
    };
    const result = AnatomicalFrame.safeParse(impossible);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('exactly two chambers');
  });

  it('rejects a record that claims agreement it does not have', () => {
    const lying = record();
    lying.valve_identification = {
      method: 'tag-face-adjacency-v1',
      description: 'test',
      chamber_tags: { lv: 1, la: 3 },
      valves: { mitral: { tag: 12, borders: { '1': 766, '3': 893 } } },
      published_tags: { mitral: 7 },
      agrees_with_published: true, // the lie
    };
    const result = AnatomicalFrame.safeParse(lying);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('agrees_with_published');
  });
});

describe('the derived apical four-chamber view', () => {
  const pack = packJson('normal-rodero');
  const view = pack.views[0];

  it('leads the pack, replacing the ingest reference pose as the default', () => {
    expect(view.view_id).toBe('b1-apical-four-chamber');
    expect(view.family).toBe('B');
  });

  it('is draft-flagged, because nothing clinical has reviewed it', () => {
    expect(view.provenance.vetted.status).toBe('draft');
    expect(view.provenance.vetted.vetters).toHaveLength(0);
    expect(view.name.toLowerCase()).toContain('draft');
  });

  it('ships a scrubbable sweep', () => {
    // contracts/view-rail-sweep-scrubber.md: a family with no sweep anywhere is
    // a content gap. This is family B's.
    expect(view.sweep).toBeDefined();
    expect(view.sweep.range.from).toBeLessThan(view.sweep.range.to);
  });

  it('claims no structure ordering, which is a clinical reading', () => {
    expect(view.sweep.structures_in_order).toEqual([]);
  });

  it('places its imaging plane through the apex and both AV valve rings', () => {
    /*
     * The defining property of the view, and the one an earlier revision got
     * wrong: it built the beam along the long axis and left the plane 12
     * degrees off, missing both rings by about 17 mm. Re-checked here from the
     * shipped numbers rather than trusted from the pipeline that wrote them.
     */
    const { origin, beam_axis: beam, lateral_axis: lateral } = view.probe;
    const normal = [
      beam[1] * lateral[2] - beam[2] * lateral[1],
      beam[2] * lateral[0] - beam[0] * lateral[2],
      beam[0] * lateral[1] - beam[1] * lateral[0],
    ];

    const frame = pack.meshes.anatomical_frame;
    const rotate = (v: number[]) => {
      const { patient_left: l, basal: b, anterior: a } = frame.basis_source_to_pack;
      return [
        l[0] * v[0] + l[1] * v[1] + l[2] * v[2],
        b[0] * v[0] + b[1] * v[1] + b[2] * v[2],
        a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
      ];
    };
    const offPlane = (point: number[]) => {
      const p = rotate(point);
      const d = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
      return Math.abs(d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2]);
    };

    const rings = frame.landmarks_source_mm.valve_rings;
    // Named by face adjacency, not by position — see the suite below.
    expect(offPlane(rings.mitral)).toBeLessThan(6);
    expect(offPlane(rings.tricuspid)).toBeLessThan(6);
    expect(offPlane(frame.landmarks_source_mm.apex)).toBeLessThan(6);
  });

  it('renders vertex-down, per the paediatric convention for family B', () => {
    expect(view.probe.display.vertex).toBe('down');
    expect(pack.display_flags.pediatric_vertex_convention).toBe(true);
  });
});
