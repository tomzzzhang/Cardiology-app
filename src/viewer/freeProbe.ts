/**
 * The unlocked probe: a runtime rotation of a saved pose, off the sweep track.
 *
 * ## What this deliberately gives up, and what it does not
 *
 * Everywhere else in this app the probe is pinned to its view: every reachable
 * pose is `frameAt(probe, sweep, t)` for some `t` in [0, 1], so a learner can
 * only ever see planes an author chose. That constraint is what lets the echo
 * panel put a view's name on an image.
 *
 * Unlocking it is an explicit owner decision, taken on 2026-08-19, and it is
 * paid for by LABELLING rather than by hiding: while the probe is free the echo
 * panel stops claiming to be the saved view and says so on the image. The
 * alternative — rendering an arbitrary plane under a vetted view's name — is
 * exactly the failure the pack's refusal to author A3 and A4 exists to avoid,
 * and it is the one thing that stays forbidden.
 *
 * What does NOT change, and is not a UI question:
 *
 * * **Nothing here can write to `views[]`.** This module takes a `ProbePose`
 *   and returns a `ProbePose`. It cannot see the pack, the view, or anything
 *   that could be saved. The free pose lives in React state and dies with the
 *   session.
 * * **Locking again is exact.** The free pose is discarded, not merged, so the
 *   probe returns to `frameAt(probe, sweep, t)` for the `t` the scrubber holds
 *   — bit for bit, not approximately.
 * * The cutter still reads the probe and never the reverse.
 */
import type { ProbePose } from '../schema/packV0.ts';
import type { Vec3 } from '../schema/primitives.ts';
import { cross, dot, normalize, rotateAbout, scale, add } from '../echo/probeFrame.ts';

/** Radians of probe rotation per pixel of drag. */
export const PROBE_RADIANS_PER_PIXEL = 0.006;

/**
 * Turn a probe pose by a screen drag, about its own origin.
 *
 * The origin is held fixed: a transducer pivots on the skin, so unlocking the
 * ANGLE should not also slide the probe through the chest wall. Sliding it is a
 * separate motion and is not offered.
 *
 * Same freeze-the-start rule the cut handles and the tilt arrow follow — the
 * rotation is applied to the pose the gesture STARTED with, from the drag's
 * total offset — so the result does not depend on the pointer's sampling rate
 * and dragging back returns the probe.
 *
 * Signs are chosen so the probe's nose follows the hand: dragging right swings
 * the beam right, dragging down tips it down. Rotating the beam about the
 * camera's up by a positive angle carries it LEFT, so both angles are negated.
 */
export function rotatedPose(
  start: ProbePose,
  cameraRight: Vec3,
  cameraUp: Vec3,
  totalDx: number,
  totalDy: number,
  radiansPerPixel = PROBE_RADIANS_PER_PIXEL,
): ProbePose {
  const up = normalize(cameraUp);
  const right = normalize(cameraRight);

  const turn = (vector: Vec3): Vec3 =>
    rotateAbout(
      rotateAbout(vector, right, -totalDy * radiansPerPixel),
      up,
      -totalDx * radiansPerPixel,
    );

  const beam = normalize(turn(start.beam_axis as Vec3));
  const turned = turn(start.lateral_axis as Vec3);
  /*
   * Re-orthogonalise against the new beam. Two successive rotations of two
   * vectors are exact in theory and drift in floating point, and a basis that
   * is only nearly orthogonal produces a fan that is only nearly planar — the
   * same defect `imagingFrame` re-orthogonalises the authored axes against.
   */
  const lateral = normalize(sub(turned, scale(beam, dot(turned, beam))));

  return { ...start, beam_axis: beam, lateral_axis: lateral };
}

/** Local subtraction, so this module does not widen `probeFrame`'s surface. */
function sub(a: Vec3, b: Vec3): Vec3 {
  return add(a, scale(b, -1));
}

/**
 * Whether a pose has left the track its view saved.
 *
 * Used for the label, and only for the label: the panel has to say "this is not
 * the saved view" exactly when it is true, and a toggle's own state is not the
 * same claim — a learner can turn the toggle on and never drag.
 */
export function hasLeftTrack(free: ProbePose, onTrack: ProbePose, toleranceDeg = 0.05): boolean {
  const beamAngle = angleBetween(free.beam_axis as Vec3, onTrack.beam_axis as Vec3);
  const lateralAngle = angleBetween(free.lateral_axis as Vec3, onTrack.lateral_axis as Vec3);
  const limit = (toleranceDeg * Math.PI) / 180;
  return Math.max(beamAngle, lateralAngle) > limit;
}

function angleBetween(a: Vec3, b: Vec3): number {
  const unitA = normalize(a);
  const unitB = normalize(b);
  // Via the cross product rather than acos(dot): acos loses all its precision
  // near zero angle, which is the whole range this predicate cares about.
  return Math.atan2(
    Math.hypot(...cross(unitA, unitB)),
    dot(unitA, unitB),
  );
}
