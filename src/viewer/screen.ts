/**
 * World space to panel pixels, and back to a size.
 *
 * Direct manipulation needs both directions of this. Hit-testing is a screen
 * distance — "is the pointer within 26 CSS pixels of that handle" — and drawing
 * the handle at the size of its own hit target needs the inverse: how many
 * model units one pixel spans at the handle's depth.
 *
 * Kept out of the component because both are easy to get subtly wrong in ways
 * that produce a control which nearly works: an inverted `y` puts the reveal on
 * the mirror image of the handle, and a size taken at the camera's distance
 * instead of the handle's makes the target drift as the model is zoomed.
 */
import * as THREE from 'three';

export interface ScreenPoint {
  x: number;
  y: number;
  /** False when the point is behind the camera, where projection is meaningless. */
  inFront: boolean;
}

/**
 * Project a world point to CSS pixels within a panel of `width` x `height`.
 *
 * `Vector3.project` yields normalised device coordinates with `y` UP; pointer
 * events measure `y` DOWN from the top of the element, so the sign is flipped
 * here once rather than at each call site.
 */
export function projectToScreen(
  point: THREE.Vector3, camera: THREE.PerspectiveCamera, width: number, height: number,
): ScreenPoint {
  const ndc = point.clone().project(camera);
  return {
    x: ((ndc.x + 1) / 2) * width,
    y: ((1 - ndc.y) / 2) * height,
    // `project` divides by w; a point behind the camera comes back with the
    // signs of x and y flipped, which reads as a plausible position on the
    // opposite side of the panel unless it is rejected explicitly.
    inFront: ndc.z < 1,
  };
}

/**
 * Model units per CSS pixel at `distance` from a perspective camera.
 *
 * The vertical field of view is the one that maps to the panel's height, which
 * is the axis `setSize` and the projection matrix agree on; the horizontal
 * follows from the aspect ratio and would give the same answer.
 */
export function unitsPerPixel(
  camera: THREE.PerspectiveCamera, distance: number, heightPx: number,
): number {
  if (heightPx <= 0) return 0;
  const vertical = (camera.fov * Math.PI) / 180;
  return (2 * distance * Math.tan(vertical / 2)) / heightPx;
}
