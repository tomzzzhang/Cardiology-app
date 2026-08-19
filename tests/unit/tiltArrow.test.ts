/**
 * The probe's tilt arrow — the direct-manipulation affordance that replaced the
 * "Echo view" drag target.
 *
 * The gate this file exists for is one sentence: **no learner-reachable code
 * path produces a probe pose that is not exactly `frameAt(probe, sweep, t)` for
 * some `t` in [0, 1]**. The arrow is the only new way a learner can move the
 * probe, so it is the only new way that gate can be broken, and the guarantee
 * has to be a property of the arithmetic rather than a claim about the code.
 *
 * It is a property here rather than a spot check because the failure mode is a
 * value at the edge: a `t` of `1 + 1e-9`, or a wrap from 1 back to 0, would
 * render a pose that looks fine and is not on the saved sweep track.
 */
import { describe, expect, it } from 'vitest';
import type { ProbePose, Sweep } from '../../src/schema/packV0.ts';
import { frameAt, imagingFrame, poseAt } from '../../src/echo/probeFrame.ts';
import {
  nearestOnPath,
  pathScreenLength,
  scrubbedT,
  sweepPath,
  sweepWindow,
} from '../../src/viewer/tiltArrow.ts';

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
  range: { from: -15, to: 15, unit: 'mm' },
  interpolation: 'lerp',
} as Sweep;

describe('scrubbedT — the only thing the arrow writes', () => {
  const TANGENT = { x: 1, y: 0 };

  const RATE = 1 / 320;

  it('never leaves [0, 1], for any drag whatever', () => {
    /*
     * THE GATE. `t` outside [0, 1] is a probe pose off the saved sweep track,
     * and `poseAt` clamps internally — so an out-of-range `t` would not throw,
     * it would silently pin the probe at an end while the slider showed
     * something else. Hard-clamped here so the two controls cannot disagree.
     */
    for (const start of [0, 0.001, 0.5, 0.999, 1]) {
      for (const dx of [-1e6, -900, -37, 0, 37, 900, 1e6]) {
        for (const rate of [1, 1 / 40, 1 / 320, 1 / 5000]) {
          const t = scrubbedT(start, TANGENT, dx, 0, rate);
          expect(t).toBeGreaterThanOrEqual(0);
          expect(t).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('stops at the ends rather than wrapping or rubber-banding', () => {
    // Wrapping would send the sweep from its far end back to its near end under
    // a continuing drag, which reads as the probe jumping across the heart.
    expect(scrubbedT(1, TANGENT, 400, 0, RATE)).toBe(1);
    expect(scrubbedT(0, TANGENT, -400, 0, RATE)).toBe(0);
    // And a drag that would overshoot lands exactly on the end, not near it.
    expect(scrubbedT(0.9, TANGENT, 320, 0, RATE)).toBe(1);
  });

  it('depends only on where the drag ended, not on how it got there', () => {
    // Same freeze-the-start rule the cut handles follow: the result must not be
    // a function of the pointer's sampling rate, and dragging back must return.
    const direct = scrubbedT(0.3, TANGENT, 96, 0, RATE);
    let stepped = 0.3;
    for (let step = 1; step <= 32; step += 1) {
      stepped = scrubbedT(0.3, TANGENT, (96 * step) / 32, 0, RATE);
    }
    expect(stepped).toBeCloseTo(direct, 12);
    expect(scrubbedT(0.3, TANGENT, 0, 0, RATE)).toBeCloseTo(0.3, 12);
  });

  it('reads only the drag component along the arrow', () => {
    // A drag across the arrow is not a scrub of it, and must not become one.
    expect(scrubbedT(0.5, { x: 1, y: 0 }, 0, 200, RATE)).toBeCloseTo(0.5, 12);
    expect(scrubbedT(0.5, { x: 0, y: 1 }, 200, 0, RATE)).toBeCloseTo(0.5, 12);
  });

  it('moves the probe at the rate the arrow under the hand depicts', () => {
    // The gain is the drawn window's own rate, so dragging a pixel along the
    // arrow advances the probe by exactly the `t` that pixel of arrow covers,
    // whatever the camera has done to the arrow's size on screen.
    expect(scrubbedT(0.5, TANGENT, 100, 0, 0.44 / 200)).toBeCloseTo(0.72, 12);
    expect(scrubbedT(0.5, TANGENT, 200, 0, 0.44 / 400)).toBeCloseTo(0.72, 12);
  });

  it('refuses a degenerate rate rather than slamming `t` to a bound', () => {
    // An arrow seen exactly end-on projects to nothing, so its window covers no
    // pixels. The gesture is a no-op rather than an infinity.
    expect(scrubbedT(0.4, TANGENT, 200, 0, 0)).toBeCloseTo(0.4, 12);
    expect(scrubbedT(0.4, TANGENT, 200, 0, Number.POSITIVE_INFINITY)).toBeCloseTo(0.4, 12);
  });
});

describe('the arrow cannot reach a pose off the sweep track', () => {
  it('produces only poses that are exactly frameAt(probe, sweep, t)', () => {
    /*
     * The gate, end to end. The arrow's whole output is a `t`; the pose is then
     * built by the same `frameAt` the slider drives. So for every `t` any drag
     * can produce, the resulting frame must be identical — not close — to the
     * one the slider would have produced at that `t`.
     */
    const pose = probe();
    for (const sweep of [TILT, TRANSLATE]) {
      for (const start of [0, 0.25, 0.5, 1]) {
        for (const dx of [-800, -120, -1, 0, 1, 120, 800]) {
          const t = scrubbedT(start, { x: 1, y: 0 }, dx, 0, 1 / 260);
          expect(frameAt(pose, sweep, t)).toEqual(imagingFrame(poseAt(pose, sweep, t)));
        }
      }
    }
  });

  it('traces the path from the sweep itself, not from a drawn arc', () => {
    /*
     * The arrow's shape is sampled from `poseAt`, so it cannot claim a motion
     * the pack does not describe. Checked by rebuilding one sample here: a
     * decorative arc would agree with nothing.
     */
    const pose = probe();
    const path = sweepPath(pose, TILT, 8);
    expect(path).toHaveLength(9);
    for (let i = 0; i <= 8; i += 1) {
      const at = poseAt(pose, TILT, i / 8);
      const origin = at.origin as [number, number, number];
      const beam = at.beam_axis as [number, number, number];
      const beamScale = Math.hypot(...beam);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(path[i][axis]).toBeCloseTo(origin[axis] - (beam[axis] / beamScale) * 34, 9);
      }
    }
  });

  it('is long enough on a tilt to be a control rather than a dot', () => {
    /*
     * A tilt turns the pose about an axis through `probe.origin`, so the
     * arrow's arc radius is the offset's component perpendicular to that axis
     * and a path drawn at the origin would collapse to a point. The clearance
     * behind the transducer is what gives the arrow any length at all.
     */
    const path = sweepPath(probe(), TILT);
    const span = Math.hypot(
      path[path.length - 1][0] - path[0][0],
      path[path.length - 1][1] - path[0][1],
      path[path.length - 1][2] - path[0][2],
    );
    expect(span).toBeGreaterThan(10);
  });

  it('is straight for a translate sweep and curved for a tilt', () => {
    /*
     * Not cosmetic. A curved arrow drawn over a translation would be claiming a
     * rotation the pack does not describe, in an app whose whole stance is that
     * a plausible-looking false claim is worse than an absent one.
     */
    const bend = (points: readonly [number, number, number][]) => {
      const first = points[0];
      const last = points[points.length - 1];
      const mid = points[Math.floor(points.length / 2)];
      const chord = [last[0] - first[0], last[1] - first[1], last[2] - first[2]];
      const toMid = [mid[0] - first[0], mid[1] - first[1], mid[2] - first[2]];
      const chordLength = Math.hypot(...chord) || 1;
      const along = (toMid[0] * chord[0] + toMid[1] * chord[1] + toMid[2] * chord[2])
        / (chordLength * chordLength);
      return Math.hypot(
        toMid[0] - chord[0] * along, toMid[1] - chord[1] * along, toMid[2] - chord[2] * along,
      );
    };
    expect(bend(sweepPath(probe(), TRANSLATE))).toBeCloseTo(0, 6);
    expect(bend(sweepPath(probe(), TILT))).toBeGreaterThan(1);
  });
});

describe('sweepWindow — the stretch of track the arrow rides', () => {
  it('never names a position the sweep does not reach', () => {
    /*
     * The same gate as `scrubbedT`, on the drawing side. The arrow is sampled
     * from `poseAt` over this window, so a window reaching past [0, 1] would
     * DRAW the probe somewhere the saved sweep never puts it — a picture of an
     * unvetted pose, which is exactly the kind of plausible false claim this
     * project refuses elsewhere.
     */
    for (const t of [-5, 0, 0.01, 0.5, 0.99, 1, 5, Number.NaN]) {
      const window = sweepWindow(t);
      expect(window.from).toBeGreaterThanOrEqual(0);
      expect(window.to).toBeLessThanOrEqual(1);
      expect(window.to).toBeGreaterThanOrEqual(window.from);
    }
  });

  it('slides with the probe rather than covering the whole track', () => {
    // What makes the arrow ride the transducer: at different scrub positions it
    // is a different piece of the trajectory.
    const early = sweepWindow(0.2);
    const late = sweepWindow(0.8);
    expect(late.from).toBeGreaterThan(early.to - 1e-9);
    expect(early.to - early.from).toBeLessThan(0.6);
  });

  it('shortens at the ends, saying the same thing the dimmed head says', () => {
    expect(sweepWindow(0).from).toBe(0);
    expect(sweepWindow(1).to).toBe(1);
    expect(sweepWindow(0).to - sweepWindow(0).from)
      .toBeLessThan(sweepWindow(0.5).to - sweepWindow(0.5).from);
  });
});

describe('hit-testing the arrow on screen', () => {
  const PATH = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 },
  ];

  it('measures to the segments, not to the vertices', () => {
    /*
     * At 48 samples across a wide sweep the vertices are tens of pixels apart,
     * so a vertex-only test reports the pointer as far from a line it is
     * sitting exactly on — and the arrow becomes a control that only responds
     * at 48 discrete spots.
     */
    expect(nearestOnPath(PATH, 50, 0)!.distancePx).toBeCloseTo(0, 9);
    expect(nearestOnPath(PATH, 50, 12)!.distancePx).toBeCloseTo(12, 9);
  });

  it('reports the direction of increasing t at the closest point', () => {
    expect(nearestOnPath(PATH, 50, 3)!.tangent).toEqual({ x: 1, y: 0 });
    expect(nearestOnPath(PATH, 103, 50)!.tangent).toEqual({ x: 0, y: 1 });
  });

  it('has nothing to say about a path with fewer than two points', () => {
    // Which is the case when the arrow is entirely behind the camera.
    expect(nearestOnPath([], 0, 0)).toBeNull();
    expect(nearestOnPath([{ x: 1, y: 1 }], 0, 0)).toBeNull();
  });

  it('sums the on-screen length the drag is scaled by', () => {
    expect(pathScreenLength(PATH)).toBeCloseTo(200, 9);
    expect(pathScreenLength([])).toBe(0);
  });
});
