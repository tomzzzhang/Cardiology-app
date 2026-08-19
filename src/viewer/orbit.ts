/**
 * The orbit camera's orientation, as arithmetic rather than as scene state.
 *
 * `contracts/viewer-core.md` asked for "familiar globe-viewer orbit feel" with
 * the pivot unambiguously at `C`. That was read as a turntable — horizontal
 * drag about WORLD up — and a turntable turned out to be the wrong object
 * model here. See `dragOrientation`: a globe has a fixed axis and is never
 * turned over, and a heart being read from underneath is neither. Drag is now
 * about the CAMERA's own axes, so the model follows the hand and every
 * orientation is reachable.
 *
 * Two things make this a module rather than a few lines in the component.
 *
 * **The poles.** A camera positioned from angles but handed a hard-coded `up`
 * of (0, 1, 0) has no basis looking straight down — the view direction is
 * parallel to `up` — and is inverted past it. The previous implementation
 * clamped pitch to +-1.5 radians to avoid that, which also made the heart
 * impossible to turn over. A subcostal view is read from underneath, so it has
 * to be able to turn over.
 *
 * **Roll.** Two angles cannot express one. Yaw and pitch fix the view direction
 * and then the `up` follows from them with no freedom left, so there are
 * orientations they simply cannot name — including, in general, the one that
 * views the model exactly as the echo presents it. "Match echo orientation"
 * needs to set an arbitrary basis, so the state here is the full rotation.
 *
 * Holding the rotation rather than rebuilding it from angles removes both
 * problems at once: there is no pole to clamp because nothing is reconstructed
 * from a sine, and roll is representable because the quaternion has room for it.
 */
import * as THREE from 'three';
import type { ImagingFrame } from '../echo/probeFrame.ts';

/** Radians of rotation per pixel of drag. */
export const DRAG_SPEED = 0.008;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const CAMERA_RIGHT = new THREE.Vector3(1, 0, 0);
const CAMERA_BACK = new THREE.Vector3(0, 0, 1);

/** Where the camera sits relative to the pivot, and which way up it is. */
export interface OrbitPose {
  /** Camera position minus pivot. Length is always `radius`. */
  offset: THREE.Vector3;
  /** Unit, and always perpendicular to `offset`. */
  up: THREE.Vector3;
}

/**
 * The camera's place on its sphere, for an orientation and a distance.
 *
 * The camera's local -Z looks at the pivot, so its local +Z is the direction
 * from pivot to camera; both that and `up` come from the same rotation, which
 * is what guarantees they stay perpendicular at every orientation.
 */
export function orbitPose(orientation: THREE.Quaternion, radius: number): OrbitPose {
  return {
    offset: CAMERA_BACK.clone().multiplyScalar(radius).applyQuaternion(orientation),
    up: WORLD_UP.clone().applyQuaternion(orientation),
  };
}

/**
 * Turntable orientation for `yaw` and `pitch`, in radians.
 *
 * Kept as the way the RESET pose is stated: "a bit round and a bit up" is
 * easier to author and to read than a quaternion. `YXZ` applies pitch about X
 * first and yaw about world Y second, which is what makes yaw a turntable
 * rather than a roll; pitch is negated so increasing pitch raises the camera.
 */
export function orientationFromYawPitch(yaw: number, pitch: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
}

/**
 * Apply one drag step, in pixels.
 *
 * Horizontal drag turns about WORLD up, which is what makes it feel like a
 * globe rather than a trackball: repeated horizontal drags spin the model about
 * one axis instead of slowly accumulating roll. Vertical drag turns about the
 * camera's own right, which is the axis that stays horizontal on screen
 * whatever the model has been rolled to.
 *
 * The vertical SENSE is the one the hand is on: dragging up carries the face of
 * the model nearest the camera upward, which means the camera itself drops and
 * the model is seen more from below. The opposite sign makes the near surface
 * run away from the pointer, which reads as the model being pushed rather than
 * turned.
 *
 * The horizontal sign follows the camera's up. Once the camera has passed a
 * pole its up inverts and a world-Y rotation reads backwards on screen, so
 * without this the model fights the pointer for the whole upside-down half of
 * the orbit.
 */
export function dragOrientation(
  orientation: THREE.Quaternion, dx: number, dy: number,
): THREE.Quaternion {
  /*
   * BOTH rotations are about the CAMERA's own axes, which are the SCREEN's
   * axes, and both compose on the right. That is what makes the model turn
   * exactly the way the hand pushes it at every orientation.
   *
   * This replaced a turntable — world-Y yaw composed on the left — and the
   * turntable had two problems the owner ran into immediately.
   *
   * **Some orientations were unreachable.** Yaw and pitch fix the view
   * direction and leave the screen's up determined by world up, so the model
   * could not be rolled. "I cannot get the heart to the angle I want" is the
   * exact symptom: there is no drag that tilts the apex on screen.
   *
   * **It degenerated at the poles.** Looking down world Y, a world-Y yaw spins
   * the picture in place instead of turning the object, and the sign
   * correction that kept horizontal drag reading correctly past the pole
   * flipped back and forth for small drags right at the crossing.
   *
   * Local composition has neither problem: local X and local Y generate the
   * whole rotation group, so every orientation is reachable, and roll comes out
   * of a curved drag the way it does when you turn something in your hand.
   *
   * WHAT IT GIVES UP is the level horizon. A turntable guarantees world up
   * stays up the screen; this does not, so the heart can end up tilted and
   * `Reset` is the way back. That is the trade a globe viewer makes in the
   * other direction, and it is the wrong trade for an object you are turning
   * over to look underneath — which a subcostal view requires.
   */
  const yaw = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, -dx * DRAG_SPEED);
  const pitch = new THREE.Quaternion().setFromAxisAngle(CAMERA_RIGHT, -dy * DRAG_SPEED);
  return orientation.clone().multiply(yaw).multiply(pitch).normalize();
}

/**
 * How close to the lock axis the camera may come before the horizon stops
 * meaning anything.
 *
 * Looking straight down the model's long axis, "which way is up" has no answer:
 * the axis projects to a point on screen and there is no direction to level to.
 * The turntable's old fix was a hard pitch clamp, which is what made the heart
 * impossible to turn over — but the lock is not for turning the heart over, it
 * is for holding it the way a trainee is taught to read it, so a stop here
 * costs nothing that this mode was offering. Three degrees, in the cosine.
 */
const LOCK_POLE_LIMIT = Math.cos((3 * Math.PI) / 180);

/**
 * Roll the camera so `axis` points up the screen, without moving the camera.
 *
 * The view direction is untouched: what changes is only the screen's up. That
 * is what makes turning the lock ON a levelling rather than a jump — the
 * learner keeps looking at what they were looking at, and the horizon comes
 * straight.
 *
 * Returns `null` at the poles, where the axis has no screen direction to level
 * to and there is nothing honest to return.
 */
export function levelled(
  orientation: THREE.Quaternion, axis: THREE.Vector3,
): THREE.Quaternion | null {
  const forward = CAMERA_BACK.clone().applyQuaternion(orientation).negate();
  const unit = axis.clone().normalize();
  if (Math.abs(forward.dot(unit)) > LOCK_POLE_LIMIT) return null;
  return orientationLooking(forward, unit);
}

/**
 * One drag step with the HORIZON LOCKED to `axis`.
 *
 * Echo mode only, and off by default — `contracts/viewer-core.md`. In Explore
 * the trackball is the only option, because free inspection is the point there
 * and the turntable was removed precisely because it could not reach every
 * angle (`docs/observations.md` entry 35). In Echo, which way is up is
 * diagnostic rather than cosmetic, so it is offered.
 *
 * Horizontal drag turns about the MODEL's own long axis rather than about world
 * up. Those are the same thing only while the model is upright, and the whole
 * value of the lock is that it survives not being: the axis is the heart's, so
 * the heart's long axis is what stays vertical.
 *
 * Vertical drag is about the camera's own right, as it is unlocked, and the
 * result is re-levelled rather than trusted to stay level. Re-levelling is what
 * makes the lock idempotent and self-correcting: it cannot accumulate roll over
 * a long session, and a drag that would have crossed the pole simply does not
 * take the vertical component.
 */
export function lockedDragOrientation(
  orientation: THREE.Quaternion, dx: number, dy: number, axis: THREE.Vector3,
): THREE.Quaternion {
  const unit = axis.clone().normalize();
  const yaw = new THREE.Quaternion().setFromAxisAngle(unit, -dx * DRAG_SPEED);
  const pitch = new THREE.Quaternion().setFromAxisAngle(CAMERA_RIGHT, -dy * DRAG_SPEED);
  // Yaw is a WORLD-space rotation and composes on the left; pitch is the
  // camera's own and composes on the right, exactly as it does unlocked.
  const turned = yaw.clone().multiply(orientation).multiply(pitch).normalize();
  const level = levelled(turned, unit);
  if (level !== null) return level;
  // At the pole: keep the yaw, drop the pitch that would have crossed it.
  const yawOnly = yaw.clone().multiply(orientation).normalize();
  return levelled(yawOnly, unit) ?? orientation.clone();
}

/**
 * The orientation that looks along `forward` with `up` pointing up the screen.
 *
 * `up` is orthogonalised against `forward` rather than trusted, and the pair
 * being parallel is refused rather than silently producing a NaN basis.
 */
export function orientationLooking(
  forward: THREE.Vector3, up: THREE.Vector3,
): THREE.Quaternion {
  const back = forward.clone().normalize().negate();
  const screenUp = up.clone().addScaledVector(back, -up.dot(back));
  if (screenUp.lengthSq() < 1e-12) {
    throw new Error('cannot orient a camera whose up is parallel to its view direction');
  }
  screenUp.normalize();
  const right = screenUp.clone().cross(back); // X = Y x Z, right-handed
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, screenUp, back),
  );
}

/**
 * View the model exactly as the echo panel presents it. CAMERA ONLY.
 *
 * The echo image is a projection of the imaging plane, so matching it means
 * putting the camera face-on to that plane with the fan's own axes lying along
 * the screen axes:
 *
 * * **up the screen** is the beam direction — depth increases away from the
 *   transducer, and `display.vertex` decides which end of the panel the
 *   transducer occupies. Vertex-DOWN, the paediatric default for the subcostal
 *   and apical families, puts it at the bottom with the beam running upward.
 * * **across the screen** is the fan's lateral axis, negated by `flip_lr`.
 *
 * `flip_lr` is honoured by viewing the plane from the OTHER SIDE, not by
 * mirroring anything. A mirrored model is a left-handed heart, and no camera
 * can produce one — which is the point: an anatomy viewer must not be able to
 * show a reflected heart by accident.
 *
 * This returns an orientation and nothing else. It does not know the wedge, the
 * view or the pack exists, and there is deliberately no path from here into any
 * of them.
 */
export function echoOrientation(frame: ImagingFrame): THREE.Quaternion {
  const beam = new THREE.Vector3(...frame.beam);
  const lateral = new THREE.Vector3(...frame.lateral);

  const screenUp = frame.vertex === 'down' ? beam : beam.clone().negate();
  const screenRight = frame.flipLr ? lateral.clone().negate() : lateral;
  // forward = up x right, the inverse of right = forward x up.
  const forward = screenUp.clone().cross(screenRight);

  return orientationLooking(forward, screenUp);
}

/* -------------------------------------------------------------------------- */
/* animated transitions                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How long a camera move the learner did not drag takes.
 *
 * Camera moves the learner did not perform are animated because the
 * correspondence between the model and the echo is the thing being taught.
 * Cutting straight to the matched orientation shows the answer; turning the
 * heart into it shows WHICH rotation makes the two panels agree.
 */
export const GLIDE_MS = 700;

/** Smoothstep, clamped: leaves and arrives without a visible jerk. */
export function glideEasing(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * The nearer of the two quaternions naming `target`.
 *
 * A quaternion and its negation are the same orientation, and slerp follows
 * whichever arc it is given — so half the time an un-negated target sends the
 * camera the long way round, through most of a full turn, to arrive somewhere
 * it could have reached directly.
 */
export function shortestTarget(
  from: THREE.Quaternion, target: THREE.Quaternion,
): THREE.Quaternion {
  return from.dot(target) < 0
    ? new THREE.Quaternion(-target.x, -target.y, -target.z, -target.w)
    : target.clone();
}

/** One step of a glide: where the camera is `elapsed` ms in, and whether it has landed. */
export function glideStep(
  from: THREE.Quaternion, to: THREE.Quaternion, elapsed: number, duration = GLIDE_MS,
): { orientation: THREE.Quaternion; done: boolean } {
  const t = duration <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / duration));
  return {
    orientation: new THREE.Quaternion().slerpQuaternions(from, to, glideEasing(t)),
    done: t >= 1,
  };
}

/**
 * Fold an angle into `[-pi, pi)`.
 *
 * Not a clamp: every angle is reachable, this only stops a value drifting
 * without bound over a long session of dragging one way.
 */
export function wrapAngle(radians: number): number {
  const turn = Math.PI * 2;
  return ((((radians + Math.PI) % turn) + turn) % turn) - Math.PI;
}
