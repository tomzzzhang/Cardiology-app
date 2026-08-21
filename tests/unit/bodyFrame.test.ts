/**
 * Model space to body space.
 *
 * ## The fixture is non-identity ON PURPOSE
 *
 * Every shipped pack has an identity `canonical_pose`, and before this change
 * the app had no second transform either — so model and world coordinates were
 * numerically equal everywhere. A consumer that used a model-space quantity as
 * a world-space one was indistinguishable from a correct one, and there were
 * such consumers. A test that exercised the identity would reproduce exactly
 * that blindness.
 *
 * So `FIXTURE` is a deliberately awkward rotation about an off-axis axis with a
 * large translation. Under it, a point-vs-vector confusion moves things by
 * hundreds of millimetres and a dropped conversion is not subtle.
 */
import { describe, expect, it } from 'vitest';

import { imagingFrame } from '../../src/echo/probeFrame.ts';
import type { ProbePose } from '../../src/schema/packV0.ts';
import type { Vec3 } from '../../src/schema/primitives.ts';
import { rigidProblem, type Mat3 } from '../../src/schema/bodyContextV0.ts';
import {
  IDENTITY_TRANSFORM,
  frameToBody,
  isIdentity,
  pointToBody,
  pointToModel,
  rigidTransform,
  vectorToBody,
  vectorToModel,
} from '../../src/viewer/bodyFrame.ts';

/** Rotation of `angle` about a unit axis, row-major (Rodrigues). */
function rotationAbout(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

const AXIS: Vec3 = (() => {
  const raw: Vec3 = [0.3, -0.8, 0.5];
  const n = Math.hypot(...raw);
  return [raw[0] / n, raw[1] / n, raw[2] / n];
})();

const FIXTURE = rigidTransform(rotationAbout(AXIS, 0.9), [28.999, -127.915, 1213.923]);

const POSE: ProbePose = {
  origin: [12, -34, 56],
  beam_axis: [0, 1, 0],
  lateral_axis: [1, 0, 0],
  fan: { angle_deg: 60, depth_cm: 14, focus_cm: 9 },
  display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
} as unknown as ProbePose;

const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('rigidProblem refuses what a registration must never be', () => {
  const identity: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  it('accepts a proper rotation', () => {
    expect(rigidProblem(identity)).toBeNull();
    expect(rigidProblem(rotationAbout(AXIS, 1.3))).toBeNull();
  });

  it('refuses a uniform scale, and says it is a scale', () => {
    const scaled = identity.map((v) => v * 1.05) as unknown as Mat3;
    expect(rigidProblem(scaled)).toMatch(/uniform scale/);
  });

  it('refuses a non-uniform scale as a deformation', () => {
    const stretched: Mat3 = [1.2, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(rigidProblem(stretched)).toMatch(/non-uniform scale/);
  });

  it('refuses a shear', () => {
    const sheared: Mat3 = [1, 0.2, 0, 0, 1, 0, 0, 0, 1];
    // A shear changes column lengths too, so either message is a correct
    // refusal; what matters is that it is refused and named as a deformation.
    expect(rigidProblem(sheared)).toMatch(/shear|scale/);
  });

  it('refuses a reflection, and says a mirrored heart is a different organ', () => {
    const mirrored: Mat3 = [-1, 0, 0, 0, 1, 0, 0, 0, 1];
    expect(rigidProblem(mirrored)).toMatch(/reflection/);
  });

  it('refuses malformed numbers', () => {
    expect(rigidProblem([1, 0, 0, 0, Number.NaN, 0, 0, 0, 1])).toMatch(/finite/);
    expect(rigidProblem([1, 0, 0, 0, 1, 0, 0, 0, Number.POSITIVE_INFINITY])).toMatch(/finite/);
  });

  it('rigidTransform throws on all of them, rather than repairing quietly', () => {
    expect(() => rigidTransform(identity.map((v) => v * 2) as unknown as Mat3, [0, 0, 0]))
      .toThrow(/not a rigid transform/);
    expect(() => rigidTransform(identity, [0, Number.NaN, 0])).toThrow(/not finite/);
  });
});

describe('points and vectors are transformed differently', () => {
  it('a point picks up the translation', () => {
    const p: Vec3 = [1, 2, 3];
    const body = pointToBody(FIXTURE, p);
    expect(body).not.toEqual(p);
    // The translation is large, so a point that ignored it would be obvious.
    expect(Math.hypot(...body)).toBeGreaterThan(1000);
  });

  it('a direction does NOT pick up the translation, and stays unit-length', () => {
    const v: Vec3 = [0, 1, 0];
    const body = vectorToBody(FIXTURE, v);
    close(Math.hypot(...body), 1);
    expect(Math.hypot(...body)).toBeLessThan(2);
  });

  it('a direction transformed as a point would be wrong by the translation', () => {
    const v: Vec3 = [0, 1, 0];
    const asVector = vectorToBody(FIXTURE, v);
    const asPoint = pointToBody(FIXTURE, v);
    const gap = Math.hypot(
      asPoint[0] - asVector[0], asPoint[1] - asVector[1], asPoint[2] - asVector[2],
    );
    close(gap, Math.hypot(...FIXTURE.translation), 1e-6);
    expect(gap).toBeGreaterThan(1000);
  });
});

describe('round trips are exact', () => {
  it('point -> body -> model returns the point', () => {
    for (const p of [[0, 0, 0], [12, -34, 56], [-1e3, 2e3, 5]] as Vec3[]) {
      const back = pointToModel(FIXTURE, pointToBody(FIXTURE, p));
      p.forEach((value, i) => close(back[i], value, 1e-9));
    }
  });

  it('vector -> body -> model returns the vector', () => {
    for (const v of [[1, 0, 0], [0, -1, 0], [0.3, 0.4, -0.866]] as Vec3[]) {
      const back = vectorToModel(FIXTURE, vectorToBody(FIXTURE, v));
      v.forEach((value, i) => close(back[i], value, 1e-9));
    }
  });

  it('the identity transform changes nothing', () => {
    expect(isIdentity(IDENTITY_TRANSFORM)).toBe(true);
    expect(isIdentity(FIXTURE)).toBe(false);
    expect(pointToBody(IDENTITY_TRANSFORM, [3, 4, 5])).toEqual([3, 4, 5]);
    expect(vectorToBody(IDENTITY_TRANSFORM, [3, 4, 5])).toEqual([3, 4, 5]);
  });
});

describe('an imaging frame survives the transform intact', () => {
  const model = imagingFrame(POSE);
  const body = frameToBody(FIXTURE, model);

  it('stays orthonormal', () => {
    for (const axis of [body.beam, body.lateral, body.normal]) close(Math.hypot(...axis), 1);
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    close(dot(body.beam, body.lateral), 0, 1e-12);
    close(dot(body.beam, body.normal), 0, 1e-12);
    close(dot(body.lateral, body.normal), 0, 1e-12);
  });

  it('keeps the handedness the wedge and the shader assume', () => {
    const cross: Vec3 = [
      body.beam[1] * body.lateral[2] - body.beam[2] * body.lateral[1],
      body.beam[2] * body.lateral[0] - body.beam[0] * body.lateral[2],
      body.beam[0] * body.lateral[1] - body.beam[1] * body.lateral[0],
    ];
    cross.forEach((value, i) => close(body.normal[i], value, 1e-12));
  });

  it('moves the origin as a point and the axes as directions', () => {
    expect(body.origin).toEqual(pointToBody(FIXTURE, model.origin));
    const beam = vectorToBody(FIXTURE, model.beam);
    beam.forEach((value, i) => close(body.beam[i], value, 1e-12));
  });

  it('carries scalars through unchanged, which only a unit-scale map may do', () => {
    expect(body.depthMm).toBe(model.depthMm);
    expect(body.focusMm).toBe(model.focusMm);
    expect(body.halfAngleRad).toBe(model.halfAngleRad);
    expect(body.vertex).toBe(model.vertex);
    expect(body.flipLr).toBe(model.flipLr);
    expect(body.markerSide).toBe(model.markerSide);
  });

  it('preserves every distance inside the frame', () => {
    // The tip of the beam at full depth, computed in each space, must land in
    // the same place. This is the property that makes it safe for the wedge,
    // the cutter and the beam-dim shader to each derive their own geometry.
    const tipModel: Vec3 = [
      model.origin[0] + model.beam[0] * model.depthMm,
      model.origin[1] + model.beam[1] * model.depthMm,
      model.origin[2] + model.beam[2] * model.depthMm,
    ];
    const tipBody: Vec3 = [
      body.origin[0] + body.beam[0] * body.depthMm,
      body.origin[1] + body.beam[1] * body.depthMm,
      body.origin[2] + body.beam[2] * body.depthMm,
    ];
    pointToBody(FIXTURE, tipModel).forEach((value, i) => close(tipBody[i], value, 1e-6));
  });
});
