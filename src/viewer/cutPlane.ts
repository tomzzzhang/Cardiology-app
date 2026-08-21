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
 * path. The saved echo wedge is elsewhere (`wedge.ts`, from `views[].probe`)
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
 * Which `flipped` value opens this plane toward the camera.
 *
 * The decision is made against the plane itself, not merely against its pivot:
 * the closest point on the plane is `Q = C + sN`, so the camera's signed side
 * is `dot(N, camera - Q)`. An unflipped cutter removes the `+N` half; therefore
 * it already opens toward a camera on the positive side, while a camera on the
 * negative side needs the cutter reversed.
 *
 * A camera exactly on the plane has no meaningful side. Preserve the current
 * value in that narrow band so tiny floating-point changes cannot make the cut
 * chatter between its two halves.
 */
export function cameraFacingFlip(
  state: CutPlaneState,
  pivot: THREE.Vector3,
  camera: THREE.Vector3,
  epsilon = 1e-6,
): boolean {
  const side = state.normal.dot(camera.clone().sub(planeAnchor(state, pivot)));
  if (side > epsilon) return false;
  if (side < -epsilon) return true;
  return state.flipped;
}

/**
 * An orthonormal in-plane basis for the cut, given a preferred long axis.
 *
 * The mathematical cutter is `{N, s}` and has no in-plane orientation at all.
 * The RECTANGLE drawn on it does, and that orientation is information rather
 * than decoration: in echo-synced mode the long edge is aligned to the sector's
 * lateral axis, so the rectangle reads as the same slice the echo panel shows
 * rather than as a differently-rotated one on the same plane.
 *
 * `preferred` is projected onto the plane rather than trusted, and a preference
 * that is parallel to `N` — which is what carrying an in-plane axis through a
 * large rotation eventually produces — falls back to any perpendicular rather
 * than to a zero-length basis.
 */
export function planeBasis(
  normal: THREE.Vector3, preferred?: THREE.Vector3,
): { u: THREE.Vector3; v: THREE.Vector3 } {
  const n = normal.clone().normalize();
  const u = (preferred ?? new THREE.Vector3(1, 0, 0)).clone();
  u.addScaledVector(n, -u.dot(n));
  if (u.lengthSq() < 1e-8) {
    // Any perpendicular will do; pick the one furthest from `n` so the cross
    // product below is well conditioned.
    const axis = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    u.copy(axis).addScaledVector(n, -axis.dot(n));
  }
  u.normalize();
  return { u, v: n.clone().cross(u).normalize() };
}

/**
 * How face-on the plane has to be before the handle stops having a screen
 * direction to move in.
 *
 * A handle can only move perpendicular to the plane, so its on-screen velocity
 * is the projection of `N`. When the plane faces the camera that projection is
 * nothing: the handle genuinely cannot move on screen, and no mapping can make
 * it follow the pointer. Below this the gesture falls back to tipping the edge
 * the way a picture frame tips, which is the only reading left.
 */
const FACE_ON_FLOOR = 0.1;
const FACE_ON_CEILING = 0.3;

/**
 * Tip `N` by dragging one edge handle, holding `s` fixed.
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
 * **The grabbed handle follows the pointer.** A handle at `R * handleDir` moves
 * to `R(cos t * handleDir - sin t * N)` as the plane turns about
 * `a = N x handleDir`, so its velocity at the start of the gesture is `-R * N`:
 * whatever direction it is drawn in, the only way it can move is out of the
 * plane. So the drag is measured along the SCREEN PROJECTION OF `N`, not along
 * the handle's own direction, and the handle tracks the hand. Measuring along
 * the handle's direction instead makes opposite handles behave identically and
 * makes the dot move against the pointer — which is what an earlier revision
 * did.
 *
 * Which handle was grabbed still decides the AXIS: the `u` pair tips the plane
 * about `v` and the `v` pair about `u`, and opposite handles of a pair tip it in
 * opposite senses, because pulling the near edge forward and pushing the far
 * edge forward are different motions of the same plate.
 */
export function tiltedNormal(
  startNormal: THREE.Vector3,
  handleDir: THREE.Vector3,
  cameraRight: THREE.Vector3,
  cameraUp: THREE.Vector3,
  totalDx: number,
  totalDy: number,
  radiansPerPixel: number,
): THREE.Vector3 {
  const n = startNormal.clone().normalize();
  const dir = handleDir.clone();
  dir.addScaledVector(n, -dir.dot(n));
  if (dir.lengthSq() < 1e-8) return n;
  dir.normalize();

  const right = cameraRight.clone().normalize();
  const up = cameraUp.clone().normalize();

  /*
   * The handle's screen velocity for a positive angle is the projection of
   * `-N`. Screen `y` grows DOWNWARD while `cameraUp` grows upward, so the
   * camera-frame `y` component is negated to become a pixel direction.
   */
  const velocityX = -n.dot(right);
  const velocityY = n.dot(up);
  const velocity = Math.hypot(velocityX, velocityY);

  let angle = 0;
  if (velocity > FACE_ON_FLOOR) {
    angle = ((totalDx * velocityX + totalDy * velocityY) / velocity) * radiansPerPixel;
  }

  if (velocity < FACE_ON_CEILING) {
    /*
     * Nearly face-on: the handle has almost no screen direction to move in, so
     * the only reading left is the picture frame one — push an edge inward and
     * it tips away from you. Blended in rather than switched to, so a gesture
     * that crosses the threshold does not jump.
     */
    const screenX = dir.dot(right);
    const screenY = dir.dot(up);
    const screenLength = Math.hypot(screenX, screenY);
    if (screenLength > 1e-6) {
      const framed = -((totalDx * screenX + -totalDy * screenY) / screenLength) * radiansPerPixel;
      const blend = Math.max(
        0, Math.min(1, (velocity - FACE_ON_FLOOR) / (FACE_ON_CEILING - FACE_ON_FLOOR)),
      );
      angle = angle * blend + framed * (1 - blend);
    }
  }

  // `a = N x dir` has `dN/dt = dir` and moves the handle toward `-N`, which is
  // why the angle above is the drag along `-N`'s screen direction, unnegated.
  const axis = n.clone().cross(dir).normalize();
  return n
    .applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, angle))
    .normalize();
}

/**
 * Move the plane along its own normal by a screen drag.
 *
 * The depth `s` follows the pointer at 1:1 in world units: the drag is measured
 * along the screen projection of `N`, and scaled by how many model units a pixel
 * spans at the plane's own distance, so the plane tracks the hand rather than
 * moving at some gain that changes with the zoom.
 *
 * Frozen start and total offset, the same rule the handles and the pad follow.
 *
 * A plane seen face-on has `N` pointing at the camera, where it projects to
 * nothing and there is no direction to drag along. That is degenerate rather
 * than fixable — a face-on plane has no visible depth to move through — so the
 * gesture becomes a no-op and the learner orbits a little. Returning the start
 * offset rather than a NaN is the whole handling.
 */
export function draggedOffset(
  startOffset: number,
  normal: THREE.Vector3,
  cameraRight: THREE.Vector3,
  cameraUp: THREE.Vector3,
  totalDx: number,
  totalDy: number,
  unitsPerPixel: number,
): number {
  const n = normal.clone().normalize();
  const screenX = n.dot(cameraRight.clone().normalize());
  // Screen `y` grows downward while `cameraUp` grows upward.
  const screenY = -n.dot(cameraUp.clone().normalize());
  const length = Math.hypot(screenX, screenY);
  if (length < 1e-6 || !Number.isFinite(unitsPerPixel)) return startOffset;
  const along = (totalDx * screenX + totalDy * screenY) / length;
  return startOffset + along * unitsPerPixel;
}

/**
 * The free cutter's state that reproduces a saved view's imaging plane.
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
 * heart in a large panel, and the interactive depth range spends a third of its
 * travel outside the model where nothing changes.
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

/**
 * A subsampled copy of a model's world-space vertices.
 *
 * For clearance tests — "how close is this point to tissue" — where an exact
 * answer over every vertex is far more than the question needs and far more
 * than a held button can afford. The stride is chosen to land near `budget`
 * points however dense the mesh is, so the cost is bounded by the budget rather
 * than by the model.
 *
 * Vertices rather than triangles, and therefore an OVER-estimate of the
 * distance when the nearest surface point is in the middle of a large face. On
 * a mesh decimated to this density the error is under a millimetre, which is
 * finer than anything measured against it.
 */
export function sampleSurface(root: THREE.Object3D, budget = 6000): Float32Array<ArrayBuffer> {
  root.updateMatrixWorld(true);
  let total = 0;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) total += object.geometry.getAttribute('position')?.count ?? 0;
  });
  if (total === 0) return new Float32Array(0);

  const stride = Math.max(1, Math.floor(total / budget));
  const out: number[] = [];
  const point = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += stride) {
      point.fromBufferAttribute(position as THREE.BufferAttribute, i).applyMatrix4(object.matrixWorld);
      out.push(point.x, point.y, point.z);
    }
  });
  return new Float32Array(out);
}
