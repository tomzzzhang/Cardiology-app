/**
 * Export-to-pack is a destructive boundary, so refusal is the default and the
 * write-side receives only a fully validated candidate.
 */
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/authoring/exportFile.ts';
import type { SavedSlot } from '../../src/authoring/slots.ts';
import type { Pack, ProbePose } from '../../src/schema/packV0.ts';
import { validatePack } from '../../src/schema/validate.ts';
import {
  AuthoringSlotsExport,
  prepareAuthoringIngest,
  transportSweep,
} from '../../scripts/lib/authoringIngest.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stubPath = join(repoRoot, 'public', 'packs', 'stub', 'pack.json');
const roderoPath = join(repoRoot, 'public', 'packs', 'normal-rodero', 'pack.json');
const roderoExportPath = join(
  repoRoot,
  'tests',
  'fixtures',
  'authoring',
  'normal-rodero-ingest-reference-pose.authoring-slots-v1.json',
);
const roderoBeforePath = join(
  repoRoot,
  'tests',
  'fixtures',
  'authoring',
  'normal-rodero-ingest-reference-pose.before.json',
);
const cliPath = join(repoRoot, 'scripts', 'ingest-authoring-export.ts');
const tsxPath = join(repoRoot, 'node_modules', '.bin', 'tsx');
const SAVED_AT = '2026-08-20T18:00:00.000Z';
const EXPORTED_AT = '2026-08-20T18:05:00.000Z';
const SLOT_ID = 'view-stub-sweep';
const VIEW_ID = 'stub-sweep';

function stubPack(): Pack {
  const result = validatePack(JSON.parse(readFileSync(stubPath, 'utf8')));
  if (!result.ok) throw new Error('the checked-in stub pack must validate');
  return structuredClone(result.pack);
}

function pose(over: Partial<ProbePose> = {}): ProbePose {
  return {
    origin: [10, 20, 30],
    beam_axis: [1, 0, 0],
    lateral_axis: [0, 1, 0],
    fan: { angle_deg: 75, depth_cm: 12, focus_cm: 6 },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
    ...over,
  } as ProbePose;
}

function authoringExport(probe = pose()) {
  const slot: SavedSlot = {
    packId: 'stub',
    packVersion: '0.1.0',
    slotId: SLOT_ID,
    kind: 'extra',
    label: 'Stub sweep placement',
    pose: structuredClone(probe),
    savedAt: SAVED_AT,
  };
  /*
   * A LEGACY document: the shape exports had before 2026-08-21, when saving an
   * apical four-chamber also wrote the axes its beam implied.
   *
   * `buildExport` no longer emits `cardiac_frame` and has no parameter for it,
   * so it is attached here by hand. That is the point of the fixture: files in
   * this shape exist on disks, the ingest still has to read their poses, and it
   * still has to throw the axis claim away. Building it through the current
   * exporter would test nothing, because the current exporter cannot produce it.
   */
  return {
    ...buildExport({
      packId: 'stub',
      packVersion: '0.1.0',
      packSchemaVersion: '0.1',
      slots: [slot],
      exportedAt: EXPORTED_AT,
    }),
    cardiac_frame: {
      derived_from_slot: SLOT_ID,
      method: 'test-only derived frame that ingestion must ignore',
      patient_left: [1, 0, 0],
      basal: [0, 1, 0],
      anterior: [0, 0, 1],
      flipped_for_display: false,
    },
  };
}

function prepare(pack = stubPack(), document: unknown = authoringExport()) {
  return prepareAuthoringIngest({
    pack,
    authoringExport: document,
    slotId: SLOT_ID,
    viewId: VIEW_ID,
    nextPackVersion: '0.1.1',
  });
}

describe('one explicit slot into one explicit existing view', () => {
  it('changes only the selected placement, its dependent sweep/provenance, and pack version', () => {
    const original = stubPack();
    const untouchedInput = structuredClone(original);
    const oldTarget = structuredClone(original.views.find((view) => view.view_id === VIEW_ID)!);
    const otherView = structuredClone(original.views.find((view) => view.view_id !== VIEW_ID)!);
    const result = prepare(original);
    const target = result.candidate.views.find((view) => view.view_id === VIEW_ID)!;

    expect(original).toEqual(untouchedInput); // preparation itself is pure
    expect(result.candidate.meta.pack_version).toBe('0.1.1');
    expect(target.probe).toEqual(pose());
    expect(target.placement_landmark).toContain('authoring-slots/v1');
    expect(target.placement_landmark).toContain(SLOT_ID);
    expect(target.provenance.vetted).toEqual(oldTarget.provenance.vetted);
    expect(target.provenance.vetted.status).toBe('draft');
    expect(target.provenance.modified.flag).toBe(true);
    expect(target.provenance.modified.note).toContain('authoring-slots/v1');
    expect(target.provenance.modified.note).toContain(SLOT_ID);
    expect(target.provenance.derivation_chain.at(-1)).toContain(SLOT_ID);
    expect(result.candidate.views.find((view) => view.view_id !== VIEW_ID)).toEqual(otherView);
    expect(result.candidate.provenance).toEqual(original.provenance);
    expect(result.candidate.meshes).toEqual(original.meshes);
    expect(result.candidate.echo_volume).toEqual(original.echo_volume);
    expect(result.summary.cardiacFrameIgnored).toBe(true);
    expect(result.summary.toPackVersion).toBe('0.1.1');
    expect(result.summary.sourcePackVersion).toBe('0.1.0');
    expect(result.summary.reviewStatus).toBe('draft');
    expect(result.summary.probeAfter).toEqual(pose());

    const oldRest = structuredClone(oldTarget) as unknown as Record<string, unknown>;
    const newRest = structuredClone(target) as unknown as Record<string, unknown>;
    for (const key of ['placement_landmark', 'probe', 'sweep', 'provenance']) {
      delete oldRest[key];
      delete newRest[key];
    }
    expect(newRest).toEqual(oldRest);
  });

  it('reads a legacy cardiac_frame without letting it touch meshes.anatomical_frame', () => {
    const original = stubPack();
    const result = prepare(original, authoringExport());
    expect(result.candidate.meshes.anatomical_frame).toEqual(original.meshes.anatomical_frame);
  });

  it('replaces an obsolete pose note, keeps its history in the chain, and remains draft', () => {
    const pack = stubPack();
    const target = pack.views.find((view) => view.view_id === VIEW_ID)!;
    const obsolete = 'Current pose was generated by pipeline/ingest.py; this becomes false.';
    target.provenance.modified.note = obsolete;
    const history = structuredClone(target.provenance.derivation_chain);
    const result = prepare(pack);
    const updated = result.candidate.views.find((view) => view.view_id === VIEW_ID)!;

    expect(updated.provenance.modified.note).not.toContain(obsolete);
    expect(updated.provenance.modified.note).toContain('Current probe pose came from');
    expect(updated.provenance.modified.note).toContain('authoring-slots/v1');
    expect(updated.provenance.modified.note).toContain(SAVED_AT);
    expect(updated.provenance.modified.note).toContain(EXPORTED_AT);
    expect(updated.provenance.modified.note)
      .toContain('Status remains Draft; ingestion did not promote review state');
    expect(updated.provenance.modified.note).toContain('rigidly transported');
    expect(updated.provenance.modified.note).toContain('structures_in_order was cleared');
    expect(updated.provenance.derivation_chain.slice(0, history.length)).toEqual(history);
    expect(updated.provenance.vetted.status).toBe('draft');
  });

  it('refuses to replace a reviewed pose while preserving draft as the authoring boundary', () => {
    const pack = stubPack();
    const target = pack.views.find((view) => view.view_id === VIEW_ID)!;
    target.provenance.vetted = {
      status: 'vetted',
      vetters: [{ role: 'fellow', date: '2026-08-20' }],
      last_reviewed: '2026-08-20',
    };
    expect(() => prepare(pack)).toThrow(/may replace only a draft pose/);
  });

  it('refuses a draft that carries review history rather than silently invalidating it', () => {
    const pack = stubPack();
    const target = pack.views.find((view) => view.view_id === VIEW_ID)!;
    target.provenance.vetted = {
      status: 'draft',
      vetters: [{ role: 'fellow', date: '2026-08-20' }],
      last_reviewed: '2026-08-20',
    };
    expect(() => prepare(pack)).toThrow(/recorded review history/);
  });
});

describe('a sweep follows the old probe frame rigidly', () => {
  it('transports direction as a vector, explicit origin as a point, and clears measurements', () => {
    const pack = stubPack();
    const target = pack.views.find((view) => view.view_id === VIEW_ID)!;
    target.probe = pose({
      origin: [1, 2, 3],
      beam_axis: [0, 1, 0],
      lateral_axis: [1, 0, 0],
    });
    target.sweep!.axis = { direction: [1, 0, 0], origin: [4, 4, -1] };
    const result = prepare(pack);
    const sweep = result.candidate.views.find((view) => view.view_id === VIEW_ID)!.sweep!;

    expect(sweep.axis.direction).toEqual([0, 1, 0]);
    expect(sweep.axis.origin).toEqual([12, 23, 34]);
    expect(sweep.structures_in_order).toEqual([]);
    expect(result.summary.sweepAxisTransported).toBe(true);
    expect(result.summary.structuresCleared).toBeGreaterThan(0);
  });

  it('keeps an implicit axis origin implicit, now through the new probe origin', () => {
    const pack = stubPack();
    const target = pack.views.find((view) => view.view_id === VIEW_ID)!;
    const transported = transportSweep(target.sweep!, target.probe, pose());
    expect(transported.axis.origin).toBeUndefined();
    expect(transported.structures_in_order).toEqual([]);
  });
});

describe('fail-closed identity and envelope checks', () => {
  it('refuses another pack, source pack revision, and pack schema', () => {
    const otherPack = { ...authoringExport(), pack_id: 'not-stub' };
    expect(() => prepare(stubPack(), otherPack)).toThrow(/does not equal target pack/);

    const otherSchema = { ...authoringExport(), pack_schema_version: '0.2' };
    expect(() => prepare(stubPack(), otherSchema)).toThrow(/pack_schema_version/);

    const otherVersion = { ...authoringExport(), pack_version: '0.0.9' };
    expect(() => prepare(stubPack(), otherVersion)).toThrow(/does not equal target pack version/);
  });

  it('refuses unknown fields in the root and nested slot', () => {
    expect(() => prepare(stubPack(), { ...authoringExport(), stowaway: true }))
      .toThrow(/Unrecognized key/);
    const nested = authoringExport() as any;
    nested.slots[0].stowaway = true;
    expect(() => prepare(stubPack(), nested)).toThrow(/Unrecognized key/);
  });

  it('refuses duplicate or absent selected slots and absent views', () => {
    const duplicate = authoringExport();
    duplicate.slots.push(structuredClone(duplicate.slots[0]));
    expect(() => prepare(stubPack(), duplicate)).toThrow(/duplicate slot_id/);

    expect(() => prepareAuthoringIngest({
      pack: stubPack(),
      authoringExport: authoringExport(),
      slotId: 'not-there',
      viewId: VIEW_ID,
      nextPackVersion: '0.1.1',
    })).toThrow(/occurs 0 times/);

    expect(() => prepareAuthoringIngest({
      pack: stubPack(),
      authoringExport: authoringExport(),
      slotId: SLOT_ID,
      viewId: 'not-there',
      nextPackVersion: '0.1.1',
    })).toThrow(/existing view/);
  });

  it('cross-checks the standard slot identity instead of allowing arbitrary remapping', () => {
    const document = authoringExport();
    document.slots[0].slot_id = 'custom-1';
    document.slots[0].kind = 'custom';
    expect(() => prepareAuthoringIngest({
      pack: stubPack(),
      authoringExport: document,
      slotId: 'custom-1',
      viewId: VIEW_ID,
      nextPackVersion: '0.1.1',
    })).toThrow(/Arbitrary slot-to-view remapping is not supported/);
  });

  it('requires an explicit changed pack version and validates the original pack first', () => {
    expect(() => prepareAuthoringIngest({
      pack: stubPack(),
      authoringExport: authoringExport(),
      slotId: SLOT_ID,
      viewId: VIEW_ID,
      nextPackVersion: '',
    })).toThrow(/supplied explicitly/);

    const pack = stubPack();
    expect(() => prepareAuthoringIngest({
      pack,
      authoringExport: authoringExport(),
      slotId: SLOT_ID,
      viewId: VIEW_ID,
      nextPackVersion: pack.meta.pack_version,
    })).toThrow(/requires an explicit version change/);

    expect(() => prepareAuthoringIngest({
      pack: stubPack(),
      authoringExport: authoringExport(),
      slotId: SLOT_ID,
      viewId: VIEW_ID,
      nextPackVersion: ' 0.1.1',
    })).toThrow(/leading or trailing whitespace/);

    const invalid = { ...stubPack(), stowaway: true };
    expect(() => prepare(invalid)).toThrow(/target pack is invalid before ingest/);
  });
});

describe('CLI write gate', () => {
  it('previews by default and changes the file only with explicit --write', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cardiology-authoring-ingest-'));
    try {
      const packPath = join(directory, 'pack.json');
      const exportPath = join(directory, 'slots.json');
      writeFileSync(packPath, `${JSON.stringify(stubPack(), null, 2)}\n`);
      writeFileSync(exportPath, `${JSON.stringify(authoringExport(), null, 2)}\n`);
      const before = readFileSync(packPath, 'utf8');
      const arguments_ = [
        cliPath,
        '--export', exportPath,
        '--pack', packPath,
        '--slot', SLOT_ID,
        '--view', VIEW_ID,
        '--pack-version', '0.1.1',
      ];

      const preview = spawnSync(tsxPath, arguments_, { cwd: repoRoot, encoding: 'utf8' });
      expect(preview.status, preview.stderr).toBe(0);
      expect(preview.stdout).toContain('PREVIEW ONLY — no file written');
      expect(readFileSync(packPath, 'utf8')).toBe(before);

      const write = spawnSync(tsxPath, [...arguments_, '--write'], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      expect(write.status, write.stderr).toBe(0);
      expect(write.stdout).toContain('WROTE');
      const written = JSON.parse(readFileSync(packPath, 'utf8'));
      expect(written.meta.pack_version).toBe('0.1.1');
      expect(written.views.find((view: Pack['views'][number]) => view.view_id === VIEW_ID).probe)
        .toEqual(pose());
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('the real Rodero browser export', () => {
  it('recomputes the exact validated 0.1.0 to 0.1.1 candidate', () => {
    const packValue: unknown = JSON.parse(readFileSync(roderoPath, 'utf8'));
    const exportValue: unknown = JSON.parse(readFileSync(roderoExportPath, 'utf8'));
    const before = JSON.parse(readFileSync(roderoBeforePath, 'utf8')) as {
      pack_version: string;
      view_id: string;
      placement_landmark: string;
      probe: Pack['views'][number]['probe'];
      sweep: Pack['views'][number]['sweep'];
      provenance: Pack['views'][number]['provenance'];
    };
    const packResult = validatePack(packValue);
    if (!packResult.ok) throw new Error('the checked-in Rodero pack must validate');
    const document = AuthoringSlotsExport.parse(exportValue);
    const slot = document.slots.find((entry) => entry.slot_id === 'view-ingest-reference-pose')!;
    const target = packResult.pack.views.find(
      (view) => view.view_id === 'ingest-reference-pose',
    )!;

    expect(packResult.pack.meta.pack_version).toBe('0.1.1');
    expect(document.pack_version).toBe(before.pack_version);
    expect(target.probe).toEqual(slot.probe);
    expect(target.sweep!.axis.direction).toEqual(slot.probe.lateral_axis);
    expect(target.sweep!.structures_in_order).toEqual([]);
    expect(target.provenance.vetted.status).toBe('draft');
    expect(target.provenance.modified.note).toContain(slot.slot_id);
    expect(target.provenance.modified.note).toContain(slot.saved_at);
    expect(target.provenance.modified.note).toContain(document.exported_at);
    expect(target.provenance.modified.note).not.toContain('generated mechanically');
    expect(packResult.pack.meshes.anatomical_frame?.method).toBe('cardiac-landmarks-v2');
    expect(packResult.pack.meshes.anatomical_frame?.inputs.apex).toMatchObject({
      source: 'universal ventricular coordinate Z on left-ventricular myocardium',
      tag: 1,
      percentile: 1,
    });
    expect(packResult.pack.meshes.anatomical_frame?.checks_passed).toBe(9);
    expect(validatePack(packResult.pack).ok).toBe(true);

    const reconstructedSource = structuredClone(packResult.pack);
    reconstructedSource.meta.pack_version = before.pack_version;
    const sourceView = reconstructedSource.views.find((view) => view.view_id === before.view_id)!;
    sourceView.placement_landmark = before.placement_landmark;
    sourceView.probe = before.probe;
    sourceView.sweep = before.sweep;
    sourceView.provenance = before.provenance;

    const recomputed = prepareAuthoringIngest({
      pack: reconstructedSource,
      authoringExport: exportValue,
      slotId: 'view-ingest-reference-pose',
      viewId: 'ingest-reference-pose',
      nextPackVersion: '0.1.1',
    });
    expect(recomputed.candidate).toEqual(packResult.pack);

    expect(() => prepareAuthoringIngest({
      pack: packValue,
      authoringExport: exportValue,
      slotId: 'view-ingest-reference-pose',
      viewId: 'ingest-reference-pose',
      nextPackVersion: '0.1.2',
    })).toThrow(/does not equal target pack version/);
  });
});
