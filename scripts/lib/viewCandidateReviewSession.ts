/**
 * Build a read-only visual-review carrier from generated view-candidate evidence.
 *
 * `view-candidates/v1` remains the evidence record. This helper extracts only
 * probe poses into the existing `authoring-slots/v1` transport understood by
 * authoring mode. Single proposals occupy their standard canon slots, including
 * an explicitly declared same-id replacement such as set-002 B1; every
 * unselected series variant gets a custom slot so the carrier never implies
 * that one variant won. The loaded pack itself is never changed.
 */
import { buildExport, type SlotExport } from '../../src/authoring/exportFile.ts';
import { MAX_CUSTOM_SLOTS, standardSlotId, type SavedSlot } from '../../src/authoring/slots.ts';
import { VIEW_CANON } from '../../src/authoring/viewCanon.ts';
import type { ViewCandidateEvidence } from './viewCandidateEvidence.ts';

const canonById = new Map(VIEW_CANON.map((entry) => [entry.viewId, entry]));

function canonCode(viewId: string): string {
  const canon = canonById.get(viewId);
  if (canon === undefined) throw new Error(`candidate targets unknown canon view "${viewId}"`);
  return canon.name.split(' ', 1)[0] ?? viewId;
}

function requireNoSweep(label: string, coordinates: { sweep?: unknown }): void {
  if (coordinates.sweep !== undefined) {
    throw new Error(
      `${label} carries a sweep, but authoring-slots/v1 transports probe poses only`,
    );
  }
}

interface ReviewVariantLabel {
  variant_id: string;
  source_parameter: { derived_value: { unit: string; value: number } };
}

function variantLabel(viewId: string, variant: ReviewVariantLabel): string {
  const { unit, value } = variant.source_parameter.derived_value;
  const magnitude = Number.isInteger(value) && value >= 0 && value < 100
    ? String(value).padStart(2, '0')
    : String(value);
  const suffix = unit === 'deg' ? `${magnitude}°` : `${magnitude} ${unit}`;
  return `DRAFT TEST · ${canonCode(viewId)} ${suffix} · ${variant.variant_id}`;
}

/**
 * Convert one validated candidate set into a mount/import carrier.
 *
 * The caller supplies a fixed generation instant so a checked review-session
 * file can be reproduced byte-for-byte. The instant dates the derived carrier;
 * it is not a claim about manual placement or clinical review.
 */
export function buildViewCandidateReviewSession(
  evidence: ViewCandidateEvidence,
  generatedAt: string,
): SlotExport {
  if (new Date(generatedAt).toISOString() !== generatedAt) {
    throw new Error('generatedAt must be a canonical ISO instant');
  }

  const saved: SavedSlot[] = [];
  for (const candidate of evidence.candidates) {
    if (candidate.kind === 'single') {
      requireNoSweep(candidate.candidate_id, candidate.coordinates);
      saved.push({
        packId: evidence.binding.source_pack_id,
        packVersion: evidence.binding.source_pack_version,
        slotId: standardSlotId(candidate.intended_view_id),
        kind: 'canon',
        label: `DRAFT TEST · ${canonCode(candidate.intended_view_id)} · ${candidate.candidate_id}`,
        pose: structuredClone(candidate.coordinates.probe),
        savedAt: generatedAt,
      });
      continue;
    }

    if (candidate.selection_state !== 'no_variant_selected'
      || candidate.selected_variant_id !== null) {
      throw new Error(
        `${candidate.candidate_id} has a selected variant; this review carrier expects an `
        + 'unselected comparison series',
      );
    }
    for (const variant of candidate.variants) {
      requireNoSweep(variant.variant_id, variant.coordinates);
      if (saved.filter((slot) => slot.kind === 'custom').length >= MAX_CUSTOM_SLOTS) {
        throw new Error(
          `candidate variants exceed the ${MAX_CUSTOM_SLOTS} authoring custom-slot limit`,
        );
      }
      const ordinal = saved.filter((slot) => slot.kind === 'custom').length + 1;
      saved.push({
        packId: evidence.binding.source_pack_id,
        packVersion: evidence.binding.source_pack_version,
        slotId: `custom-${ordinal}`,
        kind: 'custom',
        label: variantLabel(candidate.intended_view_id, variant),
        pose: structuredClone(variant.coordinates.probe),
        savedAt: generatedAt,
      });
    }
  }

  return buildExport({
    packId: evidence.binding.source_pack_id,
    packVersion: evidence.binding.source_pack_version,
    packSchemaVersion: evidence.binding.source_pack_schema_version,
    slots: saved,
    exportedAt: generatedAt,
  });
}
