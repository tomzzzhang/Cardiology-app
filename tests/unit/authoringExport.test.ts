/**
 * The export file: it round-trips through the schema, or it is not written.
 *
 * `contracts/authoring-mode.md` rule 3. The two failures this has to make
 * impossible are an export that cannot be ingested and an import that lands one
 * pack's coordinates in another pack's model — the second being the dangerous
 * one, because the result is a set of poses that are wrong and look entirely
 * plausible.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPORT_SCHEMA_VERSION, buildExport, exportFileName, readExport,
} from '../../src/authoring/exportFile.ts';
import type { SavedSlot } from '../../src/authoring/slots.ts';
import type { ProbePose } from '../../src/schema/packV0.ts';

const AT = '2026-08-19T20:00:00.000Z';

function pose(over: Partial<ProbePose> = {}): ProbePose {
  return {
    origin: [0, -133.6, 8],
    beam_axis: [0, 1, 0],
    lateral_axis: [1, 0, 0],
    fan: { angle_deg: 80, depth_cm: 21, focus_cm: 10 },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
    ...over,
  } as ProbePose;
}

function slot(over: Partial<SavedSlot> = {}): SavedSlot {
  return {
    packId: 'normal-rodero',
    packVersion: '0.1.0',
    slotId: 'view-0',
    kind: 'canon',
    label: 'Apical four-chamber',
    pose: pose(),
    savedAt: AT,
    ...over,
  };
}

function exportOf(slots: SavedSlot[], packId = 'normal-rodero') {
  return buildExport({
    packId,
    packVersion: '0.1.0',
    packSchemaVersion: '0.1',
    slots,
    exportedAt: AT,
  });
}

describe('what the file says about itself', () => {
  it('carries the pack id, exact content revision and both schema versions', () => {
    const document = exportOf([slot()]);
    expect(document.schema_version).toBe(EXPORT_SCHEMA_VERSION);
    expect(document.pack_id).toBe('normal-rodero');
    expect(document.pack_version).toBe('0.1.0');
    expect(document.pack_schema_version).toBe('0.1');
    expect(document.exported_at).toBe(AT);
    expect(document.slots).toHaveLength(1);
  });

  it('names the file for the pack, so a folder of them is readable', () => {
    expect(exportFileName('normal-rodero', AT))
      .toBe('normal-rodero-probe-slots-2026-08-19T20-00-00-000Z.json');
  });
});

describe('an export that would not validate is never written', () => {
  it('refuses a pose whose axes are not orthogonal', () => {
    const bad = pose({ lateral_axis: [0, 1, 0] }); // parallel to the beam
    expect(() => exportOf([slot({ pose: bad })]))
      .toThrow(/not a valid probe pose[\s\S]*orthogonal/);
  });

  it('refuses a pose whose axes are not unit length', () => {
    expect(() => exportOf([slot({ pose: pose({ beam_axis: [0, 2, 0] }) })]))
      .toThrow(/not a valid probe pose/);
  });

  it('refuses a focus outside the depth', () => {
    expect(() => exportOf([slot({
      pose: pose({ fan: { angle_deg: 80, depth_cm: 10, focus_cm: 40 } }),
    })])).toThrow(/focus_cm must lie within depth_cm/);
  });

  it('names the slot it refused, and says nothing was written', () => {
    expect(() => exportOf([slot({ label: 'Window B', pose: pose({ beam_axis: [0, 0, 0] }) })]))
      .toThrow(/Window B[\s\S]*Nothing was exported/);
  });

  it('refuses a slot belonging to a different pack', () => {
    expect(() => exportOf([slot({ packId: 'stub' })])).toThrow(/belongs to pack "stub"/);
  });

  it('refuses a slot saved against another revision of the same pack', () => {
    expect(() => exportOf([slot({ packVersion: '0.0.9' })]))
      .toThrow(/saved against pack version "0.0.9"[\s\S]*Re-save/);
  });

  it('refuses a pose carrying a field the schema does not know', () => {
    // `ProbePose` is a strict object, so a stowaway field is a REFUSAL rather
    // than something quietly stripped on the way out. That is the stronger
    // behaviour: a field nobody meant to add is a sign the pose came from
    // somewhere unexpected, and silently dropping it hides that.
    const withExtra = { ...pose(), stowaway: 'not in the schema' } as unknown as ProbePose;
    expect(() => exportOf([slot({ pose: withExtra })])).toThrow(/Unrecognized key/);
  });

  it('what is written is what the schema returned, not the object handed in', () => {
    const original = pose();
    const document = exportOf([slot({ pose: original })]);
    expect(document.slots[0].probe).toEqual(original);
    expect(document.slots[0].probe).not.toBe(original);
  });
});

describe('reading one back', () => {
  it('round-trips a valid file into the same poses', () => {
    const text = JSON.stringify(exportOf([slot(), slot({
      slotId: 'custom-1', kind: 'custom', label: 'Window A', pose: pose({ origin: [1, 2, 3] }),
    })]));
    const result = readExport(text, 'normal-rodero', '0.1.0');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots).toHaveLength(2);
    expect(result.slots[0].pose).toEqual(pose());
    expect(result.slots[1].pose.origin).toEqual([1, 2, 3]);
    expect(result.slots[1].kind).toBe('custom');
    expect(result.slots.every((row) => row.packId === 'normal-rodero')).toBe(true);
    expect(result.slots.every((row) => row.packVersion === '0.1.0')).toBe(true);
  });

  it('REFUSES a file exported against another pack, rather than applying it', () => {
    const text = JSON.stringify(exportOf([slot()]));
    const result = readExport(text, 'normal-vhl-heart0102', '0.1.0');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toMatch(/exported against pack "normal-rodero"/);
    expect(result.problem).toMatch(/Refused/);
  });

  it('REFUSES a file exported against another revision of the same pack', () => {
    const result = readExport(JSON.stringify(exportOf([slot()])), 'normal-rodero', '0.1.1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/coordinates do not cross pack revisions/);
  });

  it('refuses a legacy file that names no source pack revision', () => {
    const document = { ...exportOf([slot()]) } as Record<string, unknown>;
    delete document.pack_version;
    const result = readExport(JSON.stringify(document), 'normal-rodero', '0.1.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/names no source pack version/);
  });

  it('refuses a file in an unknown format version', () => {
    const document = { ...exportOf([slot()]), schema_version: 'authoring-slots/v99' };
    const result = readExport(JSON.stringify(document), 'normal-rodero', '0.1.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/authoring-slots\/v99/);
  });

  it('refuses a pose that has been corrupted since it was written', () => {
    const document = exportOf([slot()]);
    (document.slots[0].probe as ProbePose).beam_axis = [0, 0, 0];
    const result = readExport(JSON.stringify(document), 'normal-rodero', '0.1.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/Nothing was imported/);
  });

  it('reports rather than throws on a file that is not JSON at all', () => {
    const result = readExport('<html>not this</html>', 'normal-rodero', '0.1.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/not JSON/);
  });

  it('refuses a file that names no pack', () => {
    const document = { ...exportOf([slot()]) } as Record<string, unknown>;
    delete document.pack_id;
    const result = readExport(JSON.stringify(document), 'normal-rodero', '0.1.0');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/names no pack/);
  });
});
