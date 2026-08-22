/**
 * The export file: one JSON document, and the two things it refuses to do.
 *
 * `contracts/authoring-mode.md` rule 3 makes export and pack ingestion two
 * explicit validation boundaries. Every pose is put through the schema's OWN
 * `ProbePose` before the file is built, and a failure throws rather than
 * producing a file with a note in it.
 * A pose that cannot validate cannot be ingested, and a file the author cannot
 * use is worse than an error they can see, because they will find out a week
 * later with the placing session already thrown away.
 *
 * The second refusal is about identity. The file states which pack it was made
 * against, including the exact pack revision, and an import into a different
 * pack or revision is REFUSED rather than applied.
 * Poses are model-space coordinates: the same numbers mean a different place in
 * every model, and silently applying one pack's positions to another's geometry
 * produces poses that are wrong in a way that looks entirely plausible.
 */
import { ProbePose } from '../schema/packV0.ts';
import type { SavedSlot, SlotKind } from './slots.ts';

/**
 * The file format's own version, independent of the pack schema's.
 *
 * Two versions rather than one because they change for different reasons: this
 * one moves when the shape of the export changes, and `pack_schema_version`
 * records which content schema the poses inside were validated against. An
 * ingest needs both — the first to parse the file, the second to know whether
 * the poses can go into a pack as they stand.
 */
export const EXPORT_SCHEMA_VERSION = 'authoring-slots/v1';

export interface ExportedSlot {
  slot_id: string;
  kind: SlotKind;
  label: string;
  saved_at: string;
  probe: unknown;
}

/**
 * The model axes an apical four-chamber pose implies, carried out with it.
 *
 * Present only when the export contains a B1 pose. It is DERIVED, and the file
 * says which pose it came from. The v1 pack-ingest bridge deliberately ignores
 * it: `meshes.anatomical_frame` remains independently derived pack content.
 * Same convention as the schema's
 * `basis_source_to_pack`: `patient_left x basal` points along `anterior`.
 */
export interface SlotExport {
  schema_version: string;
  pack_id: string;
  /** Exact source content revision; model-space poses must not cross it. */
  pack_version: string;
  pack_schema_version: string;
  exported_at: string;
  slots: ExportedSlot[];
}

/**
 * Build the export, validating every pose first.
 *
 * Throws on the first pose that does not validate, naming the slot. The caller
 * shows the message and writes nothing.
 */
export function buildExport(input: {
  packId: string;
  packVersion: string;
  packSchemaVersion: string;
  slots: readonly SavedSlot[];
  exportedAt: string;
}): SlotExport {
  const slots: ExportedSlot[] = input.slots.map((slot) => {
    if (slot.packId !== input.packId) {
      throw new Error(
        `slot "${slot.slotId}" belongs to pack "${slot.packId}", not "${input.packId}"`,
      );
    }
    if (slot.packVersion !== input.packVersion) {
      throw new Error(
        `slot "${slot.slotId}" was saved against pack version `
        + `"${String(slot.packVersion)}", not loaded version "${input.packVersion}". `
        + 'Re-save it against the loaded revision before export.',
      );
    }
    const parsed = ProbePose.safeParse(slot.pose);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(
        `slot "${slot.label}" (${slot.slotId}) is not a valid probe pose: `
        + `${first.path.join('.') || '<root>'} — ${first.message}. Nothing was exported.`,
      );
    }
    return {
      slot_id: slot.slotId,
      kind: slot.kind,
      label: slot.label,
      saved_at: slot.savedAt,
      // The PARSED value, so what is written is what the schema accepted rather
      // than what happened to be in memory next to it.
      probe: parsed.data,
    };
  });

  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    pack_id: input.packId,
    pack_version: input.packVersion,
    pack_schema_version: input.packSchemaVersion,
    exported_at: input.exportedAt,
    slots,
  };
}

export type ImportResult =
  | { ok: true; slots: SavedSlot[] }
  | { ok: false; problem: string };

/**
 * Read an export back, for the pack it was made against and no other.
 *
 * Never throws: the caller is a button, and a bad file is a message rather than
 * a crash. Every pose is validated on the way IN as well as on the way out —
 * the file has been on a disk and through a sync client since it was written,
 * and trusting it because this code wrote it is trusting the wrong thing.
 *
 * ## Legacy `cardiac_frame` is read past, deliberately
 *
 * Exports written before 2026-08-21 carry a `cardiac_frame` block derived from
 * an apical four-chamber pose, which the app once used to set its levelling
 * axis. That behaviour is gone and must not come back through a file.
 *
 * This reader takes named fields one at a time rather than parsing the document
 * whole, so an unknown key is already inert — but "inert because nobody wrote
 * the line that would read it" is a property that a later edit can quietly
 * remove. Stated here instead: the field is not read, not stored, not returned,
 * and not carried into a re-export. Importing an old file keeps its POSES,
 * which are ordinary model-space coordinates and still valid, and drops its
 * claim about the model's axes, which never was.
 */
export function readExport(
  text: string,
  expectedPackId: string,
  expectedPackVersion: string,
): ImportResult {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    return { ok: false, problem: `that file is not JSON: ${(error as Error).message}` };
  }

  if (typeof document !== 'object' || document === null) {
    return { ok: false, problem: 'that file does not contain an object' };
  }
  const record = document as Partial<SlotExport>;

  if (record.schema_version !== EXPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      problem:
        `this file declares format "${String(record.schema_version)}", and this build reads `
        + `"${EXPORT_SCHEMA_VERSION}".`,
    };
  }

  if (typeof record.pack_id !== 'string') {
    return { ok: false, problem: 'this file names no pack, so it cannot be imported anywhere' };
  }

  if (record.pack_id !== expectedPackId) {
    return {
      ok: false,
      problem:
        `this file was exported against pack "${record.pack_id}" and the loaded pack is `
        + `"${expectedPackId}". Probe poses are model-space coordinates, so applying one `
        + 'pack’s positions to another’s geometry would place them somewhere plausible and '
        + 'wrong. Refused.',
    };
  }

  if (typeof record.pack_version !== 'string') {
    return {
      ok: false,
      problem: 'this file names no source pack version, so its coordinates cannot be trusted',
    };
  }

  if (record.pack_version !== expectedPackVersion) {
    return {
      ok: false,
      problem:
        `this file was exported against pack version "${record.pack_version}" and the loaded `
        + `version is "${expectedPackVersion}". Model-space coordinates do not cross pack `
        + 'revisions. Refused.',
    };
  }

  if (!Array.isArray(record.slots)) {
    return { ok: false, problem: 'this file carries no slots array' };
  }

  const slots: SavedSlot[] = [];
  for (const entry of record.slots as ExportedSlot[]) {
    if (typeof entry?.slot_id !== 'string' || typeof entry?.label !== 'string') {
      return { ok: false, problem: 'a slot in this file has no id or no label' };
    }
    if (!['canon', 'extra', 'custom', 'orphan'].includes(entry.kind)) {
      return { ok: false, problem: `slot "${entry.slot_id}" has an unknown kind "${entry.kind}"` };
    }
    const parsed = ProbePose.safeParse(entry.probe);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        ok: false,
        problem:
          `slot "${entry.label}" (${entry.slot_id}) is not a valid probe pose: `
          + `${first.path.join('.') || '<root>'} — ${first.message}. Nothing was imported.`,
      };
    }
    slots.push({
      packId: record.pack_id,
      packVersion: record.pack_version,
      slotId: entry.slot_id,
      kind: entry.kind,
      label: entry.label,
      savedAt: typeof entry.saved_at === 'string' ? entry.saved_at : '',
      pose: parsed.data,
    });
  }

  return { ok: true, slots };
}

/** The download's file name. Named for the pack, so a folder of them is readable. */
export function exportFileName(packId: string, exportedAt: string): string {
  const stamp = exportedAt.replace(/[:.]/g, '-');
  return `${packId}-probe-slots-${stamp}.json`;
}
