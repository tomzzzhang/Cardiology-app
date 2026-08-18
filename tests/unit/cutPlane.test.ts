/**
 * The free anatomical cutter's plane algebra.
 *
 * `contracts/viewer-core.md` states the cutter as `dot(N, X - C) = s`, and
 * three.js states a clipping plane as `dot(n, X) + c >= 0`. The translation
 * between them is two sign choices, and getting either wrong produces a plane
 * that still looks like a plane — it cuts, it moves with the slider, it just
 * keeps the wrong half or sits at the wrong depth. Nothing downstream can
 * notice, so the conversion is pinned here against the contract's own equation.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  alignedToPlane,
  clippingPlane,
  enclosingRadius,
  initialCutPlane,
  planeAnchor,
  rotatedNormal,
} from '../../src/viewer/cutPlane.ts';

const PIVOT = new THREE.Vector3(3, -2, 7);

/** Signed distance three.js uses: fragments below zero are discarded. */
function keeps(plane: THREE.Plane, point: THREE.Vector3): boolean {
  return plane.normal.dot(point) + plane.constant >= 0;
}

describe('initialCutPlane', () => {
  it('normalises a seeded normal', () => {
    const state = initialCutPlane({ normal: [0, 0, 4], offset: 12 });
    expect(state.normal.length()).toBeCloseTo(1, 12);
    expect(state.normal.z).toBeCloseTo(1, 12);
    expect(state.offset).toBe(12);
    expect(state.flipped).toBe(false);
  });

  it('falls back to a unit normal through the pivot when the pack seeds nothing', () => {
    const state = initialCutPlane(undefined);
    expect(state.normal.length()).toBeCloseTo(1, 12);
    expect(state.offset).toBe(0);
  });
});

describe('clippingPlane', () => {
  it('keeps exactly the half-space the contract specifies', () => {
    const state = initialCutPlane({ normal: [0, 0, 1], offset: 5 });
    const plane = clippingPlane(state, PIVOT);

    // dot(N, X - C) = 4 <= 5 — kept.
    expect(keeps(plane, new THREE.Vector3(0, 0, PIVOT.z + 4))).toBe(true);
    // dot(N, X - C) = 6 > 5 — discarded.
    expect(keeps(plane, new THREE.Vector3(0, 0, PIVOT.z + 6))).toBe(false);
  });

  it('places the boundary at s from the pivot, not from the origin', () => {
    const state = initialCutPlane({ normal: [0, 1, 0], offset: -8 });
    const plane = clippingPlane(state, PIVOT);
    const onPlane = PIVOT.clone().addScaledVector(state.normal, state.offset);
    expect(plane.distanceToPoint(onPlane)).toBeCloseTo(0, 10);
  });

  it('reversal keeps the other half and leaves s untouched', () => {
    const state = initialCutPlane({ normal: [1, 0, 0], offset: 2 });
    const probe = new THREE.Vector3(PIVOT.x + 10, PIVOT.y, PIVOT.z);

    expect(keeps(clippingPlane(state, PIVOT), probe)).toBe(false);
    state.flipped = true;
    expect(keeps(clippingPlane(state, PIVOT), probe)).toBe(true);
    // The readout must not jump when the user reverses the plane.
    expect(state.offset).toBe(2);
  });

  it('agrees with itself for an off-axis normal', () => {
    const state = initialCutPlane({ normal: [1, 2, -2], offset: 6 });
    const plane = clippingPlane(state, PIVOT);
    for (const s of [-30, -6, 0, 5.9, 6.1, 20]) {
      const point = PIVOT.clone().addScaledVector(state.normal, s);
      expect(keeps(plane, point)).toBe(s <= 6 + 1e-9);
    }
  });
});

describe('planeAnchor', () => {
  it('is Q = C + sN and lies on the clipping plane', () => {
    const state = initialCutPlane({ normal: [0, 3, 4], offset: -11 });
    const anchor = planeAnchor(state, PIVOT);
    expect(anchor.distanceTo(PIVOT)).toBeCloseTo(11, 10);
    expect(clippingPlane(state, PIVOT).distanceToPoint(anchor)).toBeCloseTo(0, 10);
  });
});

describe('enclosingRadius', () => {
  /**
   * The point of measuring geometry rather than the bounding box: a box's
   * furthest corner is empty space, and both the camera framing and the depth
   * slider are sized from this number.
   */
  it('measures the furthest vertex, not the furthest bounding-box corner', () => {
    // An octahedron's vertices sit on the axes; its bounding box corners are a
    // factor of sqrt(3) further out.
    const geometry = new THREE.OctahedronGeometry(10);
    const mesh = new THREE.Mesh(geometry);
    const radius = enclosingRadius(mesh, new THREE.Vector3(0, 0, 0));
    expect(radius).toBeCloseTo(10, 4);
    expect(radius).toBeLessThan(new THREE.Vector3(10, 10, 10).length());
  });

  it('is measured about the pivot, and in world space', () => {
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(10));
    mesh.position.set(100, 0, 0);
    // Furthest vertex is at x = 110; from a pivot at the mesh centre it is 10.
    expect(enclosingRadius(mesh, new THREE.Vector3(0, 0, 0))).toBeCloseTo(110, 4);
    expect(enclosingRadius(mesh, new THREE.Vector3(100, 0, 0))).toBeCloseTo(10, 4);
  });

  it('reports zero for an object carrying no geometry', () => {
    expect(enclosingRadius(new THREE.Group(), new THREE.Vector3())).toBe(0);
  });
});

describe('rotatedNormal', () => {
  const RIGHT = new THREE.Vector3(1, 0, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const START = new THREE.Vector3(0, 0, 1);
  const RATE = 0.006;

  it('keeps the normal a unit vector', () => {
    for (const [dx, dy] of [[0, 0], [300, 0], [0, -240], [180, 260], [-900, 700]]) {
      expect(rotatedNormal(START, RIGHT, UP, dx, dy, RATE).length()).toBeCloseTo(1, 9);
    }
  });

  it('does nothing for a gesture that has not moved', () => {
    expect(rotatedNormal(START, RIGHT, UP, 0, 0, RATE).distanceTo(START)).toBeCloseTo(0, 9);
  });

  it('depends only on where the drag ended, not on how it got there', () => {
    /*
     * The property the frozen start normal exists for. Applying small rotations
     * to the LIVE normal makes the result a function of the pointer's sampling
     * rate — the same gesture lands somewhere different on a slow machine — and
     * dragging back to the start does not return the plane to the start.
     */
    const direct = rotatedNormal(START, RIGHT, UP, 120, 80, RATE);
    // The same total offset, as it would arrive over many pointer samples.
    let live = START.clone();
    for (let step = 1; step <= 40; step += 1) {
      live = rotatedNormal(START, RIGHT, UP, (120 * step) / 40, (80 * step) / 40, RATE);
    }
    expect(live.distanceTo(direct)).toBeCloseTo(0, 9);

    // And returning the pointer to where it started returns the plane.
    expect(rotatedNormal(START, RIGHT, UP, 0, 0, RATE).distanceTo(START)).toBeCloseTo(0, 9);
  });

  it('turns the plane the way the hand moves', () => {
    // Dragging right swings the normal toward screen-right; dragging down tips
    // it toward screen-down. Any other pairing reads as the plane fighting you.
    expect(rotatedNormal(START, RIGHT, UP, 200, 0, RATE).dot(RIGHT)).toBeGreaterThan(0);
    expect(rotatedNormal(START, RIGHT, UP, -200, 0, RATE).dot(RIGHT)).toBeLessThan(0);
    expect(rotatedNormal(START, RIGHT, UP, 0, 200, RATE).dot(UP)).toBeLessThan(0);
    expect(rotatedNormal(START, RIGHT, UP, 0, -200, RATE).dot(UP)).toBeGreaterThan(0);
  });

  it('leaves `s` alone, which is the caller keeping the plane on its pivot', () => {
    /*
     * Stated here because the invariant is about the PAIR: the rotation returns
     * a normal and nothing else, so `s` cannot change, so the plane turns about
     * `C` rather than walking through the heart as it turns.
     */
    const turned = rotatedNormal(START, RIGHT, UP, 150, -90, RATE);
    const before = planeAnchor({ normal: START, offset: 12, flipped: false }, PIVOT);
    const after = planeAnchor({ normal: turned, offset: 12, flipped: false }, PIVOT);
    expect(before.distanceTo(PIVOT)).toBeCloseTo(12, 9);
    expect(after.distanceTo(PIVOT)).toBeCloseTo(12, 9);
  });
});

describe('alignedToPlane — the one permitted bridge', () => {
  it('reproduces the plane it was handed, not merely a parallel one', () => {
    // The echo's plane passes through the probe origin, which is generally
    // nowhere near the pivot. Copying only the normal would leave a plane with
    // the right tilt in the wrong place, which looks almost right.
    const normal = new THREE.Vector3(1, 2, -2).normalize();
    const point = new THREE.Vector3(-14, 33, 6);
    const copied = alignedToPlane(normal, point, PIVOT);

    const anchor = planeAnchor({ ...copied, flipped: false }, PIVOT);
    // The copied plane contains the point it was built from.
    expect(copied.normal.dot(point.clone().sub(anchor))).toBeCloseTo(0, 6);
    expect(copied.normal.distanceTo(normal)).toBeCloseTo(0, 9);
  });

  it('normalises a normal it is handed unnormalised', () => {
    const copied = alignedToPlane(
      new THREE.Vector3(0, 0, 4), new THREE.Vector3(0, 0, 9), PIVOT,
    );
    expect(copied.normal.length()).toBeCloseTo(1, 9);
    expect(copied.offset).toBeCloseTo(9 - PIVOT.z, 6);
  });

  it('returns plain cutter state, with no way back to a view', () => {
    // The shape of the return value IS the guarantee: `{normal, offset}` is the
    // free cutter's own state and carries no identity, so nothing downstream
    // can mistake an aligned cutter for the vetted view it was copied from.
    const copied = alignedToPlane(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 5, 0), PIVOT,
    );
    expect(Object.keys(copied).sort()).toEqual(['normal', 'offset']);
  });
});
