/**
 * Saved probe positions: what a slot is, and why there are two kinds of them.
 *
 * ## Standard slots are content. Custom slots are the author's.
 *
 * A standard slot is a configured draft starter or one of the pack's authored
 * `views[]`; review status is independent. **Saving over one never edits the pack.** It writes a
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
import { VIEW_CANON, isFrameView } from './viewCanon.ts';

/**
 * `canon` — a clinical view from `docs/view_canon.md`, whether or not the pack
 * has authored it. `extra` — a view the pack authored that the canon does not
 * list, which is every pack's `ingest-reference-pose` and the stub's two
 * synthetic views. `custom` — the author's own.
 *
 * `canon` and `extra` are both "standard" in the rule that matters: saving over
 * either writes a local override and never the pack.
 */
export type SlotKind = 'canon' | 'extra' | 'custom' | 'orphan';

/** Whether a slot is the pack's content rather than the author's own. */
export function isPackSlot(kind: SlotKind): boolean {
  return kind !== 'custom';
}

/** How many custom slots a pack may hold. See the note above: not a decision. */
export const MAX_CUSTOM_SLOTS = 8;

/** One of the pack's authored views, reduced to what a slot needs. */
export interface SlotSeed {
  slotId: string;
  label: string;
  /** The pack's `view_id`, so an authored view finds its canon slot. */
  viewId: string;
  /** Null for a canon slot the pack has not authored. */
  pose: ProbePose | null;
  kind: SlotKind;
  /** True for the apical four-chamber, whose pose defines the model's axes. */
  definesFrame: boolean;
}

/** A pose the author saved, as it is stored and exported. */
export interface SavedSlot {
  packId: string;
  /** Pack content revision whose model-space coordinates this pose uses. */
  packVersion: string;
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
  /** The pack's own pose, where the pack authored one. Null otherwise. */
  authored: ProbePose | null;
  /** The author's saved pose, when there is one. */
  saved: SavedSlot | null;
  /**
   * A pack slot with a local override sitting over an AUTHORED value.
   *
   * Saving into an empty canon slot is not an override: there was nothing to
   * override. The distinction matters on screen, because "overridden" is a
   * warning about reviewed content and "filled" is just work in progress.
   */
  overridden: boolean;
  /** What "restore this slot" restores. Saved wins; authored is the fallback. */
  pose: ProbePose | null;
  /** True for the apical four-chamber, whose pose defines the model's axes. */
  definesFrame: boolean;
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

/**
 * The slot id for one of the pack's views, or for a canon view.
 *
 * Keyed on the `view_id` rather than on the view's index, so a slot survives a
 * pack gaining or reordering views — an index-keyed override would silently
 * follow the position rather than the view, and an override that moves to a
 * different view is worse than one that is lost.
 */
export function standardSlotId(viewId: string): string {
  return `view-${viewId}`;
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
  views: readonly { name: string; view_id: string; probe: ProbePose }[],
): SlotSeed[] {
  const authored = new Map(views.map((view) => [view.view_id, view]));

  /*
   * The current draft starter list first, whether or not the pack has authored
   * any of it. Empty rows are conveniences for today's placing session, not a
   * platform completeness gate. A pack with no views used to offer no slots at
   * all, so the starter list keeps the tool immediately usable alongside
   * arbitrary custom slots.
   */
  const canon: SlotSeed[] = VIEW_CANON.map((view) => {
    const match = authored.get(view.viewId);
    return Object.freeze({
      slotId: standardSlotId(view.viewId),
      label: view.name,
      viewId: view.viewId,
      pose: match ? deepFreeze(structuredClone(match.probe)) : null,
      kind: 'canon' as const,
      definesFrame: isFrameView(view.viewId),
    });
  });

  /*
   * Then whatever the pack authored that the canon does not list — every pack's
   * `ingest-reference-pose`, and the stub's synthetic pair. Dropping them would
   * hide a pose that exists, which is the opposite of what a work list is for.
   */
  const known = new Set(VIEW_CANON.map((view) => view.viewId));
  const extra: SlotSeed[] = views
    .filter((view) => !known.has(view.view_id))
    .map((view) => Object.freeze({
      slotId: standardSlotId(view.view_id),
      label: view.name,
      viewId: view.view_id,
      pose: deepFreeze(structuredClone(view.probe)),
      kind: 'extra' as const,
      definesFrame: false,
    }));

  return [...canon, ...extra];
}

/**
 * The slots the UI renders: seeds, plus whatever was saved over or beside them.
 *
 * Standard slots come first and in the pack's own order, because that order is
 * content. Custom slots follow in the order they were created.
 */
export function mergeSlots(seeds: readonly SlotSeed[], saved: readonly SavedSlot[]): Slot[] {
  const byId = new Map(saved.map((slot) => [slot.slotId, slot]));

  const fromPack: Slot[] = seeds.map((seed) => {
    const savedSlot = byId.get(seed.slotId) ?? null;
    return {
      slotId: seed.slotId,
      kind: seed.kind,
      label: seed.label,
      authored: seed.pose,
      saved: savedSlot,
      // Only an AUTHORED pose can be overridden. Filling an empty canon slot
      // overrides nothing.
      overridden: savedSlot !== null && seed.pose !== null,
      pose: savedSlot?.pose ?? seed.pose,
      definesFrame: seed.definesFrame,
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
      definesFrame: false,
    }));

  /*
   * ORPHANS: stored under an id nothing here matches any more.
   *
   * Found by looking, on a store that still held rows written before slot ids
   * were keyed on `view_id` — they matched no seed, were not custom, and so
   * appeared in no group at all. They were still counted in "N stored" and
   * still went into the export: a pose no row on screen showed, leaving in a
   * file. Silently dropping them would be worse, and silently exporting them is
   * what was happening, so they get a group of their own and a way to clear
   * them.
   *
   * This will happen again. A store outlives the shape of the thing that wrote
   * it, and the honest handling is to show what does not fit rather than to
   * assume the two can never disagree.
   */
  const placed = new Set([...fromPack, ...custom].map((slot) => slot.slotId));
  const orphans: Slot[] = saved
    .filter((slot) => !placed.has(slot.slotId))
    .map((slot) => ({
      slotId: slot.slotId,
      kind: 'orphan',
      label: slot.label,
      authored: null,
      saved: slot,
      overridden: false,
      pose: slot.pose,
      definesFrame: false,
    }));

  return [...fromPack, ...custom, ...orphans];
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
