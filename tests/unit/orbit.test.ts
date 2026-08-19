/**
 * The orbit camera: the pole it used to be fenced away from, and the roll two
 * angles could not express.
 *
 * `contracts/viewer-core.md` wants a globe-viewer orbit around `C`. What made
 * that hard is not the orbit, it is the top of it: a camera positioned from
 * angles but handed a fixed `up` of (0, 1, 0) has no basis when it looks
 * straight down, and is upside down past that. The previous implementation
 * clamped pitch to +-1.5 radians to avoid it, which also made the heart
 * impossible to turn over — and turning it over is the point, since a subcostal
 * view is read from underneath.
 *
 * The second half of this file is "match echo orientation", which is the reason
 * the state is a full rotation rather than two angles: viewing the model as the
 * echo presents it generally requires a roll, and yaw and pitch cannot name one.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  GLIDE_MS,
  dragOrientation,
  echoOrientation,
  glideEasing,
  glideStep,
  levelled,
  lockedDragOrientation,
  orbitPose,
  orientationFromYawPitch,
  orientationLooking,
  shortestTarget,
  wrapAngle,
} from '../../src/viewer/orbit.ts';
import { imagingFrame } from '../../src/echo/probeFrame.ts';
import type { ProbePose } from '../../src/schema/packV0.ts';

const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

/** Where the camera looks, given its orientation. */
function forwardOf(orientation: THREE.Quaternion): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
}

function probe(overrides: Partial<ProbePose> = {}): ProbePose {
  return {
    origin: [0, 0, 0],
    beam_axis: [0, 1, 0],
    lateral_axis: [1, 0, 0],
    fan: { angle_deg: 80, depth_cm: 12, focus_cm: 6 },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
    ...overrides,
  } as ProbePose;
}

describe('orbitPose', () => {
  it('keeps the camera on its sphere at every pitch', () => {
    for (let pitch = -HALF_TURN; pitch <= HALF_TURN; pitch += 0.1) {
      const pose = orbitPose(orientationFromYawPitch(0.9, pitch), 400);
      expect(pose.offset.length()).toBeCloseTo(400, 4);
    }
  });

  it('always yields a unit up perpendicular to the view direction', () => {
    // The property `lookAt` needs and a fixed up cannot supply. Checked at the
    // poles explicitly, because they are exactly where it used to fail.
    for (const pitch of [-HALF_TURN, -QUARTER_TURN, -0.4, 0, 0.4, QUARTER_TURN, HALF_TURN]) {
      const { offset, up } = orbitPose(orientationFromYawPitch(0.7, pitch), 250);
      expect(up.length()).toBeCloseTo(1, 6);
      expect(up.dot(offset.clone().normalize())).toBeCloseTo(0, 6);
    }
  });

  it('starts upright, with the camera in front of the pivot', () => {
    const { offset, up } = orbitPose(orientationFromYawPitch(0, 0), 100);
    expect(offset.x).toBeCloseTo(0, 6);
    expect(offset.y).toBeCloseTo(0, 6);
    expect(offset.z).toBeCloseTo(100, 6);
    expect(up.y).toBeCloseTo(1, 6);
  });

  it('raises the camera for positive pitch', () => {
    // The drag sense the viewer was authored against: drag down, camera rises.
    expect(orbitPose(orientationFromYawPitch(0, 0.5), 100).offset.y).toBeGreaterThan(0);
    expect(orbitPose(orientationFromYawPitch(0, -0.5), 100).offset.y).toBeLessThan(0);
  });

  it('looks straight down from the top of the orbit without degenerating', () => {
    const { offset, up } = orbitPose(orientationFromYawPitch(0, QUARTER_TURN), 100);
    expect(offset.y).toBeCloseTo(100, 4);
    expect(up.y).toBeCloseTo(0, 6);
    expect(up.length()).toBeCloseTo(1, 6);
  });

  it('turns fully upside down at half a turn of pitch', () => {
    // The case the clamp made unreachable: the model genuinely inverted, with
    // the camera back on the far side and up pointing at the floor.
    const { offset, up } = orbitPose(orientationFromYawPitch(0, HALF_TURN), 100);
    expect(offset.z).toBeCloseTo(-100, 4);
    expect(up.y).toBeCloseTo(-1, 6);
  });

  it('scales with radius and not with anything else', () => {
    const orientation = orientationFromYawPitch(1.2, 0.8);
    const near = orbitPose(orientation, 50);
    const far = orbitPose(orientation, 500);
    expect(far.offset.clone().divideScalar(10).distanceTo(near.offset)).toBeCloseTo(0, 6);
    expect(far.up.distanceTo(near.up)).toBeCloseTo(0, 6);
  });
});

describe('dragOrientation', () => {
  it('turns the model without moving it off its sphere', () => {
    let orientation = orientationFromYawPitch(0.9, 0.35);
    for (let step = 0; step < 40; step += 1) {
      orientation = dragOrientation(orientation, 37, 23);
      expect(orbitPose(orientation, 300).offset.length()).toBeCloseTo(300, 3);
      expect(orbitPose(orientation, 300).up.length()).toBeCloseTo(1, 6);
    }
  });

  it('carries the camera past a pole instead of stopping there', () => {
    // 250 px of vertical drag is about 2 radians, well past the old +-1.5 stop.
    const start = orientationFromYawPitch(0, 0);
    const past = dragOrientation(start, 0, 250);
    const further = dragOrientation(past, 0, 250);
    expect(forwardOf(past).angleTo(forwardOf(start))).toBeGreaterThan(1.5);
    expect(forwardOf(further).angleTo(forwardOf(past))).toBeGreaterThan(1.5);
  });

  it('carries the near face of the model the way the pointer goes', () => {
    /*
     * The vertical sense, stated as what the learner sees rather than as a sign
     * in a quaternion. Take the point of the model directly facing the camera —
     * the front — and drag UP: it has to end up higher on screen. The opposite
     * sign makes the near surface run away from the pointer, which reads as the
     * model being pushed rather than turned, and is easy to reintroduce because
     * both signs produce a perfectly smooth orbit.
     *
     * "Higher on screen" is measured against the camera's own up, since the
     * camera can be rolled and world Y is not the screen's vertical.
     */
    for (const pitch of [0, 0.5, -0.9]) {
      for (const yaw of [0, 1.1, -2.2]) {
        const before = orientationFromYawPitch(yaw, pitch);
        // The model point nearest the camera, on the unit sphere about `C`.
        const front = orbitPose(before, 300).offset.clone().normalize();
        // It starts on the screen's vertical centre, by construction.
        expect(front.dot(orbitPose(before, 300).up)).toBeCloseTo(0, 9);

        // Where that same point sits after the drag, against the NEW screen up.
        const heightAfter = (dy: number) =>
          front.dot(orbitPose(dragOrientation(before, 0, dy), 300).up);

        // Negative dy is a drag UP: pointer coordinates grow downward.
        expect(heightAfter(-40)).toBeGreaterThan(0);
        expect(heightAfter(40)).toBeLessThan(0);
      }
    }
  });

  it('reaches a rolled orientation a turntable could not name', () => {
    /*
     * The reason the drag is about the CAMERA's axes rather than world up.
     *
     * A turntable fixes the screen's up from world up, so it cannot roll: there
     * is no drag that tilts the model on screen, and the owner's "I cannot get
     * the heart to the angle I want" is exactly that. Local rotations generate
     * the whole group, and roll falls out of a CURVED drag the way it does when
     * you turn something over in your hand.
     *
     * Stated as what the learner sees: drag right, then down, then left, then
     * up — a closed loop that a turntable would return to where it started —
     * and the screen's up must have moved.
     */
    const start = orientationFromYawPitch(0.3, 0.2);
    const upBefore = orbitPose(start, 300).up;

    let orientation = start;
    for (const [dx, dy] of [[60, 0], [0, 60], [-60, 0], [0, -60]] as [number, number][]) {
      orientation = dragOrientation(orientation, dx, dy);
    }

    // Back where it started as a VIEW DIRECTION — the loop closes on the sphere.
    const forwardBefore = forwardOf(start);
    expect(forwardOf(orientation).dot(forwardBefore)).toBeGreaterThan(0.99);
    // But rolled: the screen's up has turned about the view direction.
    const upAfter = orbitPose(orientation, 300).up;
    expect(upAfter.dot(upBefore)).toBeLessThan(0.999);
  });

  it('keeps horizontal drag meaning one thing after the model turns over', () => {
    /*
     * Past a pole the camera's up inverts and a world-Y rotation reads
     * backwards on screen. Without the correction the model fights the pointer
     * for the whole upside-down half of the orbit.
     *
     * Stated as what the learner sees: take the point of the model directly
     * facing the camera, which is on the screen's vertical centreline and so
     * has screen-x zero. Drag right, and it has to end up on the right —
     * whichever way up the camera happens to be.
     */
    const rightOf = (orientation: THREE.Quaternion) =>
      new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);

    for (const pitch of [0, 0.6, -1.2, HALF_TURN * 0.6, HALF_TURN * 0.95, -HALF_TURN * 0.8]) {
      for (const yaw of [0, 0.4, 2.7]) {
        const before = orientationFromYawPitch(yaw, pitch);
        const facing = forwardOf(before).negate(); // the model point in the middle
        expect(facing.dot(rightOf(before))).toBeCloseTo(0, 6);
        expect(facing.dot(rightOf(dragOrientation(before, 30, 0)))).toBeGreaterThan(0);
        expect(facing.dot(rightOf(dragOrientation(before, -30, 0)))).toBeLessThan(0);
      }
    }
  });
});

describe('orientationLooking', () => {
  it('looks where it is told, with the requested up', () => {
    const orientation = orientationLooking(
      new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0),
    );
    expect(forwardOf(orientation).distanceTo(new THREE.Vector3(0, 0, -1))).toBeCloseTo(0, 6);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(orientation).y).toBeCloseTo(1, 6);
  });

  it('orthogonalises an up that is not square to the view direction', () => {
    const orientation = orientationLooking(
      new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, -0.4),
    );
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);
    expect(up.length()).toBeCloseTo(1, 6);
    expect(up.dot(forwardOf(orientation))).toBeCloseTo(0, 6);
  });

  it('refuses an up parallel to the view direction rather than producing NaNs', () => {
    expect(() => orientationLooking(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0),
    )).toThrow(/parallel/);
  });
});

describe('echoOrientation', () => {
  it('puts the camera face-on to the imaging plane', () => {
    // The plane's normal is the one direction from which the fan is not
    // foreshortened; anything else shows the echo's plane edge-on.
    const frame = imagingFrame(probe());
    const forward = forwardOf(echoOrientation(frame));
    const normal = new THREE.Vector3(...frame.normal);
    expect(Math.abs(forward.dot(normal))).toBeCloseTo(1, 6);
  });

  it('runs the beam UP the screen for a vertex-down view', () => {
    /*
     * The paediatric default for the subcostal and apical families: the
     * transducer at the bottom of the panel, depth increasing upward. The model
     * has to be turned so that the same thing is true of it.
     */
    const frame = imagingFrame(probe({ display: { vertex: 'down', flip_lr: false, marker_side: 'right' } }));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(echoOrientation(frame));
    expect(up.dot(new THREE.Vector3(...frame.beam))).toBeCloseTo(1, 6);
  });

  it('runs the beam DOWN the screen for a vertex-up view', () => {
    const frame = imagingFrame(probe({ display: { vertex: 'up', flip_lr: false, marker_side: 'right' } }));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(echoOrientation(frame));
    expect(up.dot(new THREE.Vector3(...frame.beam))).toBeCloseTo(-1, 6);
  });

  it('honours flip_lr by viewing from the other side, never by mirroring', () => {
    /*
     * A mirrored model is a left-handed heart, and an anatomy viewer must not
     * be able to show one by accident. So flip_lr swaps which side of the plane
     * the camera stands on: the fan's lateral axis still runs the same way
     * across the screen, and the heart is still the heart.
     */
    const plain = echoOrientation(imagingFrame(probe()));
    const flipped = echoOrientation(imagingFrame(
      probe({ display: { vertex: 'down', flip_lr: true, marker_side: 'right' } }),
    ));
    expect(forwardOf(flipped).dot(forwardOf(plain))).toBeCloseTo(-1, 6);

    // Same up either way: only the viewing side changed.
    const upOf = (q: THREE.Quaternion) => new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(upOf(flipped).distanceTo(upOf(plain))).toBeCloseTo(0, 6);
  });

  it('produces an orientation an orbit of two angles could not reach', () => {
    /*
     * The reason the camera state is a full rotation. A yaw/pitch camera's up
     * always lies in the plane of world-up and the view direction; this pose's
     * does not, so no pair of angles names it.
     */
    const frame = imagingFrame(probe({
      beam_axis: [0.3, 0.6, 0.74],
      lateral_axis: [0.87, -0.49, 0.045],
    }));
    const orientation = echoOrientation(frame);
    const forward = forwardOf(orientation);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(orientation);

    // What a yaw/pitch camera would have produced for the same view direction.
    const yaw = Math.atan2(-forward.x, -forward.z);
    const pitch = Math.asin(-forward.y);
    const reachable = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(orientationFromYawPitch(yaw, pitch));

    expect(up.angleTo(reachable)).toBeGreaterThan(0.2);
  });
});

describe('the animated transition', () => {
  /*
   * Tested here rather than from rendered frames. Counting distinct frames in
   * the browser looked like the honest check and is not: headless software GL
   * draws this scene at a few frames per second, so a 700 ms animation and an
   * instant cut produce the same handful of frames and the test measures the
   * machine rather than the code.
   */
  const from = orientationFromYawPitch(0.9, 0.35);
  const to = orientationFromYawPitch(-1.4, -0.8);

  it('eases in and out between the two ends', () => {
    expect(glideEasing(0)).toBe(0);
    expect(glideEasing(1)).toBe(1);
    expect(glideEasing(0.5)).toBeCloseTo(0.5, 6);
    // Slower at both ends than in the middle — that is what "eased" means.
    expect(glideEasing(0.1)).toBeLessThan(0.1);
    expect(glideEasing(0.9)).toBeGreaterThan(0.9);
  });

  it('clamps rather than overshooting outside the transition', () => {
    expect(glideEasing(-3)).toBe(0);
    expect(glideEasing(4)).toBe(1);
  });

  it('is somewhere in between while it is running', () => {
    // The property that separates an animation from a cut: at half the
    // duration the camera is at neither end.
    const midway = glideStep(from, to, GLIDE_MS / 2).orientation;
    expect(midway.angleTo(from)).toBeGreaterThan(0.05);
    expect(midway.angleTo(to)).toBeGreaterThan(0.05);
    expect(glideStep(from, to, GLIDE_MS / 2).done).toBe(false);
  });

  it('advances monotonically toward the target', () => {
    let previous = Infinity;
    for (let elapsed = 0; elapsed <= GLIDE_MS; elapsed += GLIDE_MS / 20) {
      const remaining = glideStep(from, to, elapsed).orientation.angleTo(to);
      expect(remaining).toBeLessThanOrEqual(previous + 1e-9);
      previous = remaining;
    }
  });

  it('arrives exactly, and reports that it has', () => {
    const landed = glideStep(from, to, GLIDE_MS);
    expect(landed.done).toBe(true);
    expect(landed.orientation.angleTo(to)).toBeCloseTo(0, 6);
    expect(glideStep(from, to, GLIDE_MS * 3).done).toBe(true);
  });
});

describe('shortestTarget', () => {
  it('leaves a target on the near arc alone', () => {
    const near = orientationFromYawPitch(0.9, 0.35);
    const target = orientationFromYawPitch(1.1, 0.4);
    expect(shortestTarget(near, target).dot(target)).toBeCloseTo(1, 6);
  });

  it('negates a target that would otherwise take the long way round', () => {
    /*
     * A quaternion and its negation name the same orientation, and slerp
     * follows whichever arc it is handed — so without this the camera
     * occasionally swings through most of a full turn to reach a pose it could
     * have reached directly.
     */
    const from = orientationFromYawPitch(0.9, 0.35);
    const target = orientationFromYawPitch(0.95, 0.4);
    const inverted = new THREE.Quaternion(-target.x, -target.y, -target.z, -target.w);

    const corrected = shortestTarget(from, inverted);
    expect(from.dot(corrected)).toBeGreaterThan(0);
    // Same orientation either way, so the destination is unchanged.
    expect(corrected.angleTo(target)).toBeCloseTo(0, 6);
  });

  it('never lengthens a glide, whatever it is handed', () => {
    const from = orientationFromYawPitch(0.2, -0.7);
    for (const [yaw, pitch] of [[0, 0], [2.9, 1.2], [-2.9, -1.2], [1.5, HALF_TURN * 0.95]]) {
      const target = orientationFromYawPitch(yaw, pitch);
      for (const candidate of [target, new THREE.Quaternion(-target.x, -target.y, -target.z, -target.w)]) {
        const halfway = glideStep(from, shortestTarget(from, candidate), GLIDE_MS / 2).orientation;
        // Half the eased path is at most half the total turn, never more.
        expect(halfway.angleTo(from)).toBeLessThanOrEqual(from.angleTo(target) + 1e-6);
      }
    }
  });
});

describe('wrapAngle', () => {
  it('leaves angles already in range alone', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 9);
    expect(wrapAngle(1.5)).toBeCloseTo(1.5, 9);
    expect(wrapAngle(-1.5)).toBeCloseTo(-1.5, 9);
  });

  it('folds rather than clamps, so every angle stays reachable', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 6); // [-pi, pi)
    expect(wrapAngle(Math.PI * 2 + 0.4)).toBeCloseTo(0.4, 9);
    expect(wrapAngle(-Math.PI * 2 - 0.4)).toBeCloseTo(-0.4, 9);
  });

  it('describes the same orientation it was given', () => {
    for (const angle of [7.3, -7.3, 100, -0.001]) {
      expect(Math.cos(wrapAngle(angle))).toBeCloseTo(Math.cos(angle), 6);
      expect(Math.sin(wrapAngle(angle))).toBeCloseTo(Math.sin(angle), 6);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* the horizon lock — Echo only, off by default                               */
/* -------------------------------------------------------------------------- */

/**
 * ONE ANSWER ABOUT WHICH WAY IS UP.
 *
 * The trackball made every orientation reachable and gave up the level horizon
 * (`docs/observations.md` entry 35). For a tool whose subject IS orientation
 * that is arguably the wrong trade, so the lock comes back as an OPTION in Echo
 * — where which way is up is diagnostic — and never as the behaviour, because
 * the reason the turntable went is still true in Explore.
 *
 * What it holds vertical is the MODEL's long axis, not world up. Those are the
 * same thing only while the heart happens to be upright, and holding the heart
 * upright is the whole job.
 */
describe('the horizon lock', () => {
  const axis = new THREE.Vector3(0, 1, 0);

  /** Where `v` points after the camera's rotation, in the camera's own frame. */
  function inCamera(orientation: THREE.Quaternion, v: THREE.Vector3): THREE.Vector3 {
    return v.clone().applyQuaternion(orientation.clone().invert());
  }

  it('levels a rolled camera without moving where it looks', () => {
    const rolled = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7)
      .multiply(orientationFromYawPitch(0.9, 0.35));
    const before = new THREE.Vector3(0, 0, -1).applyQuaternion(rolled);

    const level = levelled(rolled, axis)!;
    expect(level).not.toBeNull();

    const after = new THREE.Vector3(0, 0, -1).applyQuaternion(level);
    expect(after.angleTo(before)).toBeLessThan(1e-6);

    // The axis now projects onto the screen's up, with no sideways component.
    const screen = inCamera(level, axis);
    expect(Math.abs(screen.x)).toBeLessThan(1e-6);
    expect(screen.y).toBeGreaterThan(0);
  });

  it('keeps the axis vertical through a long horizontal drag', () => {
    let orientation = orientationFromYawPitch(0.9, 0.35);
    for (let step = 0; step < 40; step += 1) {
      orientation = lockedDragOrientation(orientation, 25, 0, axis);
      const screen = inCamera(orientation, axis);
      expect(Math.abs(screen.x)).toBeLessThan(1e-6);
    }
  });

  it('keeps it vertical through a curved drag, which is where roll comes from', () => {
    let orientation = orientationFromYawPitch(0.9, 0.35);
    for (const [dx, dy] of [[30, 10], [20, -25], [-15, 30], [-30, -10], [25, 25]]) {
      orientation = lockedDragOrientation(orientation, dx, dy, axis);
      expect(Math.abs(inCamera(orientation, axis).x)).toBeLessThan(1e-6);
    }
  });

  it('stops short of the pole rather than tumbling through it', () => {
    let orientation = orientationFromYawPitch(0, 0);
    for (let step = 0; step < 200; step += 1) {
      orientation = lockedDragOrientation(orientation, 0, -30, axis);
    }
    // Still level, still looking at the model rather than down the axis.
    const screen = inCamera(orientation, axis);
    expect(Math.abs(screen.x)).toBeLessThan(1e-6);
    expect(screen.y).toBeGreaterThan(0);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
    expect(Math.abs(forward.dot(axis))).toBeLessThan(0.999);
  });

  it('has nothing to level at the pole, and says so', () => {
    const straightDown = orientationLooking(
      new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, -1),
    );
    expect(levelled(straightDown, axis)).toBeNull();
  });

  /* Unlocked drag is unchanged: the trackball is still the default. */
  it('is not what an unlocked drag does', () => {
    const start = orientationFromYawPitch(0.9, 0.35);
    const free = dragOrientation(dragOrientation(start, 40, 30), -40, 30);
    expect(Math.abs(inCamera(free, axis).x)).toBeGreaterThan(1e-3);
  });

  /* And the axis is the MODEL's, not the world's. */
  it('holds a tilted model axis vertical, which world up would not', () => {
    const tilted = new THREE.Vector3(0.3, 0.9, 0.1).normalize();
    let orientation = levelled(orientationFromYawPitch(0.9, 0.35), tilted)!;
    for (let step = 0; step < 12; step += 1) {
      orientation = lockedDragOrientation(orientation, 20, 8, tilted);
    }
    expect(Math.abs(inCamera(orientation, tilted).x)).toBeLessThan(1e-6);
    expect(Math.abs(inCamera(orientation, new THREE.Vector3(0, 1, 0)).x)).toBeGreaterThan(1e-3);
  });
});
