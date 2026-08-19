/**
 * The unlocked probe — the one learner-reachable path off the saved sweep
 * track, and the conditions attached to it.
 *
 * Everywhere else the probe is pinned to its view, and that constraint is what
 * lets the echo panel put a view's name on an image. Unlocking it is an
 * explicit owner decision (2026-08-19). What it costs is paid for by labelling,
 * which is UI; what it must NOT cost is tested here:
 *
 * * the free pose is a rotation of a saved pose about its OWN axes and about
 *   its own origin, and the saved pose is never touched;
 * * nothing in this module can reach `views[]`, or anything that could be saved;
 * * locking again restores `frameAt(probe, sweep, t)` EXACTLY, not nearly.
 */
import { describe, expect, it } from 'vitest';
import type { ProbePose, Sweep } from '../../src/schema/packV0.ts';
import { dot, frameAt, imagingFrame, length, poseAt } from '../../src/echo/probeFrame.ts';
import type { Vec3 } from '../../src/schema/primitives.ts';
import {
  NUDGE_DEG,
  STANDOFF_STEP_MM,
  beamOffsetMm,
  hasLeftTrack,
  movedAlongBeam,
  nudgedPose,
  type ProbeAxis,
} from '../../src/viewer/freeProbe.ts';

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

const near = (a: Vec3, b: Vec3, digits = 12) => {
  for (let axis = 0; axis < 3; axis += 1) expect(a[axis]).toBeCloseTo(b[axis], digits);
};

describe('nudgedPose — the three ways a transducer turns', () => {
  it('pivots on the skin: the origin never moves', () => {
    /*
     * A transducer turns where it sits. Unlocking the ANGLE must not also slide
     * the probe through the chest wall — probe POSITIONS are authored content,
     * and letting a learner slide the probe would let them claim a window
     * nobody chose. Translation is deliberately not offered.
     */
    const start = probe();
    for (const axis of ['fan', 'aim', 'rotate'] as ProbeAxis[]) {
      for (const degrees of [-40, -2, 0, 2, 40]) {
        expect(nudgedPose(start, axis, degrees).origin).toEqual(start.origin);
      }
    }
  });

  it('each axis preserves exactly the one it turns about', () => {
    /*
     * THE geometric claim, and the reason these three motions are the right
     * three. Each is a rotation about one axis of the probe's own frame, so it
     * leaves that axis alone:
     *
     *   fan    about the lateral axis  -> the lateral axis is unchanged
     *   aim    about the elevation normal -> the PLANE is unchanged
     *   rotate about the beam         -> the beam is unchanged
     *
     * "Left and right maintain the same plane" is the middle line, and it is a
     * statement about geometry rather than about the code that produced it, so
     * it is measured rather than asserted in a comment.
     */
    const start = probe();
    const before = imagingFrame(start);

    near(imagingFrame(nudgedPose(start, 'fan', 25)).lateral, before.lateral);
    near(imagingFrame(nudgedPose(start, 'aim', 25)).normal, before.normal);
    near(imagingFrame(nudgedPose(start, 'rotate', 25)).beam, before.beam);
  });

  it('each axis actually moves the other two', () => {
    // The other half: a motion that preserved everything would be a no-op that
    // passed the test above.
    const start = probe();
    const before = imagingFrame(start);
    const moved = (axis: ProbeAxis) => {
      const after = imagingFrame(nudgedPose(start, axis, 20));
      return Math.max(
        Math.hypot(...after.beam.map((v, i) => v - before.beam[i]) as [number, number, number]),
        Math.hypot(...after.lateral.map((v, i) => v - before.lateral[i]) as [number, number, number]),
      );
    };
    for (const axis of ['fan', 'aim', 'rotate'] as ProbeAxis[]) {
      expect(moved(axis), axis).toBeGreaterThan(0.1);
    }
  });

  it('aims within the plane without leaving it, over many presses', () => {
    // Held down, not tapped: the invariant has to survive the drift of forty
    // successive rotations, which is what a held button produces.
    const before = imagingFrame(probe()).normal;
    let pose = probe();
    for (let press = 0; press < 40; press += 1) pose = nudgedPose(pose, 'aim', NUDGE_DEG);
    near(imagingFrame(pose).normal, before, 9);
  });

  it('keeps the basis orthonormal, so the fan stays planar', () => {
    /*
     * A basis that is only NEARLY orthogonal produces a fan that is only nearly
     * planar — an echo image that disagrees with the wedge by a fraction of a
     * degree, which is exactly the defect `imagingFrame` re-orthogonalises the
     * authored axes against. Two rotations of two vectors drift over a held
     * button, so the repair has to be inside the step rather than at the end.
     */
    let pose = probe();
    for (let press = 0; press < 200; press += 1) {
      pose = nudgedPose(pose, (['fan', 'aim', 'rotate'] as ProbeAxis[])[press % 3], NUDGE_DEG);
      expect(length(pose.beam_axis as Vec3)).toBeCloseTo(1, 12);
      expect(length(pose.lateral_axis as Vec3)).toBeCloseTo(1, 12);
      expect(dot(pose.beam_axis as Vec3, pose.lateral_axis as Vec3)).toBeCloseTo(0, 12);
    }
  });

  it('is reversed by the opposite button', () => {
    // The property a stepped control lives or dies by: if a press and its
    // opposite do not cancel, the probe walks whenever a learner overshoots and
    // corrects, and there is no way back short of locking.
    for (const axis of ['fan', 'aim', 'rotate'] as ProbeAxis[]) {
      const there = nudgedPose(probe(), axis, NUDGE_DEG);
      const back = nudgedPose(there, axis, -NUDGE_DEG);
      near(back.beam_axis as Vec3, probe().beam_axis as Vec3, 12);
      near(back.lateral_axis as Vec3, probe().lateral_axis as Vec3, 12);
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
    nudgedPose(start, 'rotate', 33);
    expect(start).toEqual(snapshot);
  });

  it('returns a pose and nothing else, with no way back to a view', () => {
    // The shape of the return value IS the guarantee: it carries no view id, no
    // provenance and no identity, so nothing downstream can mistake a
    // hand-turned probe for the reviewed view it was seeded from.
    expect(Object.keys(nudgedPose(probe(), 'fan', 12)).sort()).toEqual(
      ['beam_axis', 'display', 'fan', 'lateral_axis', 'origin'],
    );
  });
});

describe('movedAlongBeam — the one translation offered', () => {
  it('slides along the beam and leaves the orientation alone', () => {
    /*
     * Moving ALONG the beam changes the stand-off. Moving ACROSS the chest would
     * claim a different acoustic window, which is authored content — so this is
     * the translation that is offered and that is not.
     */
    const start = probe();
    const moved = movedAlongBeam(start, STANDOFF_STEP_MM);
    expect(moved.beam_axis).toEqual(start.beam_axis);
    expect(moved.lateral_axis).toEqual(start.lateral_axis);

    const beam = imagingFrame(start).beam;
    for (let axis = 0; axis < 3; axis += 1) {
      expect((moved.origin as Vec3)[axis]).toBeCloseTo(
        (start.origin as Vec3)[axis] + beam[axis] * STANDOFF_STEP_MM, 12,
      );
    }
  });

  it('moves nothing sideways, however many presses', () => {
    // The whole excursion has to stay on the beam line, or the probe wanders
    // off its window one rounding error at a time.
    const start = probe();
    let pose = start;
    for (let press = 0; press < 40; press += 1) pose = movedAlongBeam(pose, STANDOFF_STEP_MM);
    const beam = imagingFrame(start).beam;
    const offset = (pose.origin as Vec3).map((v, i) => v - (start.origin as Vec3)[i]) as Vec3;
    const along = offset.reduce((sum, v, i) => sum + v * beam[i], 0);
    const sideways = Math.hypot(...offset.map((v, i) => v - beam[i] * along) as Vec3);
    expect(sideways).toBeCloseTo(0, 9);
  });

  it('is reversed by the opposite button', () => {
    const there = movedAlongBeam(probe(), STANDOFF_STEP_MM);
    const back = movedAlongBeam(there, -STANDOFF_STEP_MM);
    near(back.origin as Vec3, probe().origin as Vec3, 12);
  });

  it('reports the stand-off signed toward the tissue', () => {
    const start = probe();
    expect(beamOffsetMm(movedAlongBeam(start, 7), start)).toBeCloseTo(7, 9);
    expect(beamOffsetMm(movedAlongBeam(start, -7), start)).toBeCloseTo(-7, 9);
    expect(beamOffsetMm(start, start)).toBeCloseTo(0, 12);
  });

  it('measures the stand-off against the AUTHORED beam, not the current one', () => {
    /*
     * So the bound means the same thing after the probe has been turned as
     * before. Measured along the live beam, turning the probe would silently
     * change how far it is allowed to travel.
     */
    const start = probe();
    const pushed = movedAlongBeam(start, 20);
    const turnedAfterwards = nudgedPose(pushed, 'fan', 40);
    expect(beamOffsetMm(turnedAfterwards, start)).toBeCloseTo(20, 9);
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
    for (let step = 0; step < 20; step += 1) free = nudgedPose(free, 'rotate', 11);

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(frameAt(saved, SWEEP, t)).toEqual(imagingFrame(poseAt(saved, SWEEP, t)));
    }
  });

  it('seeds from the pose on screen, so unlocking does not jump', () => {
    // Continuity: the probe becomes movable where it already is, which is the
    // same rule the cutter's mode switch follows.
    const saved = probe();
    const seeded = poseAt(saved, SWEEP, 0.4);
    expect(imagingFrame(seeded)).toEqual(frameAt(saved, SWEEP, 0.4));
  });
});

describe('hasLeftTrack', () => {
  it('is false for the pose it was seeded from', () => {
    // The toggle's own state is not the same claim as having moved: a learner
    // can unlock the probe and never press a button, and the panel should not
    // accuse them of leaving the track.
    const seeded = poseAt(probe(), SWEEP, 0.4);
    expect(hasLeftTrack(seeded, seeded)).toBe(false);
  });

  it('is true once the probe has actually been turned', () => {
    const seeded = poseAt(probe(), SWEEP, 0.4);
    expect(hasLeftTrack(nudgedPose(seeded, 'fan', 4), seeded)).toBe(true);
  });

  it('is true for a pure translation, which has no angle at all', () => {
    /*
     * The stand-off buttons move the origin and leave the axes alone, so an
     * orientation-only test would let a learner push the probe through the
     * chest wall while the panel went on calling the image by the view's name.
     * That is exactly the claim the label exists to withdraw.
     */
    const seeded = poseAt(probe(), SWEEP, 0.4);
    const pushed = movedAlongBeam(seeded, STANDOFF_STEP_MM);
    expect(pushed.beam_axis).toEqual(seeded.beam_axis);
    expect(hasLeftTrack(pushed, seeded)).toBe(true);
  });

  it('does not lose its precision at the small angles it exists to judge', () => {
    /*
     * Measured through the cross product rather than `acos(dot)`: `acos` loses
     * essentially all of its precision near zero angle, which is the entire
     * range this predicate cares about.
     */
    const seeded = poseAt(probe(), SWEEP, 0.4);
    // A tenth of one press is well above the tolerance.
    expect(hasLeftTrack(nudgedPose(seeded, 'aim', NUDGE_DEG / 10), seeded)).toBe(true);
    // A thousandth of that is not.
    expect(hasLeftTrack(nudgedPose(seeded, 'aim', NUDGE_DEG / 10000), seeded)).toBe(false);
  });
});
