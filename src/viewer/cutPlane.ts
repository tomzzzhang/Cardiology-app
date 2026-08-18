/**
 * The free anatomical cutter's plane state, and its translation into the
 * clipping plane three.js actually consumes.
 *
 * `contracts/viewer-core.md` fixes the representation exactly:
 *
 *   dot(N, X - C) = s          closest point   Q = C + sN
 *
 * `N` is a unit normal in model space, `s` is a signed distance from the
 * interaction pivot `C` in pack units, and the plane is **mathematically
 * infinite**. Nothing in this module produces a bounded surface; the cap quad
 * built in `caps.ts` is sized from model bounds purely so a finite mesh can be
 * drawn, and it never participates in the clipping decision.
 *
 * This is the free cutter, which is runtime inspection state on its own data
 * path. The vetted echo wedge is elsewhere (`wedge.ts`, from `views[].probe`)
 * and the two never merge — `contracts/README.md`.
 */
import * as THREE from 'three';
import type { FreeCutState } from '../schema/packV0.ts';

/** The cutter as the viewer holds it: an oriented plane plus which side survives. */
export interface CutPlaneState {
  /** `N`, unit, model space. */
  normal: THREE.Vector3;
  /** `s`, signed distance from `C`, in pack units. */
  offset: number;
  /**
   * Which half-space is kept. `false` keeps `dot(N, X - C) <= s`.
   *
   * The contract says "reversing the oriented plane changes which side remains
   * visible". That is representable by negating `N` and `s` together, but doing
   * it that way makes the depth readout jump sign under the user's hand for a
   * control that did not move. Keeping the flip as its own flag leaves `s`
   * continuous across a reversal, which is what a slider and a readout need.
   */
  flipped: boolean;
}

/** Seed the cutter from the pack, or square-on through the pivot if unseeded. */
export function initialCutPlane(seed: FreeCutState | undefined): CutPlaneState {
  if (!seed) {
    return { normal: new THREE.Vector3(0, 0, 1), offset: 0, flipped: false };
  }
  return {
    normal: new THREE.Vector3(...(seed.normal as [number, number, number])).normalize(),
    offset: seed.offset,
    flipped: false,
  };
}

/**
 * The three.js clipping plane for a cutter state and pivot.
 *
 * three.js discards a fragment where `dot(plane.normal, X) + plane.constant < 0`,
 * so keeping `dot(N, X - C) <= s` means:
 *
 *   -dot(N, X) + dot(N, C) + s >= 0
 *
 * i.e. normal `-N` and constant `dot(N, C) + s`. Reversing negates both, which
 * is the same plane with the opposite half-space kept.
 *
 * `pivot` and the returned plane are in the same space as the geometry the
 * plane is applied to. The caller is responsible for handing in a pivot already
 * carried through `meshes.canonical_pose`; the arithmetic here is space-blind
 * and would silently produce a plausible plane in the wrong frame otherwise.
 */
export function clippingPlane(state: CutPlaneState, pivot: THREE.Vector3): THREE.Plane {
  const sign = state.flipped ? -1 : 1;
  return new THREE.Plane(
    state.normal.clone().multiplyScalar(-sign),
    sign * (state.normal.dot(pivot) + state.offset),
  );
}

/** `Q = C + sN` — the plane's closest point to the pivot. */
export function planeAnchor(state: CutPlaneState, pivot: THREE.Vector3): THREE.Vector3 {
  return pivot.clone().addScaledVector(state.normal, state.offset);
}

/**
 * Turn `N` by a screen drag, holding `s` fixed.
 *
 * `contracts/viewer-core.md`: "Default free rotation holds `s` constant while
 * rotating `N` around the heart. A gesture FREEZES ITS PIVOT for the duration
 * so the plane cannot drift from a continuously recomputed pivot."
 *
 * Both halves of that are here rather than in the component, because both are
 * easy to get subtly wrong and impossible to see afterwards:
 *
 * * **`s` constant.** The plane turns about `C`, not about its own current
 *   anchor. Rotating about the anchor would translate the plane as well as turn
 *   it, so a pure rotation gesture would walk the cut through the heart.
 * * **Frozen start.** The rotation is computed from the drag's TOTAL offset
 *   applied to the normal the gesture started with, never accumulated step by
 *   step onto the live normal. Accumulating makes the result depend on how the
 *   pointer got there — the same gesture at different sampling rates lands
 *   somewhere different — and makes dragging back to the start not return.
 *
 * The screen axes come from the camera, so the plane turns the way the hand
 * moves: dragging right swings the normal right, dragging down tips it down.
 */
export function rotatedNormal(
  startNormal: THREE.Vector3,
  cameraRight: THREE.Vector3,
  cameraUp: THREE.Vector3,
  totalDx: number,
  totalDy: number,
  radiansPerPixel: number,
): THREE.Vector3 {
  /*
   * Signs chosen so the plane follows the hand rather than the camera. Dragging
   * the CAMERA right turns the model right because the camera moves the other
   * way; here the object itself is being turned, so the rotation is in the same
   * sense as the drag: right swings the normal right, down tips it down.
   */
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    cameraUp.clone().normalize(), totalDx * radiansPerPixel,
  );
  const pitch = new THREE.Quaternion().setFromAxisAngle(
    cameraRight.clone().normalize(), totalDy * radiansPerPixel,
  );
  return startNormal.clone().applyQuaternion(pitch).applyQuaternion(yaw).normalize();
}

/**
 * The free cutter's state that reproduces a vetted view's imaging plane.
 *
 * The ONE permitted bridge, and it is one-way and copy-only: geometry is read
 * out of the frame and written into cutter state. Nothing here can write back,
 * because there is nothing to write back to — a `CutPlaneState` is not a view,
 * and `views[]` is not an argument.
 *
 * `s` is measured from the pivot along the plane's normal, so the copied plane
 * lands exactly where the echo's plane is rather than merely parallel to it.
 */
export function alignedToPlane(
  planeNormal: THREE.Vector3, planePoint: THREE.Vector3, pivot: THREE.Vector3,
): { normal: THREE.Vector3; offset: number } {
  const normal = planeNormal.clone().normalize();
  return { normal, offset: normal.dot(planePoint.clone().sub(pivot)) };
}

/**
 * Radius of the smallest sphere about `pivot` containing every vertex.
 *
 * Measured from the geometry, not from the bounding box. The box's furthest
 * CORNER is generally empty space — on the Rodero heart it sits 106 units from
 * the pivot while the furthest actual vertex is 77, a 37% over-estimate — and
 * both consumers of this number pay for that error: the camera frames a small
 * heart in a large panel, and the depth slider spends a third of its travel
 * outside the model where nothing changes.
 *
 * The walk is over position attributes at load time, once. At this model's
 * ~180k vertices that is well under a millisecond, and it is exact.
 */
export function enclosingRadius(root: THREE.Object3D, pivot: THREE.Vector3): number {
  const point = new THREE.Vector3();
  let furthest = 0;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position as THREE.BufferAttribute, i)
        .applyMatrix4(object.matrixWorld);
      furthest = Math.max(furthest, point.distanceTo(pivot));
    }
  });
  return furthest;
}
