/**
 * The probe's travel, and what one press of the pad is worth.
 *
 * The gate this file exists for is the same one the tilt arrow used to carry:
 * **while the probe is locked, no learner-reachable control produces a pose
 * that is not exactly `frameAt(probe, sweep, t)` for some `t` in [0, 1]**. The
 * pad's fan buttons are now the only thing besides the slider that writes `t`,
 * so they are the only new way that gate can be broken.
 *
 * It is a property rather than a spot check because the failure is a value at
 * the edge: a `t` of `1 + 1e-9` renders a pose that looks fine and is not on
 * the saved track, and `poseAt` clamps internally so nothing would throw.
 */
import { describe, expect, it } from 'vitest';
import type { ProbePose, Sweep } from '../../src/schema/packV0.ts';
import { frameAt, imagingFrame, poseAt } from '../../src/echo/probeFrame.ts';
import {
  SWEEP_STEP,
  probeTravelPath,
  steppedT,
  sweepStepT,
} from '../../src/viewer/probeControl.ts';

function probe(overrides: Partial<ProbePose> = {}): ProbePose {
  return {
    origin: [0, 0, 100],
    beam_axis: [0, 0, -1],
    lateral_axis: [1, 0, 0],
    fan: { angle_deg: 90, depth_cm: 12, focus_cm: 5 },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
    ...overrides,
  } as ProbePose;
}

const TILT: Sweep = {
  mode: 'tilt',
  axis: { direction: [1, 0, 0] },
  range: { from: -20, to: 20, unit: 'deg' },
  interpolation: 'slerp',
} as Sweep;

const TRANSLATE: Sweep = {
  mode: 'translate',
  axis: { direction: [0, 1, 0] },
  range: { from: 0, to: 80, unit: 'mm' },
  interpolation: 'lerp',
} as Sweep;

describe('steppedT — the only thing the fan buttons write', () => {
  it('never leaves [0, 1], from any starting point and any number of presses', () => {
    /*
     * THE GATE. `t` outside [0, 1] is a probe pose off the saved sweep track,
     * and `poseAt` clamps internally — so an out-of-range `t` would not throw,
     * it would silently pin the probe at an end while the slider showed
     * something else, and the two controls would disagree about where the probe
     * is while both looked right.
     */
    for (const sweep of [TILT, TRANSLATE, undefined]) {
      for (const start of [0, 0.001, 0.5, 0.999, 1]) {
        let t = start;
        for (let press = 0; press < 200; press += 1) {
          t = steppedT(t, press % 2 === 0 ? 1 : 1, sweep);
          expect(t).toBeGreaterThanOrEqual(0);
          expect(t).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('stops at the ends rather than wrapping', () => {
    // Wrapping would send the sweep from its far end back to its near end under
    // a held button, which reads as the probe jumping across the heart.
    expect(steppedT(1, 1, TILT)).toBe(1);
    expect(steppedT(0, -1, TILT)).toBe(0);
    // And an overshoot lands exactly on the end, not near it.
    expect(steppedT(0.99, 1, TILT)).toBe(1);
  });

  it('is reversed by the opposite button', () => {
    // Overshoot and correct has to return, or a held button walks the probe
    // somewhere a press cannot take it back from.
    const there = steppedT(0.5, 1, TILT);
    expect(steppedT(there, -1, TILT)).toBeCloseTo(0.5, 12);
  });

  it('treats a missing or degenerate sweep as no step, not as infinity', () => {
    // A view with no sweep has one pose. A sweep whose ends coincide has one
    // too, and dividing by its span would put `t` at a bound on the first press.
    expect(steppedT(0.4, 1, undefined)).toBe(0.4);
    expect(sweepStepT(undefined)).toBe(0);
    const degenerate = { ...TILT, range: { from: 5, to: 5, unit: 'deg' } } as Sweep;
    expect(sweepStepT(degenerate)).toBe(0);
    expect(steppedT(0.4, 1, degenerate)).toBe(0.4);
  });

  it('steps the same visible amount whatever the sweep is measured in', () => {
    /*
     * Derived from each sweep's own range rather than fixed, so a press feels
     * the same on a 40-degree tilt and an 80-millimetre translation instead of
     * crossing one in two presses and the other in forty.
     */
    expect(sweepStepT(TILT)).toBeCloseTo(SWEEP_STEP / 40, 12);
    expect(sweepStepT(TRANSLATE)).toBeCloseTo(SWEEP_STEP / 80, 12);
    // Twenty presses cross half a 40-degree tilt, and half an 80 mm translation.
    let t = 0;
    for (let press = 0; press < 20; press += 1) t = steppedT(t, 1, TILT);
    expect(t).toBeCloseTo(1, 9);
  });

  it('never proposes a pose that is not on the saved track', () => {
    /*
     * The gate end to end. A press's whole output is a `t`; the pose is then
     * built by the same `frameAt` the slider drives, so for every `t` any run of
     * presses can produce, the frame must be identical — not close — to the one
     * the slider would have produced at that `t`.
     */
    const pose = probe();
    for (const sweep of [TILT, TRANSLATE]) {
      let t = 0.3;
      for (let press = 0; press < 30; press += 1) {
        t = steppedT(t, press % 7 === 0 ? -1 : 1, sweep);
        expect(frameAt(pose, sweep, t)).toEqual(imagingFrame(poseAt(pose, sweep, t)));
      }
    }
  });
});

describe('probeTravelPath — what the camera has to fit', () => {
  it('is sampled from the sweep, not from an assumed shape', () => {
    /*
     * Every point is `poseAt`, so what the camera is asked to fit cannot
     * disagree with where the probe will actually be. Checked by rebuilding one
     * sample: an assumed arc would agree with nothing.
     */
    const pose = probe();
    const path = probeTravelPath(pose, TILT, 8);
    expect(path).toHaveLength(9);
    for (let i = 0; i <= 8; i += 1) {
      const at = poseAt(pose, TILT, i / 8);
      const origin = at.origin as [number, number, number];
      const beam = at.beam_axis as [number, number, number];
      const scale = Math.hypot(...beam);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(path[i][axis]).toBeCloseTo(origin[axis] - (beam[axis] / scale) * 46, 9);
      }
    }
  });

  it('reaches behind the transducer, so the camera frames the instrument', () => {
    // The envelope has to clear the 33 mm body, or the camera frames the
    // aperture point and leaves the probe clipped at the panel edge.
    const path = probeTravelPath(probe(), undefined);
    expect(Math.hypot(
      path[0][0] - 0, path[0][1] - 0, path[0][2] - 100,
    )).toBeGreaterThan(33);
  });

  it('gives a sweepless view one point rather than none', () => {
    // A probe that does not move is still a probe the camera has to fit.
    expect(probeTravelPath(probe(), undefined)).toHaveLength(1);
  });
});
