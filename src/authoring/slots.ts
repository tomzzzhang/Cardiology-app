/**
 * Saved probe positions: what a slot is, and why there are two kinds of them.
 *
 * ## Standard slots are content. Custom slots are the author's.
 *
 * A standard slot is one of the pack's authored `views[]` — a vetted or
 * draft-flagged clinical view with a review state, provenance and a name that
 * means something. **Saving over one never edits the pack.** It writes a
 * clearly labelled LOCAL OVERRIDE that lives beside the authored value rather
 * than on top of it, the UI says the slot is overridden, and reverting restores
 * the authored pose exactly. `views[]` is content with a review state and the
 * runtime does not own it; the path from an override into a pack runs through
 * an export, a human, and a separate ingest.
 *
 * A custom slot is the author's own working position. It may be created,
 * overwritten, renamed and deleted freely, because nothing else claims it.
 *
 * ## What this module cannot do
 *
 * It never sees a `Pack`. It is handed SEEDS — an id, a label and a pose per
 * authored view — which the caller derives, and every seed it hands back is
 * frozen. That is the same structural guarantee `freeProbe.ts` makes: there is
 * no object reachable from here that `views[]` could be written through, so
 * "nothing in this unit writes `views[]`" is a property of the module graph
 * rather than a promise about the code.
 *
 * ## The open question, shipped rather than decided
 *
 * How many custom slots a pack may have, and whether they are named or
 * numbered, is an owner decision that is not made. What ships is NAMED, capped
 * at `MAX_CUSTOM_SLOTS`, with the cap stated in the UI when it is reached.
 * Named because an author placing eight positions on an unlabelled heart has no
 * way to tell "custom 3" from "custom 5" an hour later, and the cap is there so
 * a droplist stays a droplist. Logged in `docs/observations.md`.
 */
import type { ProbePose } from '../schema/packV0.ts';

export type SlotKind = 'standard' | 'custom';

/** How many custom slots a pack may hold. See the note above: not a decision. */
export const MAX_CUSTOM_SLOTS = 8;

/** One of the pack's authored views, reduced to what a slot needs. */
export interface SlotSeed {
  slotId: string;
  label: string;
  pose: ProbePose;
}

/** A pose the author saved, as it is stored and exported. */
export interface SavedSlot {
  packId: string;
  slotId: string;
  kind: SlotKind;
  label: string;
  pose: ProbePose;
  /** ISO instant. Authoring metadata, not provenance — it dates a working file. */
  savedAt: string;
}

/** A slot as the UI renders it: what is authored, what is saved, which wins. */
export interface Slot {
  slotId: string;
  kind: SlotKind;
  label: string;
  /** The pack's own pose, for a standard slot. Null for a custom one. */
  authored: ProbePose | null;
  /** The author's saved pose, when there is one. */
  saved: SavedSlot | null;
  /** A standard slot with a local override sitting over its authored value. */
  overridden: boolean;
  /** What "restore this slot" restores. Saved wins; authored is the fallback. */
  pose: ProbePose | null;
}

/**
 * The storage key for one slot.
 *
 * `packId` and `slotId` are both slugs by construction — the pack id is a
 * schema `Slug`, and slot ids are built below from slugs and integers — and no
 * slug can contain a colon, so `::` cannot occur inside either half. One pack's
 * slots therefore cannot collide with another's, which is not a property a
 * concatenation gets for free.
 */
export function slotKey(packId: string, slotId: string): string {
  if (packId.includes(':') || slotId.includes(':')) {
    throw new Error(`a slot key part must not contain a colon: "${packId}", "${slotId}"`);
  }
  return `${packId}::${slotId}`;
}

/** The slot id for the pack's view at `index`. Stable across renames of the view. */
export function standardSlotId(index: number): string {
  return `view-${index}`;
}

/** The slot id for the author's nth custom slot. */
export function customSlotId(ordinal: number): string {
  return `custom-${ordinal}`;
}

/**
 * Frozen seeds from the pack's authored views.
 *
 * Deep-frozen, so an authored pose cannot be mutated in place by anything
 * holding a seed. That closes the one route by which a slot could have edited
 * pack content in memory: an override that mutated `views[i].probe` rather than
 * writing beside it would look identical on screen and would be a silent edit
 * of a reviewed view.
 */
export function seedsFromViews(
  views: readonly { name: string; probe: ProbePose }[],
): SlotSeed[] {
  return views.map((view, index) => Object.freeze({
    slotId: standardSlotId(index),
    label: view.name,
    pose: deepFreeze(structuredClone(view.probe)),
  }));
}

/**
 * The slots the UI renders: seeds, plus whatever was saved over or beside them.
 *
 * Standard slots come first and in the pack's own order, because that order is
 * content. Custom slots follow in the order they were created.
 */
export function mergeSlots(seeds: readonly SlotSeed[], saved: readonly SavedSlot[]): Slot[] {
  const byId = new Map(saved.map((slot) => [slot.slotId, slot]));

  const standard: Slot[] = seeds.map((seed) => {
    const savedSlot = byId.get(seed.slotId) ?? null;
    return {
      slotId: seed.slotId,
      kind: 'standard',
      label: seed.label,
      authored: seed.pose,
      saved: savedSlot,
      overridden: savedSlot !== null,
      pose: savedSlot?.pose ?? seed.pose,
    };
  });

  const custom: Slot[] = saved
    .filter((slot) => slot.kind === 'custom')
    .map((slot) => ({
      slotId: slot.slotId,
      kind: 'custom',
      label: slot.label,
      authored: null,
      saved: slot,
      overridden: false,
      pose: slot.pose,
    }));

  return [...standard, ...custom];
}

/**
 * The next free custom slot id, or null when the cap is reached.
 *
 * Reuses a gap left by a deleted slot rather than counting upward forever, so
 * deleting one and creating another does not walk the ordinals off the end of
 * the cap.
 */
export function nextCustomSlotId(slots: readonly Slot[]): string | null {
  const taken = new Set(slots.filter((slot) => slot.kind === 'custom').map((slot) => slot.slotId));
  if (taken.size >= MAX_CUSTOM_SLOTS) return null;
  for (let ordinal = 1; ordinal <= MAX_CUSTOM_SLOTS; ordinal += 1) {
    const id = customSlotId(ordinal);
    if (!taken.has(id)) return id;
  }
  return null;
}

/**
 * Restoring a slot is EXACT, and this is what makes it so.
 *
 * The pose is REPLACED, not merged — a structured clone of the stored value,
 * with nothing carried over from whatever the probe was doing a moment ago. It
 * is the same rule re-locking the free probe follows, for the same reason: a
 * restore that merged would leave a position that is nearly the saved one, and
 * "nearly" is not a position anybody saved.
 */
export function restoredPose(slot: Slot): ProbePose | null {
  return slot.pose === null ? null : structuredClone(slot.pose) as ProbePose;
}

/** Whether two poses are identical to the bit, for asserting an exact restore. */
export function samePose(a: ProbePose, b: ProbePose): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
