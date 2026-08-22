/**
 * A visual transition between two saved probe poses.
 *
 * These intermediate poses are presentation only: they are never saved,
 * exported, named as views, or written into a pack. The endpoint remains the
 * exact stored `ProbePose`; the path merely lets the wedge and simulated echo
 * explain how one authored plane turns into another.
 */
import * as THREE from 'three';
import type { ProbePose } from '../schema/packV0.ts';
import { imagingFrame } from '../echo/probeFrame.ts';
import {
  AUTHORING_GLIDE_MS,
  authoringGlideEasing,
  shortestTarget,
} from './orbit.ts';

const FRAME_X = new THREE.Vector3(1, 0, 0);
const FRAME_Z = new THREE.Vector3(0, 0, 1);
const DIRECTION_EPSILON_SQ = 1e-18;

const mix = (from: number, to: number, t: number) => from + (to - from) * t;

const transitionProgress = (elapsed: number, duration: number) =>
  duration <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / duration));

const sameDisplay = (from: ProbePose['display'], to: ProbePose['display']) =>
  from.vertex === to.vertex
  && from.flip_lr === to.flip_lr
  && from.marker_side === to.marker_side;

export interface EchoDisplayHandoff {
  /** Which categorical display convention the echo renderer should use now. */
  display: ProbePose['display'];
  /** Opacity for the echo canvas at this same transition instant, in [0, 1]. */
  opacity: number;
  /** Useful to a consumer deciding whether an opacity style is necessary at all. */
  changed: boolean;
  phase: 'source' | 'target';
}

/**
 * One-clock handoff for display flags that cannot be interpolated.
 *
 * `vertex`, `flip_lr`, and `marker_side` are categories rather than geometry.
 * Fading the echo to zero at the exact instant they switch makes the otherwise
 * discontinuous raster transform invisible. Unchanged conventions remain fully
 * opaque throughout. The helper is deliberately time-based rather than stateful
 * so the camera, pose, and echo can all ask the same clock the same question.
 */
export function echoDisplayHandoff(
  from: ProbePose['display'],
  to: ProbePose['display'],
  elapsed: number,
  duration = AUTHORING_GLIDE_MS,
): EchoDisplayHandoff {
  const progress = transitionProgress(elapsed, duration);
  if (progress <= 0) {
    return {
      display: structuredClone(from), opacity: 1, changed: !sameDisplay(from, to), phase: 'source',
    };
  }
  if (progress >= 1) {
    return {
      display: structuredClone(to), opacity: 1, changed: !sameDisplay(from, to), phase: 'target',
    };
  }

  const changed = !sameDisplay(from, to);
  if (!changed) {
    return { display: structuredClone(from), opacity: 1, changed: false, phase: 'source' };
  }

  const eased = authoringGlideEasing(progress);
  const phase = eased < 0.5 ? 'source' : 'target';
  /*
   * `distanceFromSwitch` is one at either endpoint and zero at the
   * categorical handoff. Smootherstep gives the fade zero velocity and
   * acceleration at the fully visible and fully hidden states, just as it does
   * the spatial motion.
   */
  const distanceFromSwitch = Math.abs(eased * 2 - 1);
  return {
    display: structuredClone(phase === 'source' ? from : to),
    opacity: authoringGlideEasing(distanceFromSwitch),
    changed,
    phase,
  };
}

function originOnArc(
  from: ProbePose['origin'],
  to: ProbePose['origin'],
  centre: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const centreVector = new THREE.Vector3(...centre);
  const fromOffset = new THREE.Vector3(...from).sub(centreVector);
  const toOffset = new THREE.Vector3(...to).sub(centreVector);
  const fromRadius = fromOffset.length();
  const toRadius = toOffset.length();
  if (fromRadius < 1e-9 || toRadius < 1e-9) {
    return [
      mix(from[0], to[0], t),
      mix(from[1], to[1], t),
      mix(from[2], to[2], t),
    ];
  }

  const fromDirection = fromOffset.multiplyScalar(1 / fromRadius);
  const toDirection = toOffset.multiplyScalar(1 / toRadius);
  const turn = new THREE.Quaternion().setFromUnitVectors(fromDirection, toDirection);
  const direction = fromDirection.applyQuaternion(
    new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), turn, t),
  );
  const point = direction.multiplyScalar(mix(fromRadius, toRadius, t)).add(centreVector);
  return [point.x, point.y, point.z];
}

/**
 * A point the authored beam actually aims at, chosen nearest the model centre.
 *
 * Keeping this point on the authored beam preserves the exact endpoint
 * direction. Interpolating the two endpoint aim points then gives the moving
 * origin something anatomically relevant to face, instead of independently
 * slerping a beam that can turn tangentially away from the heart.
 */
function aimPoint(pose: ProbePose, centre: readonly [number, number, number]): THREE.Vector3 {
  const frame = imagingFrame(pose);
  const origin = new THREE.Vector3(...frame.origin);
  const beam = new THREE.Vector3(...frame.beam);
  const toCentre = new THREE.Vector3(...centre).sub(origin);
  const projected = toCentre.dot(beam);
  /*
   * A well-formed view has the centre in front of its aperture. If an imported
   * draft does not, a positive fallback still keeps the aim on its authored
   * beam and avoids producing a zero or reversed direction mid-transition; the
   * exact invalid endpoint remains exact and is not silently repaired here.
   */
  const forwardRange = projected > 1e-9 ? projected : Math.max(1e-9, toCentre.length());
  return origin.addScaledVector(beam, forwardRange);
}

/** A right-handed pose basis: X=lateral, Y=normal, Z=beam. */
function poseOrientation(pose: ProbePose): THREE.Quaternion {
  const frame = imagingFrame(pose);
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...frame.lateral),
      new THREE.Vector3(...frame.normal),
      new THREE.Vector3(...frame.beam),
    ),
  );
}

/** One frame of the authoring pose transition. */
export function viewPoseTransitionStep(
  from: ProbePose,
  to: ProbePose,
  elapsed: number,
  duration = AUTHORING_GLIDE_MS,
  centre: readonly [number, number, number] = [0, 0, 0],
): { pose: ProbePose; done: boolean } {
  const progress = transitionProgress(elapsed, duration);
  if (progress <= 0) return { pose: structuredClone(from) as ProbePose, done: false };
  if (progress >= 1) return { pose: structuredClone(to) as ProbePose, done: true };

  const eased = authoringGlideEasing(progress);
  const fromOrientation = poseOrientation(from);
  const toOrientation = shortestTarget(fromOrientation, poseOrientation(to));
  const rollOrientation = new THREE.Quaternion().slerpQuaternions(
    fromOrientation,
    toOrientation,
    eased,
  );
  const origin = originOnArc(from.origin, to.origin, centre, eased);

  /*
   * Position and aim are one motion. Slerping the full authored orientation
   * independently of the origin arc can point a wide fan completely past the
   * heart halfway between two individually valid windows. The endpoints below
   * are points on the authored beams, so this construction approaches both
   * authored directions exactly while keeping the intervening aim anatomically
   * anchored.
   */
  const movingAim = aimPoint(from, centre).lerp(aimPoint(to, centre), eased);
  const beam = movingAim.sub(new THREE.Vector3(...origin));
  const rollBeam = FRAME_Z.clone().applyQuaternion(rollOrientation).normalize();
  if (beam.lengthSq() < DIRECTION_EPSILON_SQ) beam.copy(rollBeam);
  else beam.normalize();

  /*
   * The orientation slerp still owns ROLL. A minimal correction maps its beam
   * onto the aim-derived beam and carries its lateral axis with it, preserving
   * that roll without ever projecting through a near-zero lateral vector.
  */
  const beamCorrection = new THREE.Quaternion().setFromUnitVectors(rollBeam, beam);
  const lateral = FRAME_X.clone()
    .applyQuaternion(rollOrientation)
    .applyQuaternion(beamCorrection);
  lateral.addScaledVector(beam, -lateral.dot(beam)).normalize();
  const display = echoDisplayHandoff(from.display, to.display, elapsed, duration).display;

  return {
    pose: {
      // A straight chord between windows can pass through the heart. The
      // visual probe instead travels around the model centre while its radial
      // distance interpolates, keeping two outside endpoints outside.
      origin,
      beam_axis: [beam.x, beam.y, beam.z],
      lateral_axis: [lateral.x, lateral.y, lateral.z],
      fan: {
        angle_deg: mix(from.fan.angle_deg, to.fan.angle_deg, eased),
        depth_cm: mix(from.fan.depth_cm, to.fan.depth_cm, eased),
        focus_cm: mix(from.fan.focus_cm, to.fan.focus_cm, eased),
      },
      // The paired opacity helper makes this categorical switch while the echo
      // is fully transparent. The wedge has no display-space reflection to
      // animate; it simply carries the convention selected for this instant.
      display,
    },
    done: false,
  };
}
