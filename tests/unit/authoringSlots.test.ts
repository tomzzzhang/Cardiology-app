/**
 * Slots: what a standard one is, what an override is, and that a restore is exact.
 *
 * The claim worth the most here is the one about `views[]`. Saving over a
 * standard slot must never edit the pack, and "must never" is asserted two
 * ways: the authored seed is FROZEN, so a write through it throws in strict
 * mode rather than succeeding quietly, and reverting produces the authored pose
 * byte for byte because it was never touched.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_SLOTS, customSlotId, mergeSlots, nextCustomSlotId, restoredPose, samePose,
  seedsFromViews, slotKey, standardSlotId, type SavedSlot,
} from '../../src/authoring/slots.ts';
import { FRAME_VIEW_ID, VIEW_CANON } from '../../src/authoring/viewCanon.ts';
import type { ProbePose } from '../../src/schema/packV0.ts';

function pose(origin: [number, number, number]): ProbePose {
  return {
    origin,
    beam_axis: [0, 0, -1],
    lateral_axis: [1, 0, 0],
    fan: { angle_deg: 80, depth_cm: 21, focus_cm: 10 },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
  };
}

const VIEWS = [
  { name: 'Apical four-chamber (draft)', view_id: FRAME_VIEW_ID, probe: pose([0, -80, 13]) },
  { name: 'Parasternal long axis (draft)', view_id: 'c1-parasternal-long-axis', probe: pose([20, -60, 30]) },
  { name: 'Ingest reference pose', view_id: 'ingest-reference-pose', probe: pose([0, 0, 90]) },
];

/** The canon slot for a view id, as `mergeSlots` keys it. */
const slotOf = (viewId: string) => standardSlotId(viewId);

function saved(over: Partial<SavedSlot> = {}): SavedSlot {
  return {
    packId: 'normal-rodero',
    slotId: standardSlotId(FRAME_VIEW_ID),
    kind: 'canon',
    label: 'Apical four-chamber (draft)',
    pose: pose([1, -133.6, 8]),
    savedAt: '2026-08-19T20:00:00.000Z',
    ...over,
  };
}

describe('keys cannot collide across packs', () => {
  it('joins on a separator no slug can contain', () => {
    expect(slotKey('normal-rodero', 'view-b1')).toBe('normal-rodero::view-b1');
    expect(slotKey('normal-rodero', 'view-b1'))
      .not.toBe(slotKey('normal-vhl-heart0102', 'view-b1'));
  });

  it('refuses a part that would make the key ambiguous', () => {
    expect(() => slotKey('a:b', 'view-0')).toThrow(/colon/);
    expect(() => slotKey('pack', 'view:0')).toThrow(/colon/);
  });

  it('keys a pack slot on the view id, not on its position', () => {
    // An index-keyed override would silently follow the POSITION when a pack
    // gains or reorders views, so an override made for the four-chamber would
    // reappear on whatever ended up second. Worse than losing it.
    expect(standardSlotId(FRAME_VIEW_ID)).toBe(`view-${FRAME_VIEW_ID}`);
  });
});

describe('the canon is present whether the pack authored it or not', () => {
  it('offers every canon view, in the canon’s order, for a pack with NO views', () => {
    const seeds = seedsFromViews([]);
    expect(seeds).toHaveLength(VIEW_CANON.length);
    expect(seeds.map((seed) => seed.viewId)).toEqual(VIEW_CANON.map((view) => view.viewId));
    // Empty, and that is the point: the slot is the work list.
    expect(seeds.every((seed) => seed.pose === null)).toBe(true);
    expect(seeds.every((seed) => seed.kind === 'canon')).toBe(true);
  });

  it('fills the canon slot the pack DID author, and leaves the rest empty', () => {
    const seeds = seedsFromViews(VIEWS);
    const fourChamber = seeds.find((seed) => seed.viewId === FRAME_VIEW_ID)!;
    expect(fourChamber.pose).toEqual(VIEWS[0].probe);
    expect(seeds.find((seed) => seed.viewId === 'b3-apical-two-chamber')!.pose).toBeNull();
  });

  it('keeps an authored view the canon does not list, rather than hiding it', () => {
    // Every pack carries `ingest-reference-pose`, which is not a clinical view.
    // Dropping it would hide a pose that exists.
    const seeds = seedsFromViews(VIEWS);
    const extra = seeds.filter((seed) => seed.kind === 'extra');
    expect(extra.map((seed) => seed.viewId)).toEqual(['ingest-reference-pose']);
    expect(extra[0].pose).toEqual(VIEWS[2].probe);
  });

  it('marks exactly one slot as the one that defines the model’s axes', () => {
    const framing = seedsFromViews(VIEWS).filter((seed) => seed.definesFrame);
    expect(framing).toHaveLength(1);
    expect(framing[0].viewId).toBe(FRAME_VIEW_ID);
  });

  it('the authored pose in a seed is deep-frozen', () => {
    const seed = seedsFromViews(VIEWS).find((row) => row.viewId === FRAME_VIEW_ID)!;
    const authored = seed.pose!;
    expect(Object.isFrozen(authored)).toBe(true);
    expect(Object.isFrozen(authored.origin)).toBe(true);
    expect(Object.isFrozen(authored.fan)).toBe(true);
    expect(() => {
      (authored as { origin: number[] }).origin[0] = 999;
    }).toThrow();
  });

  it('the seed is a COPY: freezing it does not freeze the pack’s own object', () => {
    const views = [{ name: 'A', view_id: FRAME_VIEW_ID, probe: pose([0, 0, 0]) }];
    seedsFromViews(views);
    // The pack's object is untouched and still writable — the seed froze a
    // clone. A freeze that reached back into the pack would be this module
    // changing pack content, which is the thing it must not do.
    expect(Object.isFrozen(views[0].probe)).toBe(false);
  });

  it('a saved slot over an AUTHORED one is an override beside the authored pose', () => {
    const seeds = seedsFromViews(VIEWS);
    const slots = mergeSlots(seeds, [saved()]);
    const first = slots.find((slot) => slot.slotId === slotOf(FRAME_VIEW_ID))!;

    expect(first.kind).toBe('canon');
    expect(first.overridden).toBe(true);
    // Both are present. The authored pose is not replaced, shadowed or lost.
    expect(first.authored).toEqual(VIEWS[0].probe);
    expect(first.saved?.pose).toEqual(saved().pose);
    expect(first.pose).toEqual(saved().pose);

    // And a canon slot the pack authored and nobody has saved over is untouched.
    const plax = slots.find((slot) => slot.slotId === slotOf('c1-parasternal-long-axis'))!;
    expect(plax.overridden).toBe(false);
    expect(plax.pose).toEqual(VIEWS[1].probe);
  });

  it('filling an EMPTY canon slot is not an override — there was nothing to override', () => {
    const seeds = seedsFromViews([]);
    const slots = mergeSlots(seeds, [saved()]);
    const filled = slots.find((slot) => slot.slotId === slotOf(FRAME_VIEW_ID))!;

    expect(filled.authored).toBeNull();
    expect(filled.overridden).toBe(false);
    expect(filled.pose).toEqual(saved().pose);
  });

  it('reverting is exact: dropping the override leaves the authored pose byte for byte', () => {
    const seeds = seedsFromViews(VIEWS);
    const pick = (rows: ReturnType<typeof mergeSlots>) =>
      rows.find((slot) => slot.slotId === slotOf(FRAME_VIEW_ID))!;

    expect(pick(mergeSlots(seeds, [saved()])).overridden).toBe(true);
    const reverted = pick(mergeSlots(seeds, []));
    expect(reverted.overridden).toBe(false);
    expect(JSON.stringify(reverted.pose)).toBe(JSON.stringify(VIEWS[0].probe));
  });
});

describe('custom slots', () => {
  it('are listed after the pack’s, in creation order', () => {
    const slots = mergeSlots(seedsFromViews(VIEWS), [
      saved({ slotId: customSlotId(1), kind: 'custom', label: 'Window A' }),
      saved({ slotId: customSlotId(2), kind: 'custom', label: 'Window B' }),
    ]);
    const custom = slots.filter((slot) => slot.kind === 'custom');
    expect(custom.map((slot) => slot.label)).toEqual(['Window A', 'Window B']);
    // And they are last: no canon or extra slot follows a custom one.
    expect(slots.findIndex((slot) => slot.kind === 'custom'))
      .toBe(slots.length - custom.length);
  });

  it('hand out the first free ordinal, and reuse a gap', () => {
    const withOne = mergeSlots([], [saved({ slotId: customSlotId(1), kind: 'custom' })]);
    expect(nextCustomSlotId(withOne)).toBe('custom-2');

    const withGap = mergeSlots([], [
      saved({ slotId: customSlotId(1), kind: 'custom' }),
      saved({ slotId: customSlotId(3), kind: 'custom' }),
    ]);
    expect(nextCustomSlotId(withGap)).toBe('custom-2');
  });

  it('stop at the cap rather than growing without bound', () => {
    const full = mergeSlots([], Array.from({ length: MAX_CUSTOM_SLOTS }, (_unused, index) =>
      saved({ slotId: customSlotId(index + 1), kind: 'custom' })));
    expect(nextCustomSlotId(full)).toBeNull();
  });
});

describe('a stored pose whose id nothing matches is shown, not swallowed', () => {
  /*
   * Found by looking, on a store holding rows written before slot ids were
   * keyed on `view_id`. They matched no seed, were not custom, and appeared in
   * no group — while still being counted in the total and still going into the
   * export. A pose leaving in a file that no row on screen admitted to holding.
   */
  it('surfaces a saved row that matches no seed and is not custom', () => {
    const slots = mergeSlots(seedsFromViews(VIEWS), [saved({ slotId: 'view-0' })]);
    const orphan = slots.find((slot) => slot.kind === 'orphan');

    expect(orphan).toBeDefined();
    expect(orphan!.slotId).toBe('view-0');
    expect(orphan!.pose).toEqual(saved().pose);
  });

  it('does not call a matched slot an orphan', () => {
    const slots = mergeSlots(seedsFromViews(VIEWS), [saved()]);
    expect(slots.filter((slot) => slot.kind === 'orphan')).toHaveLength(0);
  });

  it('every saved row reaches exactly one slot, whatever its id', () => {
    const rows = [
      saved(),
      saved({ slotId: customSlotId(1), kind: 'custom', label: 'Mine' }),
      saved({ slotId: 'view-0' }),
      saved({ slotId: 'view-nonsense' }),
    ];
    const slots = mergeSlots(seedsFromViews(VIEWS), rows);
    for (const row of rows) {
      expect(
        slots.filter((slot) => slot.slotId === row.slotId && slot.saved !== null),
        `${row.slotId} should appear exactly once`,
      ).toHaveLength(1);
    }
  });
});

describe('restoring is exact, not approximate', () => {
  it('returns the stored pose byte for byte', () => {
    const slot = mergeSlots(seedsFromViews(VIEWS), [saved()])
      .find((row) => row.slotId === slotOf(FRAME_VIEW_ID))!;
    const restored = restoredPose(slot);
    expect(restored).not.toBeNull();
    expect(JSON.stringify(restored)).toBe(JSON.stringify(saved().pose));
    expect(samePose(restored as ProbePose, saved().pose)).toBe(true);
  });

  it('REPLACES rather than merges: nothing of the previous pose survives', () => {
    const slot = mergeSlots(seedsFromViews(VIEWS), [
      saved({ pose: { ...pose([5, 5, 5]), fan: { angle_deg: 60, depth_cm: 12, focus_cm: 6 } } }),
    ]).find((row) => row.slotId === slotOf(FRAME_VIEW_ID))!;
    const restored = restoredPose(slot) as ProbePose;
    // A merge would have kept the seed's 80-degree fan under the saved origin.
    expect(restored.fan).toEqual({ angle_deg: 60, depth_cm: 12, focus_cm: 6 });
    expect(restored.origin).toEqual([5, 5, 5]);
  });

  it('hands back a clone, so a later nudge cannot rewrite what was saved', () => {
    const slot = mergeSlots(seedsFromViews(VIEWS), [saved()])
      .find((row) => row.slotId === slotOf(FRAME_VIEW_ID))!;
    const restored = restoredPose(slot) as ProbePose;
    (restored.origin as number[])[0] = 999;
    expect(slot.saved?.pose.origin[0]).toBe(1);
  });

  it('is null for a slot with nothing in it', () => {
    expect(restoredPose({
      slotId: 'x', kind: 'custom', label: 'x', authored: null, saved: null,
      overridden: false, pose: null, definesFrame: false,
    })).toBeNull();
  });
});
