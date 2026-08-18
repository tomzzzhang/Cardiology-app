/**
 * The orbit camera's orientation, as arithmetic rather than as scene state.
 *
 * `contracts/viewer-core.md` asks for "familiar globe-viewer orbit feel" with
 * the pivot unambiguously at `C`. That is a turntable: yaw about world up,
 * pitch about the camera's own right, both applied to a fixed distance.
 *
 * The part that has a right answer, and therefore lives here rather than inside
 * the component, is what happens at and beyond the poles. A camera positioned
 * from angles but given a hard-coded `up` of (0, 1, 0) is undefined looking
 * straight down — the view direction is parallel to `up`, so there is no basis
 * — and inverted past it. The previous implementation avoided that by clamping
 * pitch to +-1.5 radians, which also made the model impossible to turn over.
 *
 * A subcostal view is read from underneath, and a learner comparing an apex-up
 * display against an apex-down one has to be able to get the model into both,
 * so the clamp had to go. Deriving the offset AND the up vector from one
 * rotation removes the degeneracy rather than fencing it off.
 */
import * as THREE from 'three';

/** Where the camera sits relative to the pivot, and which way up it is. */
export interface OrbitPose {
  /** Camera position minus pivot. Length is always `radius`. */
  offset: THREE.Vector3;
  /** Unit, and always perpendicular to `offset`. */
  up: THREE.Vector3;
}

/**
 * Turntable rotation for `yaw` and `pitch`, in radians.
 *
 * `YXZ` order applies pitch about X first and yaw about world Y second, which
 * is what makes yaw a turntable rather than a roll. Pitch is negated so that
 * increasing pitch RAISES the camera, matching the drag sense the viewer was
 * authored against.
 */
export function orbitOrientation(yaw: number, pitch: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
}

export function orbitPose(yaw: number, pitch: number, radius: number): OrbitPose {
  const orientation = orbitOrientation(yaw, pitch);
  return {
    offset: new THREE.Vector3(0, 0, radius).applyQuaternion(orientation),
    up: new THREE.Vector3(0, 1, 0).applyQuaternion(orientation),
  };
}

/**
 * Which way a horizontal drag should turn the model.
 *
 * Past a pole the camera's `up` inverts, and a yaw delta that meant "drag
 * right, model turns right" becomes its own opposite — the model fights the
 * pointer for the whole upside-down half of the orbit. `cos(pitch)` is exactly
 * the term that flips, so its sign is the correction.
 */
export function yawDirection(pitch: number): 1 | -1 {
  return Math.cos(pitch) >= 0 ? 1 : -1;
}

/**
 * Fold an angle into `[-pi, pi)`.
 *
 * Not a clamp: every angle is reachable, this only stops the value drifting
 * without bound over a long session of dragging one way.
 */
export function wrapAngle(radians: number): number {
  const turn = Math.PI * 2;
  return ((((radians + Math.PI) % turn) + turn) % turn) - Math.PI;
}
