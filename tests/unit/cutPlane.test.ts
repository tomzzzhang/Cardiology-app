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
  clippingPlane,
  enclosingRadius,
  initialCutPlane,
  planeAnchor,
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
