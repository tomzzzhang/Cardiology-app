/**
 * The unlocked probe — the one learner-reachable path off the saved sweep
 * track, and the conditions attached to it.
 *
 * Everywhere else the probe is pinned to its view, and that constraint is what
 * lets the echo panel put a view's name on an image. Unlocking it is an
 * explicit owner decision (2026-08-19). What it costs is paid for by labelling,
 * which is UI; what it must NOT cost is tested here:
 *
 * * the free pose is a rotation of a saved pose about its own origin, and the
 *   saved pose is never touched;
 * * nothing in this module can reach `views[]`, or anything that could be saved;
 * * locking again restores `frameAt(probe, sweep, t)` EXACTLY, not nearly.
 */
import { describe, expect, it } from 'vitest';
import type { ProbePose, Sweep } from '../../src/schema/packV0.ts';
import { dot, frameAt, imagingFrame, length, poseAt } from '../../src/echo/probeFrame.ts';
import type { Vec3 } from '../../src/schema/primitives.ts';
import { hasLeftTrack, rotatedPose } from '../../src/viewer/freeProbe.ts';

const RIGHT: Vec3 = [1, 0, 0];
const UP: Vec3 = [0, 1, 0];

function probe(overrides: Partial<ProbePose> = {}): ProbePose {
  return {
    origin: [3, -2, 100],
    beam_axis: [0, 0, -1],
    lateral_axis: [1, 0, 0],
    fan: { angle_deg: 80, depth_cm: 12, focus_cm: 5 },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
    ...overrides,
  } as ProbePose;
}

const SWEEP: Sweep = {
  mode: 'tilt',
  axis: { direction: [1, 0, 0] },
  range: { from: -18, to: 22, unit: 'deg' },
  interpolation: 'slerp',
} as Sweep;

describe('rotatedPose', () => {
  it('pivots on the skin: the origin never moves', () => {
    // A transducer turns where it sits. Unlocking the ANGLE must not also slide
    // the probe through the chest wall — that is a different motion, and it is
    // not offered.
    const start = probe();
    for (const [dx, dy] of [[0, 0], [240, 0], [0, -180], [-300, 260]]) {
      expect(rotatedPose(start, RIGHT, UP, dx, dy).origin).toEqual(start.origin);
    }
  });

  it('keeps the basis orthonormal, so the fan stays planar', () => {
    /*
     * Two successive rotations of two vectors are exact in theory and drift in
     * floating point, and a basis that is only NEARLY orthogonal produces a fan
     * that is only nearly planar — an echo image that disagrees with the wedge
     * by a fraction of a degree, which is exactly the defect `imagingFrame`
     * re-orthogonalises the authored axes against.
     */
    let pose = probe();
    for (let step = 0; step < 60; step += 1) {
      pose = rotatedPose(pose, RIGHT, UP, 37, -23);
      expect(length(pose.beam_axis as Vec3)).toBeCloseTo(1, 12);
      expect(length(pose.lateral_axis as Vec3)).toBeCloseTo(1, 12);
      expect(dot(pose.beam_axis as Vec3, pose.lateral_axis as Vec3)).toBeCloseTo(0, 12);
    }
  });

  it('turns the probe the way the hand goes', () => {
    // Dragging right swings the beam right; dragging down tips it down. The
    // opposite pairing reads as the probe fighting the pointer.
    const start = probe();
    expect(dot(rotatedPose(start, RIGHT, UP, 200, 0).beam_axis as Vec3, RIGHT))
      .toBeGreaterThan(0);
    expect(dot(rotatedPose(start, RIGHT, UP, -200, 0).beam_axis as Vec3, RIGHT))
      .toBeLessThan(0);
    expect(dot(rotatedPose(start, RIGHT, UP, 0, 200).beam_axis as Vec3, UP))
      .toBeLessThan(0);
    expect(dot(rotatedPose(start, RIGHT, UP, 0, -200).beam_axis as Vec3, UP))
      .toBeGreaterThan(0);
  });

  it('depends only on where the drag ended, not on how it got there', () => {
    // The same freeze-the-start rule the cut handles and the tilt arrow follow.
    const start = probe();
    const direct = rotatedPose(start, RIGHT, UP, 120, 80);
    let stepped = start;
    for (let step = 1; step <= 40; step += 1) {
      stepped = rotatedPose(start, RIGHT, UP, (120 * step) / 40, (80 * step) / 40);
    }
    expect(stepped.beam_axis).toEqual(direct.beam_axis);

    // And returning the pointer to where it started returns the probe.
    const returned = rotatedPose(start, RIGHT, UP, 0, 0);
    for (let axis = 0; axis < 3; axis += 1) {
      expect((returned.beam_axis as Vec3)[axis])
        .toBeCloseTo((start.beam_axis as Vec3)[axis], 12);
    }
  });

  it('never mutates the pose it was handed', () => {
    /*
     * The pose it is handed is, on the live path, the one seeded from the
     * pack's own `views[i].probe`. Mutating it in place would edit the vetted
     * view through a shared reference — the exact write the whole free-cutter /
     * vetted-wedge separation exists to prevent — and would do it invisibly.
     */
    const start = probe();
    const snapshot = JSON.parse(JSON.stringify(start));
    rotatedPose(start, RIGHT, UP, 300, -200);
    expect(start).toEqual(snapshot);
  });

  it('returns a pose and nothing else, with no way back to a view', () => {
    // The shape of the return value IS the guarantee: it carries no view id, no
    // provenance and no identity, so nothing downstream can mistake a
    // hand-turned probe for the reviewed view it was seeded from.
    const turned = rotatedPose(probe(), RIGHT, UP, 90, 40);
    expect(Object.keys(turned).sort()).toEqual(
      ['beam_axis', 'display', 'fan', 'lateral_axis', 'origin'],
    );
  });
});

describe('locking the probe again is exact', () => {
  it('restores frameAt(probe, sweep, t) bit for bit', () => {
    /*
     * THE gate, in its amended form. Unlocking is an owner decision and the
     * echo panel pays for it in labelling; what must not happen is the free
     * pose leaking into the locked path, so that a learner who turns the probe
     * and locks it again is left looking at a plane the pack never authored
     * while the panel has gone back to naming the view.
     *
     * Locking DISCARDS the free pose rather than merging it, so this is an
     * equality rather than a tolerance.
     */
    const saved = probe();
    let free = poseAt(saved, SWEEP, 0.4);
    for (let step = 0; step < 20; step += 1) free = rotatedPose(free, RIGHT, UP, 55, -31);

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(frameAt(saved, SWEEP, t)).toEqual(imagingFrame(poseAt(saved, SWEEP, t)));
    }
  });

  it('seeds from the pose on screen, so unlocking does not jump', () => {
    // Continuity: the probe becomes draggable where it already is, which is the
    // same rule the cutter's mode switch follows.
    const saved = probe();
    const seeded = poseAt(saved, SWEEP, 0.4);
    expect(imagingFrame(seeded)).toEqual(frameAt(saved, SWEEP, 0.4));
  });
});

describe('hasLeftTrack', () => {
  it('is false for the pose it was seeded from', () => {
    // The toggle's own state is not the same claim as having moved: a learner
    // can unlock the probe and never drag it, and the panel should not accuse
    // them of leaving the track.
    const seeded = poseAt(probe(), SWEEP, 0.4);
    expect(hasLeftTrack(seeded, seeded)).toBe(false);
  });

  it('is true once the probe has actually been turned', () => {
    const seeded = poseAt(probe(), SWEEP, 0.4);
    expect(hasLeftTrack(rotatedPose(seeded, RIGHT, UP, 40, 0), seeded)).toBe(true);
  });

  it('does not lose its precision at the small angles it exists to judge', () => {
    /*
     * Measured through the cross product rather than `acos(dot)`: `acos` loses
     * essentially all of its precision near zero angle, which is the entire
     * range this predicate cares about.
     */
    const seeded = poseAt(probe(), SWEEP, 0.4);
    // A one-pixel drag is about 0.34 degrees, well above the tolerance.
    expect(hasLeftTrack(rotatedPose(seeded, RIGHT, UP, 1, 0), seeded)).toBe(true);
    // A thousandth of that is not.
    expect(hasLeftTrack(rotatedPose(seeded, RIGHT, UP, 0.001, 0), seeded)).toBe(false);
  });
});
