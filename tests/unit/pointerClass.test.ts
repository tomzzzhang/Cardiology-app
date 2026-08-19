/**
 * The reveal rule every direct-manipulation handle obeys, and the world-to-
 * screen arithmetic that hit-tests them.
 *
 * The rule is one rule in one place on purpose. Restated per control it decays
 * per control, and the decay is invisible on the machine doing the restating: a
 * handle that reveals on hover is perfectly usable with a mouse and is an
 * invisible control on a phone, where the pointer's first contact with the
 * screen is already the press.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  HIT_RADIUS_COARSE_PX,
  HIT_RADIUS_FINE_PX,
  PROXIMITY_RADIUS_PX,
  hitRadiusPx,
  revealFor,
} from '../../src/viewer/pointerClass.ts';
import { projectToScreen, unitsPerPixel } from '../../src/viewer/screen.ts';

describe('revealFor — proximity on a fine pointer, always on a coarse one', () => {
  it('shows a coarse-pointer handle at any distance, including none at all', () => {
    /*
     * The gate: "handles and the tilt arrow are present and hittable under a
     * coarse pointer". A finger has no hover, so `Infinity` — the distance
     * reported when no pointer is over the panel — is the NORMAL state on a
     * touch screen, and it must still be fully visible.
     */
    for (const distance of [0, 10, 500, Infinity, Number.NaN]) {
      expect(revealFor(distance, true)).toBe(1);
    }
  });

  it('hides a fine-pointer handle until the pointer approaches', () => {
    expect(revealFor(Infinity, false)).toBe(0);
    expect(revealFor(PROXIMITY_RADIUS_PX, false)).toBe(0);
    expect(revealFor(PROXIMITY_RADIUS_PX + 1, false)).toBe(0);
  });

  it('finishes appearing exactly where it becomes grabbable', () => {
    // The fade IS the affordance: a handle that is still half transparent when
    // it will already take a click reads as not ready to be clicked.
    expect(revealFor(HIT_RADIUS_FINE_PX, false)).toBe(1);
    expect(revealFor(0, false)).toBe(1);
  });

  it('rises monotonically as the pointer closes in', () => {
    let previous = -1;
    for (let distance = PROXIMITY_RADIUS_PX; distance >= 0; distance -= 1) {
      const reveal = revealFor(distance, false);
      expect(reveal).toBeGreaterThanOrEqual(previous);
      expect(reveal).toBeGreaterThanOrEqual(0);
      expect(reveal).toBeLessThanOrEqual(1);
      previous = reveal;
    }
  });
});

describe('hitRadiusPx', () => {
  it('sizes the coarse target for a thumb', () => {
    // A radius, so the target is ~52 px across — inside the 44 px minimum every
    // touch guideline agrees on, with margin, because these targets sit over a
    // scene the same finger also drags to orbit.
    expect(HIT_RADIUS_COARSE_PX * 2).toBeGreaterThanOrEqual(44);
    expect(hitRadiusPx(true)).toBe(HIT_RADIUS_COARSE_PX);
    expect(hitRadiusPx(false)).toBe(HIT_RADIUS_FINE_PX);
    expect(hitRadiusPx(true)).toBeGreaterThan(hitRadiusPx(false));
  });
});

describe('projectToScreen', () => {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 5000);

  it('puts the point the camera looks at in the middle of the panel', () => {
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const point = projectToScreen(new THREE.Vector3(0, 0, 0), camera, 800, 600);
    expect(point.x).toBeCloseTo(400, 6);
    expect(point.y).toBeCloseTo(300, 6);
    expect(point.inFront).toBe(true);
  });

  it('measures y DOWN from the top, the way a pointer event does', () => {
    /*
     * NDC has y up; `clientY` has y down. Getting this backwards produces a
     * reveal that follows the mirror image of the handle — a control that
     * lights up when the pointer is nowhere near it.
     */
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const above = projectToScreen(new THREE.Vector3(0, 20, 0), camera, 800, 600);
    expect(above.y).toBeLessThan(300);
  });

  it('rejects a point behind the camera rather than mirroring it onto the panel', () => {
    // `project` divides by w, so a point behind the camera comes back with the
    // signs of x and y flipped — a plausible position on the opposite side.
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    expect(projectToScreen(new THREE.Vector3(0, 0, 400), camera, 800, 600).inFront).toBe(false);
  });
});

describe('unitsPerPixel', () => {
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 5000);

  it('scales with distance, so a handle keeps its screen size as the model zooms', () => {
    const near = unitsPerPixel(camera, 100, 600);
    const far = unitsPerPixel(camera, 200, 600);
    expect(far).toBeCloseTo(near * 2, 9);
  });

  it('agrees with the projection it is the inverse of', () => {
    /*
     * The one number decides both how big a handle is drawn and how big its hit
     * target is, so it has to be the real conversion rather than a fudge: a
     * handle that draws smaller than it grabs swallows drags meant for the
     * camera, and one that draws larger misses when aimed at.
     */
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const perPixel = unitsPerPixel(camera, 100, 600);
    const centre = projectToScreen(new THREE.Vector3(0, 0, 0), camera, 600, 600);
    const offset = projectToScreen(new THREE.Vector3(0, perPixel * 50, 0), camera, 600, 600);
    expect(centre.y - offset.y).toBeCloseTo(50, 6);
  });

  it('returns nothing rather than infinity for a panel with no height', () => {
    expect(unitsPerPixel(camera, 100, 0)).toBe(0);
  });
});
