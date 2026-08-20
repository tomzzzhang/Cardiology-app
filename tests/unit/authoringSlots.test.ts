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
  { name: 'Apical four-chamber', probe: pose([0, -80, 13]) },
  { name: 'Parasternal long axis', probe: pose([20, -60, 30]) },
];

function saved(over: Partial<SavedSlot> = {}): SavedSlot {
  return {
    packId: 'normal-rodero',
    slotId: standardSlotId(0),
    kind: 'standard',
    label: 'Apical four-chamber',
    pose: pose([1, -133.6, 8]),
    savedAt: '2026-08-19T20:00:00.000Z',
    ...over,
  };
}

describe('keys cannot collide across packs', () => {
  it('joins on a separator no slug can contain', () => {
    expect(slotKey('normal-rodero', 'view-0')).toBe('normal-rodero::view-0');
    expect(slotKey('normal-rodero', 'view-0')).not.toBe(slotKey('normal-vhl-heart0102', 'view-0'));
  });

  it('refuses a part that would make the key ambiguous', () => {
    expect(() => slotKey('a:b', 'view-0')).toThrow(/colon/);
    expect(() => slotKey('pack', 'view:0')).toThrow(/colon/);
  });
});

describe('standard slots are the pack’s, and stay the pack’s', () => {
  it('derives one seed per view, in the pack’s own order', () => {
    const seeds = seedsFromViews(VIEWS);
    expect(seeds.map((seed) => seed.slotId)).toEqual(['view-0', 'view-1']);
    expect(seeds.map((seed) => seed.label)).toEqual(VIEWS.map((view) => view.name));
  });

  it('the authored pose in a seed is deep-frozen', () => {
    const seed = seedsFromViews(VIEWS)[0];
    expect(Object.isFrozen(seed.pose)).toBe(true);
    expect(Object.isFrozen(seed.pose.origin)).toBe(true);
    expect(Object.isFrozen(seed.pose.fan)).toBe(true);
    expect(() => {
      (seed.pose as { origin: number[] }).origin[0] = 999;
    }).toThrow();
  });

  it('the seed is a COPY: freezing it does not freeze the pack’s own object', () => {
    const views = [{ name: 'A', probe: pose([0, 0, 0]) }];
    seedsFromViews(views);
    // The pack's object is untouched and still writable — the seed froze a
    // clone. A freeze that reached back into the pack would be this module
    // changing pack content, which is the thing it must not do.
    expect(Object.isFrozen(views[0].probe)).toBe(false);
  });

  it('a saved slot over a standard one is an OVERRIDE beside the authored pose', () => {
    const seeds = seedsFromViews(VIEWS);
    const slots = mergeSlots(seeds, [saved()]);
    const first = slots[0];

    expect(first.kind).toBe('standard');
    expect(first.overridden).toBe(true);
    // Both are present. The authored pose is not replaced, shadowed or lost.
    expect(first.authored).toEqual(VIEWS[0].probe);
    expect(first.saved?.pose).toEqual(saved().pose);
    expect(first.pose).toEqual(saved().pose);

    // And the second slot, with no override, is untouched.
    expect(slots[1].overridden).toBe(false);
    expect(slots[1].pose).toEqual(VIEWS[1].probe);
  });

  it('reverting is exact: dropping the override leaves the authored pose byte for byte', () => {
    const seeds = seedsFromViews(VIEWS);
    const overridden = mergeSlots(seeds, [saved()])[0];
    const reverted = mergeSlots(seeds, [])[0];

    expect(overridden.overridden).toBe(true);
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
    expect(slots.map((slot) => slot.kind)).toEqual(['standard', 'standard', 'custom', 'custom']);
    expect(slots.slice(2).map((slot) => slot.label)).toEqual(['Window A', 'Window B']);
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

describe('restoring is exact, not approximate', () => {
  it('returns the stored pose byte for byte', () => {
    const slot = mergeSlots(seedsFromViews(VIEWS), [saved()])[0];
    const restored = restoredPose(slot);
    expect(restored).not.toBeNull();
    expect(JSON.stringify(restored)).toBe(JSON.stringify(saved().pose));
    expect(samePose(restored as ProbePose, saved().pose)).toBe(true);
  });

  it('REPLACES rather than merges: nothing of the previous pose survives', () => {
    const slot = mergeSlots(seedsFromViews(VIEWS), [
      saved({ pose: { ...pose([5, 5, 5]), fan: { angle_deg: 60, depth_cm: 12, focus_cm: 6 } } }),
    ])[0];
    const restored = restoredPose(slot) as ProbePose;
    // A merge would have kept the seed's 80-degree fan under the saved origin.
    expect(restored.fan).toEqual({ angle_deg: 60, depth_cm: 12, focus_cm: 6 });
    expect(restored.origin).toEqual([5, 5, 5]);
  });

  it('hands back a clone, so a later nudge cannot rewrite what was saved', () => {
    const slot = mergeSlots(seedsFromViews(VIEWS), [saved()])[0];
    const restored = restoredPose(slot) as ProbePose;
    (restored.origin as number[])[0] = 999;
    expect(slot.saved?.pose.origin[0]).toBe(1);
  });

  it('is null for a slot with nothing in it', () => {
    expect(restoredPose({
      slotId: 'x', kind: 'custom', label: 'x', authored: null, saved: null,
      overridden: false, pose: null,
    })).toBeNull();
  });
});
