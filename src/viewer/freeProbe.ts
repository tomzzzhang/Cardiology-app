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
 * alternative — rendering an arbitrary plane under a saved view's name — is
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
import { cross, dot, imagingFrame, normalize, rotateAbout, scale, add } from '../echo/probeFrame.ts';

/**
 * The three ways a transducer turns, named for what they do to the image.
 *
 * These are the probe's OWN axes, not the camera's, and that is the point: each
 * one is a motion a sonographer performs and a learner has to be able to name,
 * and none of them means anything in screen coordinates. A drag cannot express
 * them — it has two degrees of freedom and no way to say which of three axes it
 * meant — which is why the unlocked probe is driven by buttons.
 *
 * * **fan** — turn about the LATERAL axis. The beam swings out of the current
 *   imaging plane, sweeping the plane through the heart. This is the motion a
 *   view's `sweep` performs, so it is what the pad's fan buttons do when the
 *   probe is locked.
 * * **aim** — turn about the ELEVATION NORMAL. The beam swings within the
 *   imaging plane, which is left exactly where it was: same plane, different
 *   part of it under the fan.
 * * **rotate** — roll about the BEAM axis. The imaging plane turns about the
 *   beam, which is how a four-chamber becomes a two-chamber.
 *
 * Each preserves exactly one axis of the frame — `fan` the lateral, `aim` the
 * normal, `rotate` the beam — and those three invariants are what the tests
 * pin, because "the plane is unchanged" is a claim about geometry rather than
 * about the code that produced it.
 */
export type ProbeAxis = 'fan' | 'aim' | 'rotate';

/**
 * Degrees per press.
 *
 * Small, because the buttons repeat while held: a step coarse enough to be
 * quick to click is too coarse to settle on a plane with. Roughly 40 degrees a
 * second on a held button, which crosses a whole sweep range in about one.
 */
export const NUDGE_DEG = 2;

/**
 * Millimetres per press of the stand-off buttons, and how far they may go.
 *
 * Moving the probe ALONG ITS BEAM is the one translation offered, and it is a
 * different thing from sliding it across the chest. Sliding claims a different
 * acoustic window — which window a view uses is authored content, and a learner
 * who could slide the probe could claim a window nobody chose. Moving along the
 * beam only changes how far the transducer stands off the tissue, which on this
 * substrate is a gap in empty space to begin with: the mesh is heart-only, so
 * there is no skin, fat, intercostal muscle or pericardium between the probe
 * and the epicardium. The pipeline parks the transducer `STAND_OFF_MM` = 8 mm
 * clear of the epicardial surface and says so in every placement landmark.
 *
 * Bounded because an unbounded one lets the probe be pushed through the heart
 * and out the far side, or pulled until the sector no longer reaches anything —
 * both of which render something, neither of which teaches anything.
 */
export const STANDOFF_STEP_MM = 2;
export const STANDOFF_LIMIT_MM = 60;

/**
 * How close the transducer may come to tissue, and how far it may retreat, in
 * pack units (mm).
 *
 * The near stop keeps the probe OUT of the heart. This substrate has no chest
 * wall, so nothing but this number stops the aperture being pushed through the
 * epicardium and imaging from inside a ventricle — which renders something
 * perfectly plausible and teaches the opposite of the truth. The far stop keeps
 * the sector on the heart at all.
 *
 * Measured against the model SURFACE rather than against the authored pose, so
 * both mean the same thing on every view: how far a window stands off the
 * epicardium differs per view, and a bound measured from the pose would sit
 * inside the heart on one and nowhere near it on another.
 */
export const MIN_CLEARANCE_MM = 3;
export const MAX_CLEARANCE_MM = 70;

/** How far outside the allowed band a clearance is. Zero inside it. */
export function bandViolationMm(clearanceMm: number): number {
  if (clearanceMm < MIN_CLEARANCE_MM) return MIN_CLEARANCE_MM - clearanceMm;
  if (clearanceMm > MAX_CLEARANCE_MM) return clearanceMm - MAX_CLEARANCE_MM;
  return 0;
}

/**
 * Whether one press of the stand-off pair may go from one clearance to another.
 *
 * **The stops are barriers, not a trap, and they were a trap.** The rule was
 * "the result must be inside the band", which is right while the probe starts
 * inside it and wrong the moment it does not: from outside, every move lands
 * outside, so every move is refused and both buttons go dead with no way back.
 * That could not happen while the only poses on offer were authored ones, which
 * sit inside the band by construction. It happens the first time a pose is
 * placed from outside — an anchored pose parks the transducer at the derived
 * standoff, which is further out than any authored pose in this repository.
 *
 * So a move is allowed if it lands inside the band, or if it REDUCES how far
 * outside the band the probe is. The stop still cannot be crossed; it can now
 * be retreated from.
 *
 * An unmeasurable clearance — no model yet, or a pose the surface sample cannot
 * reach — allows the move. A stop that cannot be computed must not become a
 * silent refusal.
 */
export function standOffStepAllowed(
  beforeMm: number | undefined, afterMm: number | undefined,
): boolean {
  if (afterMm === undefined || !Number.isFinite(afterMm)) return true;
  if (bandViolationMm(afterMm) === 0) return true;
  if (beforeMm === undefined || !Number.isFinite(beforeMm)) return true;
  return bandViolationMm(afterMm) < bandViolationMm(beforeMm);
}

/**
 * Turn a probe pose about one of its own axes, by a signed angle in degrees.
 *
 * **The origin is held fixed.** A transducer pivots where it sits, so unlocking
 * the ANGLE does not also slide the probe through the chest wall. Translation
 * is deliberately not offered: probe POSITIONS are authored content — a view
 * says where on the chest the window is — and letting a learner slide the probe
 * would let them claim a window nobody chose. If it is ever wanted it is a
 * separate motion with a separate justification.
 *
 * The rotation is applied to the pose it is handed and the result is returned;
 * nothing is mutated. Pressing a button and pressing the opposite button
 * returns the probe to where it was, to floating-point.
 */
export function nudgedPose(start: ProbePose, axis: ProbeAxis, degrees: number): ProbePose {
  const frame = imagingFrame(start);
  const about: Vec3 = axis === 'fan' ? frame.lateral
    : axis === 'aim' ? frame.normal
    : frame.beam;
  const radians = (degrees * Math.PI) / 180;

  const beam = normalize(rotateAbout(frame.beam, about, radians));
  const turned = rotateAbout(frame.lateral, about, radians);
  /*
   * Re-orthogonalise against the new beam. Two rotations of two vectors are
   * exact in theory and drift in floating point over a held button, and a basis
   * that is only nearly orthogonal produces a fan that is only nearly planar —
   * the same defect `imagingFrame` re-orthogonalises the authored axes against.
   */
  const lateral = normalize(sub(turned, scale(beam, dot(turned, beam))));

  return { ...start, beam_axis: beam, lateral_axis: lateral };
}

/**
 * Slide the probe along its own beam, toward or away from the tissue.
 *
 * The orientation is untouched — this is the stand-off, not an angle — and the
 * caller is responsible for the bound, because `STANDOFF_LIMIT_MM` is measured
 * against the pose the VIEW authored and this module cannot see a view.
 */
export function movedAlongBeam(start: ProbePose, mm: number): ProbePose {
  const frame = imagingFrame(start);
  return { ...start, origin: add(start.origin as Vec3, scale(frame.beam, mm)) };
}

/**
 * How far a pose stands off the one the view authored, along the beam.
 *
 * Signed: positive is closer to the tissue, negative is lifted away. Measured
 * along the AUTHORED beam rather than the current one, so the number means the
 * same thing after the probe has been turned as before.
 */
export function beamOffsetMm(pose: ProbePose, authored: ProbePose): number {
  return dot(
    sub(pose.origin as Vec3, authored.origin as Vec3),
    imagingFrame(authored).beam,
  );
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
export function hasLeftTrack(
  free: ProbePose, onTrack: ProbePose, toleranceDeg = 0.05, toleranceMm = 0.05,
): boolean {
  /*
   * POSITION as well as orientation. The stand-off buttons move the origin and
   * leave the axes alone, so an orientation-only test would let a learner push
   * the probe through the chest wall while the panel went on calling the image
   * by the view's name — which is precisely the claim the label exists to
   * withdraw.
   */
  const moved = Math.hypot(...sub(free.origin as Vec3, onTrack.origin as Vec3));
  if (moved > toleranceMm) return true;

  const beamAngle = angleBetween(free.beam_axis as Vec3, onTrack.beam_axis as Vec3);
  const lateralAngle = angleBetween(free.lateral_axis as Vec3, onTrack.lateral_axis as Vec3);
  return Math.max(beamAngle, lateralAngle) > (toleranceDeg * Math.PI) / 180;
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
