/**
 * Probe pose -> imaging frame, and sweep -> pose at scrub position `t`.
 *
 * `contracts/echo-renderer.md`: "The fan geometry comes from the same `probe`
 * the wedge uses. The plane is derived, never stored twice, so wedge and echo
 * cannot disagree." This module is that derivation. Both the echo renderer and
 * viewer-core's wedge read it, so there is exactly one place a plane comes from.
 *
 * The free anatomical cutter is not here and must never be. It is a separate
 * object on a separate data path (`contracts/README.md`).
 */
import type { ProbePose, Sweep } from '../schema/packV0.ts';
import type { Vec3 } from '../schema/primitives.ts';

export type { Vec3 };

/* -------------------------------------------------------------------------- */
/* small vector helpers — local, so the echo module carries no maths dependency */
/* -------------------------------------------------------------------------- */

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len === 0) throw new Error('cannot normalize a zero-length vector');
  return scale(a, 1 / len);
}

/** Rotate `v` about unit axis `axis` by `radians` (Rodrigues). */
export function rotateAbout(v: Vec3, axis: Vec3, radians: number): Vec3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return add(
    add(scale(v, cos), scale(cross(axis, v), sin)),
    scale(axis, dot(axis, v) * (1 - cos)),
  );
}

/* -------------------------------------------------------------------------- */
/* the imaging frame                                                           */
/* -------------------------------------------------------------------------- */

/**
 * An orthonormal frame for one probe pose, plus the fan it images.
 *
 * `beam` and `lateral` span the imaging plane; `normal` is the elevation
 * direction, i.e. the plane's normal. Depths are in **pack model units (mm)**,
 * converted once here from the schema's centimetres so nothing downstream has to
 * remember which unit it is holding.
 */
export interface ImagingFrame {
  origin: Vec3;
  beam: Vec3;
  lateral: Vec3;
  normal: Vec3;
  halfAngleRad: number;
  depthMm: number;
  focusMm: number;
  vertex: 'up' | 'down';
  flipLr: boolean;
  markerSide: 'left' | 'right';
}

/**
 * Derive the imaging frame from a saved probe pose.
 *
 * The schema already guarantees `beam_axis` and `lateral_axis` are unit and
 * orthogonal to a tolerance. Re-orthogonalising here anyway is deliberate: the
 * tolerance is 1e-3, and a basis that is *nearly* orthogonal produces a fan that
 * is *nearly* planar, which shows up as an echo image that disagrees with the
 * wedge by a fraction of a degree. Gram-Schmidt costs nothing and removes the
 * question.
 */
export function imagingFrame(probe: ProbePose): ImagingFrame {
  const beam = normalize(probe.beam_axis as Vec3);
  const lateralRaw = probe.lateral_axis as Vec3;
  const lateral = normalize(sub(lateralRaw, scale(beam, dot(lateralRaw, beam))));
  return {
    origin: probe.origin as Vec3,
    beam,
    lateral,
    normal: cross(beam, lateral),
    halfAngleRad: (probe.fan.angle_deg * Math.PI) / 360,
    depthMm: probe.fan.depth_cm * 10,
    focusMm: probe.fan.focus_cm * 10,
    vertex: probe.display.vertex,
    flipLr: probe.display.flip_lr,
    markerSide: probe.display.marker_side,
  };
}

/**
 * UI-6: the apex up/down toggle, LAYERED ON TOP of the pack's authored default.
 *
 * *(Owner decision, 2026-08-19. It flips the ECHO PANEL only and never the 3D
 * camera: flipping the scene is more disorienting than helpful, and "Match
 * echo" already exists to reconcile the two panels.)*
 *
 * `probe.display.vertex` stays the default and is not replaced — the pack's
 * authored value is a clinical convention, and the paediatric vertex-down
 * default and the PLAX apex-left exception are content rather than preference
 * (`contracts/view-rail-sweep-scrubber.md` rule 6). This inverts it for the
 * learner looking at the panel, and inverting it twice is the authored value
 * back, exactly.
 */
export function withApexFlip(frame: ImagingFrame, flipped: boolean): ImagingFrame {
  if (!flipped) return frame;
  return { ...frame, vertex: frame.vertex === 'down' ? 'up' : 'down' };
}

/**
 * Direction of the scanline at normalised lateral position `u` in [-1, 1],
 * where 0 is the centre of the fan.
 */
export function scanlineDirection(frame: ImagingFrame, u: number): Vec3 {
  const angle = u * frame.halfAngleRad;
  return add(scale(frame.beam, Math.cos(angle)), scale(frame.lateral, Math.sin(angle)));
}

/** World-space point at normalised lateral `u` and depth `r` mm. */
export function samplePoint(frame: ImagingFrame, u: number, rMm: number): Vec3 {
  return add(frame.origin, scale(scanlineDirection(frame, u), rMm));
}

/* -------------------------------------------------------------------------- */
/* sweeps                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The probe pose at scrub position `t` in [0, 1].
 *
 * All three sweep modes are rigid motions of the pose, and two of them are the
 * same motion:
 *
 * * `tilt` and `rotate` both rotate the pose about `axis.direction` through
 *   `axis.origin ?? probe.origin`. They differ only in which axis an author
 *   picks — a tilt uses an axis lying in the imaging plane, a rotation uses the
 *   beam axis — so they share one implementation rather than two that must be
 *   kept in agreement.
 * * `translate` slides the origin along `axis.direction`.
 *
 * **`interpolation` currently selects nothing, and that is a finding, not an
 * oversight.** A sweep in schema v0 turns about a single fixed axis, and for a
 * fixed axis the spherical and linear interpolations of the angle are the same
 * function. The distinction only becomes real for a multi-axis or keyframed
 * pose. Recorded for the schema v1 revision rather than faked here.
 */
export function poseAt(probe: ProbePose, sweep: Sweep, t: number): ProbePose {
  const clamped = Math.min(1, Math.max(0, t));
  const value = sweep.range.from + (sweep.range.to - sweep.range.from) * clamped;

  if (sweep.mode === 'translate') {
    const offset = scale(normalize(sweep.axis.direction as Vec3), value);
    return { ...probe, origin: add(probe.origin as Vec3, offset) };
  }

  const axis = normalize(sweep.axis.direction as Vec3);
  const radians = (value * Math.PI) / 180;
  const pivot = (sweep.axis.origin as Vec3 | undefined) ?? (probe.origin as Vec3);

  return {
    ...probe,
    origin: add(pivot, rotateAbout(sub(probe.origin as Vec3, pivot), axis, radians)),
    beam_axis: rotateAbout(probe.beam_axis as Vec3, axis, radians),
    lateral_axis: rotateAbout(probe.lateral_axis as Vec3, axis, radians),
  };
}

/** Convenience: the imaging frame at scrub position `t`. */
export function frameAt(probe: ProbePose, sweep: Sweep | undefined, t: number): ImagingFrame {
  return imagingFrame(sweep === undefined ? probe : poseAt(probe, sweep, t));
}
