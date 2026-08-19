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
  draggedOffset,
  planeAnchor,
  planeBasis,
  tiltedNormal,
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

describe('planeBasis — the rectangle\'s in-plane orientation', () => {
  it('returns an orthonormal, right-handed basis for the plane', () => {
    const normal = new THREE.Vector3(1, -2, 3).normalize();
    const { u, v } = planeBasis(normal, new THREE.Vector3(0, 1, 0));
    expect(u.length()).toBeCloseTo(1, 9);
    expect(v.length()).toBeCloseTo(1, 9);
    expect(u.dot(normal)).toBeCloseTo(0, 9);
    expect(v.dot(normal)).toBeCloseTo(0, 9);
    expect(u.dot(v)).toBeCloseTo(0, 9);
    // u x v = N, which is what makes the rectangle's basis a rotation rather
    // than a reflection — a mirrored gizmo would put its handles on the wrong
    // sides of the plane.
    expect(u.clone().cross(v).distanceTo(normal)).toBeCloseTo(0, 9);
  });

  it('keeps the preferred long axis when it already lies in the plane', () => {
    /*
     * This is the whole point of the rectangle over a disk: in echo-synced mode
     * the long edge is the sector's lateral axis, so the rectangle reads as the
     * same slice the echo panel shows rather than an arbitrarily rolled one.
     */
    const normal = new THREE.Vector3(0, 0, 1);
    const lateral = new THREE.Vector3(0.6, 0.8, 0);
    expect(planeBasis(normal, lateral).u.distanceTo(lateral)).toBeCloseTo(0, 9);
  });

  it('projects a preference that is not in the plane rather than trusting it', () => {
    const normal = new THREE.Vector3(0, 0, 1);
    const { u } = planeBasis(normal, new THREE.Vector3(1, 0, 5));
    expect(u.distanceTo(new THREE.Vector3(1, 0, 0))).toBeCloseTo(0, 9);
  });

  it('falls back rather than degenerating when the preference is parallel to N', () => {
    // Carrying an in-plane axis through a large rotation eventually produces
    // exactly this, and a zero-length basis would render a rectangle of NaNs.
    const normal = new THREE.Vector3(0, 0, 1);
    const { u, v } = planeBasis(normal, new THREE.Vector3(0, 0, -3));
    expect(u.length()).toBeCloseTo(1, 9);
    expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
    expect(u.dot(normal)).toBeCloseTo(0, 9);
  });
});

describe('tiltedNormal — dragging one edge handle', () => {
  const RIGHT = new THREE.Vector3(1, 0, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const RATE = 0.006;

  /*
   * A plane seen EDGE-ON: its normal lies across the screen, so a handle on it
   * has a real screen direction to move in and the "follows the pointer" rule
   * is the one in force. The face-on case is degenerate by construction — a
   * handle can only move perpendicular to its plane — and is covered on its own
   * below.
   */
  const EDGE_ON = new THREE.Vector3(1, 0, 0);
  /** The `v+` handle on that plane: drawn upward on screen. */
  const TOP = new THREE.Vector3(0, 1, 0);
  /** The `u+` handle on that plane: drawn into the screen. */
  const AWAY = new THREE.Vector3(0, 0, -1);

  it('keeps the normal a unit vector', () => {
    for (const [dx, dy] of [[0, 0], [300, 0], [0, -240], [180, 260], [-900, 700]]) {
      expect(tiltedNormal(EDGE_ON, TOP, RIGHT, UP, dx, dy, RATE).length()).toBeCloseTo(1, 9);
    }
  });

  it('does nothing for a gesture that has not moved', () => {
    expect(tiltedNormal(EDGE_ON, TOP, RIGHT, UP, 0, 0, RATE).distanceTo(EDGE_ON))
      .toBeCloseTo(0, 9);
  });

  it('depends only on where the drag ended, not on how it got there', () => {
    /*
     * The property the frozen start normal exists for. Applying small rotations
     * to the LIVE normal makes the result a function of the pointer's sampling
     * rate — the same gesture lands somewhere different on a slow machine — and
     * dragging back to the start does not return the plane to the start.
     */
    const direct = tiltedNormal(EDGE_ON, TOP, RIGHT, UP, 120, 80, RATE);
    let stepped = EDGE_ON.clone();
    for (let step = 1; step <= 40; step += 1) {
      stepped = tiltedNormal(EDGE_ON, TOP, RIGHT, UP, (120 * step) / 40, (80 * step) / 40, RATE);
    }
    expect(stepped.distanceTo(direct)).toBeCloseTo(0, 9);
    expect(tiltedNormal(EDGE_ON, TOP, RIGHT, UP, 0, 0, RATE).distanceTo(EDGE_ON))
      .toBeCloseTo(0, 9);
  });

  it('moves the grabbed handle the way the pointer moved', () => {
    /*
     * THE rule. A handle at `R * dir` can only move perpendicular to the plane,
     * so its screen velocity is the projection of `-N`. Here `N` is `+x`, so a
     * positive angle carries the handle to screen-LEFT, and dragging left must
     * therefore be what produces a positive angle.
     *
     * Checked by displacing the handle rather than by inspecting the normal,
     * because "the dot follows my mouse" is a claim about the dot.
     */
    const handleAfter = (dx: number, dy: number, dir: THREE.Vector3) => {
      const turned = tiltedNormal(EDGE_ON, dir, RIGHT, UP, dx, dy, RATE);
      // The handle rides the plane: rotate its direction by the same rotation.
      const axis = EDGE_ON.clone().cross(dir).normalize();
      const angle = EDGE_ON.angleTo(turned) * (turned.dot(dir) >= 0 ? 1 : -1);
      const moved = dir.clone().applyQuaternion(
        new THREE.Quaternion().setFromAxisAngle(axis, angle),
      );
      // Camera-frame screen delta, with y measured downward.
      return { x: moved.dot(RIGHT) - dir.dot(RIGHT), y: -(moved.dot(UP) - dir.dot(UP)) };
    };

    // Drag left: the handle goes left.
    expect(handleAfter(-160, 0, TOP).x).toBeLessThan(0);
    // Drag right: the handle goes right.
    expect(handleAfter(160, 0, TOP).x).toBeGreaterThan(0);
    // And the handle on the other in-plane axis follows the same pointer the
    // same way — it is the same perpendicular motion, about a different axis.
    expect(handleAfter(-160, 0, AWAY).x).toBeLessThan(0);
  });

  it('gives an edge pair two opposite controls, not one doubled', () => {
    /*
     * Pulling the near edge forward and pushing the far edge forward are
     * different motions of the same plate, so opposite handles must tip the
     * plane in opposite senses. An earlier revision measured the drag along the
     * handle's own direction, which made them identical and made the dot move
     * against the pointer.
     */
    const plus = tiltedNormal(EDGE_ON, TOP, RIGHT, UP, 160, 0, RATE);
    const minus = tiltedNormal(EDGE_ON, TOP.clone().negate(), RIGHT, UP, 160, 0, RATE);
    expect(plus.dot(TOP)).toBeLessThan(0);
    expect(minus.dot(TOP)).toBeGreaterThan(0);
    /*
     * Both handles still travel the SAME way on screen — a handle's velocity is
     * the projection of `-N` whichever edge it sits on — which is exactly why
     * the two rotations come out opposite: dragging the top edge right and
     * dragging the bottom edge right tip the plate against each other.
     */
  });

  it('reads only the drag component along the direction the handle can move', () => {
    // `N` is `+x` here, so the handle moves horizontally on screen and a purely
    // vertical drag is not a tilt of it.
    expect(tiltedNormal(EDGE_ON, TOP, RIGHT, UP, 0, 250, RATE).distanceTo(EDGE_ON))
      .toBeCloseTo(0, 9);
  });

  it('still turns a plane that is face-on, where the handle cannot move on screen', () => {
    /*
     * Degenerate by construction: with `N` pointing at the camera the handle's
     * only available motion is toward or away from the viewer, which is almost
     * no screen motion at all. The gesture falls back to tipping the edge the
     * way a picture frame tips — push an edge inward and it goes away — because
     * a dead control is worse than an arbitrary-but-consistent one.
     */
    const faceOn = new THREE.Vector3(0, 0, 1);
    const turned = tiltedNormal(faceOn, TOP, RIGHT, UP, 0, 200, RATE);
    expect(turned.length()).toBeCloseTo(1, 9);
    // Dragging the top edge DOWN tips `N` up, i.e. carries that edge away.
    expect(turned.dot(TOP)).toBeGreaterThan(0);
  });

  it('is a no-op for a handle direction that is not in the plane at all', () => {
    const result = tiltedNormal(EDGE_ON, EDGE_ON.clone(), RIGHT, UP, 300, 300, RATE);
    expect(result.distanceTo(EDGE_ON)).toBeCloseTo(0, 9);
  });

  it('turns the plane about an in-plane axis, so the tilt has no roll in it', () => {
    // The handle's own direction and the normal stay in one plane through the
    // gesture: a tilt that also rolled would turn the rectangle under the hand.
    const turned = tiltedNormal(EDGE_ON, TOP, RIGHT, UP, 220, 0, RATE);
    const perpendicular = EDGE_ON.clone().cross(TOP).normalize();
    expect(turned.dot(perpendicular)).toBeCloseTo(0, 9);
  });

  it('leaves `s` alone, which is the caller keeping the plane on its pivot', () => {
    /*
     * Stated here because the invariant is about the PAIR: the rotation returns
     * a normal and nothing else, so `s` cannot change, so the plane turns about
     * `C` rather than walking through the heart as it turns.
     */
    const turned = tiltedNormal(EDGE_ON, TOP, RIGHT, UP, 150, -90, RATE);
    const before = planeAnchor({ normal: EDGE_ON, offset: 12, flipped: false }, PIVOT);
    const after = planeAnchor({ normal: turned, offset: 12, flipped: false }, PIVOT);
    expect(before.distanceTo(PIVOT)).toBeCloseTo(12, 9);
    expect(after.distanceTo(PIVOT)).toBeCloseTo(12, 9);
  });
});

describe('draggedOffset — the depth arrow that replaced the slider', () => {
  const RIGHT = new THREE.Vector3(1, 0, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  /** A plane seen edge-on: its normal lies across the screen, to the right. */
  const EDGE_ON = new THREE.Vector3(1, 0, 0);

  it('moves the plane at 1:1 with the hand, in model units', () => {
    /*
     * The whole reason the arrow beats the slider it replaced: the plane tracks
     * the pointer through the scene, at the scale of the scene, instead of
     * moving at a gain set by a control's travel. 40 px of drag at 0.5 units
     * per pixel is 20 units of depth, whatever the zoom happens to be.
     */
    expect(draggedOffset(10, EDGE_ON, RIGHT, UP, 40, 0, 0.5)).toBeCloseTo(30, 12);
    expect(draggedOffset(10, EDGE_ON, RIGHT, UP, 40, 0, 0.25)).toBeCloseTo(20, 12);
  });

  it('follows the normal\'s own screen direction, in both senses', () => {
    expect(draggedOffset(0, EDGE_ON, RIGHT, UP, 60, 0, 1)).toBeGreaterThan(0);
    expect(draggedOffset(0, EDGE_ON, RIGHT, UP, -60, 0, 1)).toBeLessThan(0);
  });

  it('ignores the drag component across the arrow', () => {
    // The arrow is one axis. A drag perpendicular to it is not a depth change
    // and must not become one.
    expect(draggedOffset(7, EDGE_ON, RIGHT, UP, 0, 120, 1)).toBeCloseTo(7, 12);
  });

  it('depends only on where the drag ended, not on how it got there', () => {
    const direct = draggedOffset(3, EDGE_ON, RIGHT, UP, 90, 0, 0.4);
    let stepped = 3;
    for (let step = 1; step <= 30; step += 1) {
      stepped = draggedOffset(3, EDGE_ON, RIGHT, UP, (90 * step) / 30, 0, 0.4);
    }
    expect(stepped).toBeCloseTo(direct, 12);
    expect(draggedOffset(3, EDGE_ON, RIGHT, UP, 0, 0, 0.4)).toBeCloseTo(3, 12);
  });

  it('is a no-op on a plane seen face-on, where depth has no screen direction', () => {
    /*
     * `N` pointing at the camera projects to nothing: a face-on plane has no
     * visible depth to move through, and no mapping can invent one. Returning
     * the start offset is the whole handling — the alternative is a NaN that
     * would take the plane out of the scene entirely.
     */
    const faceOn = new THREE.Vector3(0, 0, 1);
    expect(draggedOffset(12, faceOn, RIGHT, UP, 200, 200, 1)).toBe(12);
    expect(draggedOffset(12, EDGE_ON, RIGHT, UP, 200, 0, Number.NaN)).toBe(12);
  });

  it('turns the plane about nothing — it only slides it', () => {
    // Depth and orientation are separate gestures on separate affordances, and
    // this one returns a scalar, so it cannot rotate anything by construction.
    const before = planeAnchor({ normal: EDGE_ON, offset: 4, flipped: false }, PIVOT);
    const after = planeAnchor(
      { normal: EDGE_ON, offset: draggedOffset(4, EDGE_ON, RIGHT, UP, 50, 0, 0.2), flipped: false },
      PIVOT,
    );
    // The anchor moved along the normal and nowhere else.
    const moved = after.clone().sub(before);
    expect(moved.clone().normalize().distanceTo(EDGE_ON)).toBeCloseTo(0, 9);
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
