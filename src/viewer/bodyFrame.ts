/**
 * Model space to body space, and the reason there is exactly one of these.
 *
 * ## Two spaces, and which things live in which
 *
 * **MODEL space** is the pack's own. Everything authored or simulated stays in
 * it and is never rewritten:
 *
 * * `views[].probe`, `views[].sweep`, and every saved authoring slot;
 * * runtime free poses;
 * * the echo volume and every echo simulation input;
 * * exports and imports.
 *
 * **BODY space** is the patient frame — `+X` patient-left, `+Y` posterior,
 * `+Z` superior — and it is what the scene is rendered in. Everything the
 * learner sees or points at lives here: the posed heart, the probe indicator,
 * the wedge, the cutter plane, the beam-dim uniforms, the pivot, the camera.
 *
 * The rule is that model-space data is CONVERTED at the point of use rather
 * than converted once and stored twice. Two stored copies drift; a conversion
 * cannot.
 *
 * ## Why this file exists at all instead of a rotation baked into the pack
 *
 * The obvious shortcut is to write the rotation into `meshes.canonical_pose`
 * and let the scene graph carry it. That is wrong twice over.
 *
 * `canonical_pose` is the pack's own statement about how its mesh should be
 * presented, with its own provenance; the body registration is a fact about a
 * *pairing* of that pack with a reference body and belongs to the body-context
 * document. And baking it in would hide the actual hazard rather than fix it:
 * with `canonical_pose` identity in every shipped pack — which it is — model
 * and world coordinates are numerically equal, so a consumer that confuses the
 * two is indistinguishable from one that does not. There were such consumers.
 * They were invisible precisely because the transform was the identity.
 *
 * So the transform is deliberately NON-IDENTITY, deliberately separate, and
 * every spatial consumer is routed through the helpers below. `tests/unit`
 * exercises the whole set against a non-identity fixture for the same reason.
 *
 * ## Points and vectors are different, and mixing them is the classic bug
 *
 * A point translates. A direction does not. `pointToBody` applies the
 * translation; `vectorToBody` does not. Passing a beam axis through the point
 * helper puts the origin's offset into a unit vector and produces a beam that
 * is subtly wrong everywhere except at the origin — which is exactly the sort
 * of error that survives review because it looks fine on one view.
 */
import type { ImagingFrame } from '../echo/probeFrame.ts';
import { cross, dot, normalize } from '../echo/probeFrame.ts';
import type { Vec3 } from '../schema/primitives.ts';
import { rigidProblem, type Mat3 } from '../schema/bodyContextV0.ts';

/**
 * A rigid model-to-body transform, already validated.
 *
 * Construct through `rigidTransform`, which refuses anything that is not
 * orthonormal, unit-scale and orientation-preserving. Holding the inverse
 * alongside the forward map is not an optimisation — it is what keeps the round
 * trip exact, since for a rotation the inverse IS the transpose and computing
 * it that way avoids a general matrix inversion's error.
 */
export interface RigidTransform {
  readonly rotation: Mat3;
  readonly translation: Vec3;
  /** Transpose of `rotation`: the inverse rotation, exactly. */
  readonly inverseRotation: Mat3;
}

/** The identity, for packs with no body context bound. */
export const IDENTITY_TRANSFORM: RigidTransform = Object.freeze({
  rotation: Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]) as unknown as Mat3,
  translation: Object.freeze([0, 0, 0]) as unknown as Vec3,
  inverseRotation: Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]) as unknown as Mat3,
});

/**
 * Build a validated transform, or throw naming what is wrong with it.
 *
 * Throws rather than returning a result type because there is no sensible
 * fallback: a caller handed a sheared or mirrored registration cannot carry on
 * with "some" transform, and silently substituting the identity would place a
 * heart in the wrong body orientation while looking like it worked.
 */
export function rigidTransform(rotation: Mat3, translation: Vec3): RigidTransform {
  const problem = rigidProblem(rotation);
  if (problem) throw new Error(`model_to_body is not a rigid transform: ${problem}`);
  if (!translation.every((value) => Number.isFinite(value))) {
    throw new Error('model_to_body translation is not finite');
  }
  const m = rotation;
  return Object.freeze({
    rotation: Object.freeze([...m]) as unknown as Mat3,
    translation: Object.freeze([...translation]) as unknown as Vec3,
    inverseRotation: Object.freeze([
      m[0], m[3], m[6],
      m[1], m[4], m[7],
      m[2], m[5], m[8],
    ]) as unknown as Mat3,
  });
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** A position, model -> body. Rotated AND translated. */
export function pointToBody(t: RigidTransform, p: Vec3): Vec3 {
  const r = apply(t.rotation, p);
  return [r[0] + t.translation[0], r[1] + t.translation[1], r[2] + t.translation[2]];
}

/** A position, body -> model. */
export function pointToModel(t: RigidTransform, p: Vec3): Vec3 {
  const d: Vec3 = [
    p[0] - t.translation[0],
    p[1] - t.translation[1],
    p[2] - t.translation[2],
  ];
  return apply(t.inverseRotation, d);
}

/** A direction, model -> body. Rotated, NEVER translated. */
export function vectorToBody(t: RigidTransform, v: Vec3): Vec3 {
  return apply(t.rotation, v);
}

/** A direction, body -> model. */
export function vectorToModel(t: RigidTransform, v: Vec3): Vec3 {
  return apply(t.inverseRotation, v);
}

/**
 * A whole imaging frame, model -> body.
 *
 * The origin moves as a point and the three axes move as directions, which is
 * the distinction this function exists to make impossible to get wrong at the
 * dozen call sites that need it.
 *
 * The axes are re-orthonormalised afterwards. A rotation is orthonormal so in
 * exact arithmetic they would stay orthonormal on their own; in float they
 * accumulate a few ulps, and the wedge, the beam-dim shader and the echo-synced
 * cutter all assume an exactly orthonormal basis. Re-orthonormalising here is
 * the same defence `imagingFrame` already applies to authored poses, applied
 * again at the one other place a frame is transformed.
 *
 * Scalars — `halfAngleRad`, `depthMm`, `focusMm` — are carried through
 * unchanged, and that is only correct because the transform is unit-scale. A
 * scale would have to rewrite every one of them, which is one more reason
 * `rigidTransform` refuses one.
 */
export function frameToBody(t: RigidTransform, frame: ImagingFrame): ImagingFrame {
  const beam = normalize(vectorToBody(t, frame.beam));
  const lateralRaw = vectorToBody(t, frame.lateral);
  const lateral = normalize([
    lateralRaw[0] - dot(lateralRaw, beam) * beam[0],
    lateralRaw[1] - dot(lateralRaw, beam) * beam[1],
    lateralRaw[2] - dot(lateralRaw, beam) * beam[2],
  ]);
  return {
    ...frame,
    origin: pointToBody(t, frame.origin),
    beam,
    lateral,
    normal: normalize(cross(beam, lateral)),
  };
}

/** Whether a transform is the identity, for reporting rather than for logic. */
export function isIdentity(t: RigidTransform): boolean {
  return t.rotation.every((v, i) => v === IDENTITY_TRANSFORM.rotation[i])
    && t.translation.every((v) => v === 0);
}
