/**
 * The orbit camera, and the pole it used to be fenced away from.
 *
 * `contracts/viewer-core.md` wants a globe-viewer orbit around `C`. What made
 * that hard is not the orbit, it is the top of it: a camera positioned from
 * angles but handed a fixed `up` of (0, 1, 0) has no basis when it looks
 * straight down, and is upside down past that. The previous implementation
 * clamped pitch to +-1.5 radians to avoid it, which also made the heart
 * impossible to turn over — and turning it over is the point, since a subcostal
 * view is read from underneath and the apex-up/apex-down comparison needs both.
 *
 * So these tests are mostly about pitches the old code could not reach.
 */
import { describe, expect, it } from 'vitest';
import { orbitPose, wrapAngle, yawDirection } from '../../src/viewer/orbit.ts';

const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

describe('orbitPose', () => {
  it('keeps the camera on its sphere at every pitch', () => {
    for (let pitch = -HALF_TURN; pitch <= HALF_TURN; pitch += 0.1) {
      expect(orbitPose(0.9, pitch, 400).offset.length()).toBeCloseTo(400, 6);
    }
  });

  it('always yields a unit up perpendicular to the view direction', () => {
    // The property `lookAt` needs and a fixed up cannot supply. Checked at the
    // poles explicitly, because they are exactly where it used to fail.
    for (const pitch of [-HALF_TURN, -QUARTER_TURN, -0.4, 0, 0.4, QUARTER_TURN, HALF_TURN]) {
      const { offset, up } = orbitPose(0.7, pitch, 250);
      expect(up.length()).toBeCloseTo(1, 6);
      expect(up.dot(offset.clone().normalize())).toBeCloseTo(0, 6);
    }
  });

  it('starts upright, with the camera in front of the pivot', () => {
    const { offset, up } = orbitPose(0, 0, 100);
    expect(offset.x).toBeCloseTo(0, 6);
    expect(offset.y).toBeCloseTo(0, 6);
    expect(offset.z).toBeCloseTo(100, 6);
    expect(up.y).toBeCloseTo(1, 6);
  });

  it('raises the camera for positive pitch', () => {
    // The drag sense the viewer was authored against: drag down, camera rises.
    expect(orbitPose(0, 0.5, 100).offset.y).toBeGreaterThan(0);
    expect(orbitPose(0, -0.5, 100).offset.y).toBeLessThan(0);
  });

  it('looks straight down from the top of the orbit without degenerating', () => {
    const { offset, up } = orbitPose(0, QUARTER_TURN, 100);
    expect(offset.y).toBeCloseTo(100, 4);
    expect(up.y).toBeCloseTo(0, 6);
    expect(up.length()).toBeCloseTo(1, 6);
  });

  it('turns fully upside down at half a turn of pitch', () => {
    // The case the clamp made unreachable: the model genuinely inverted, with
    // the camera back on the far side and up pointing at the floor.
    const { offset, up } = orbitPose(0, HALF_TURN, 100);
    expect(offset.z).toBeCloseTo(-100, 4);
    expect(up.y).toBeCloseTo(-1, 6);
  });

  it('scales with radius and not with anything else', () => {
    const near = orbitPose(1.2, 0.8, 50);
    const far = orbitPose(1.2, 0.8, 500);
    expect(far.offset.clone().divideScalar(10).distanceTo(near.offset)).toBeCloseTo(0, 6);
    expect(far.up.distanceTo(near.up)).toBeCloseTo(0, 6);
  });
});

describe('yawDirection', () => {
  it('is positive while the camera is upright', () => {
    expect(yawDirection(0)).toBe(1);
    expect(yawDirection(1.2)).toBe(1);
    expect(yawDirection(-1.2)).toBe(1);
  });

  it('inverts once the camera has passed a pole', () => {
    // Without this the model fights the pointer for the whole upside-down half
    // of the orbit: the same drag turns it the opposite way.
    expect(yawDirection(2.0)).toBe(-1);
    expect(yawDirection(-2.0)).toBe(-1);
    expect(yawDirection(Math.PI)).toBe(-1);
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
