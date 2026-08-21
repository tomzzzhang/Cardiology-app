/**
 * `body-context/v0` — the patient/body frame, and a heart's place in it.
 *
 * ## Why this is a separate document rather than a pack field
 *
 * A pack describes ONE anatomical source: its meshes, its own coordinate
 * conventions, its views, its provenance. Where that source sits inside a body
 * is not a fact about the source — it is a fact about a *pairing* of a source
 * with a reference body, established by a registration that has its own method,
 * its own residuals and its own third-party licence.
 *
 * Pushing that into `meshes.orientation` or `meshes.anatomical_frame` would
 * damage both. Those fields are cardinal-axis declarations with a recorded
 * derivation from the pack's own geometry; `normal-rodero`'s says in as many
 * words that its axes are CARDIAC and that no body frame is claimed, because a
 * heart-only mesh cannot support one. Overwriting that with a body frame would
 * replace a measurement with a different measurement's answer and leave the
 * pack asserting a derivation it does not have.
 *
 * So the binding runs the other way. This document names the pack, pins its
 * exact bytes, and carries the transform. The pack does not know it exists.
 *
 * ## The frame, which is fixed and not negotiable per pack
 *
 * Right-handed, `+X` patient-left, `+Y` posterior, `+Z` superior; anterior is
 * `-Y`. `Level` means body `+Z` and nothing else. No view, no pack and no
 * import may redefine it — that is the whole point of it being here rather than
 * being derived from an imaging pose.
 *
 * ## What `model_to_body` is allowed to be
 *
 * Rigid, unit-scale, orientation-preserving: `scale` is exactly 1, the rotation
 * is orthonormal to `ROTATION_TOLERANCE`, and its determinant is `+1`.
 *
 * Every one of those is refused rather than repaired. A scale would silently
 * resize anatomy; a shear would deform it; a reflection would swap left and
 * right and still fit the landmarks, which for a heart means turning it into a
 * mirror-image organ that does not exist. `rigidProblem` names which of them
 * went wrong instead of reporting a generic parse failure, because "the matrix
 * is invalid" and "the matrix mirrors the patient" want different reactions.
 */
import { z } from 'zod';

import { Slug, Vec3 } from './primitives.ts';

/** Lowercase hex SHA-256, the form every integrity record in this repo uses. */
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'expected a lowercase SHA-256 digest');

/** How far from orthonormal a rotation may be before it is refused. */
export const ROTATION_TOLERANCE = 1e-6;

/** How far the determinant may sit from `+1`. */
export const DETERMINANT_TOLERANCE = 1e-6;

/**
 * The fixed patient/body basis. Exported so tests and viewer code assert
 * against one definition rather than three copies of three literals.
 */
export const BODY_PATIENT_LEFT: Vec3 = Object.freeze([1, 0, 0]) as unknown as Vec3;
export const BODY_POSTERIOR: Vec3 = Object.freeze([0, 1, 0]) as unknown as Vec3;
export const BODY_SUPERIOR: Vec3 = Object.freeze([0, 0, 1]) as unknown as Vec3;
export const BODY_ANTERIOR: Vec3 = Object.freeze([0, -1, 0]) as unknown as Vec3;

/** Row-major 3x3. */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * Why a matrix is not a rigid, unit-scale, non-reflecting rotation, or `null`.
 *
 * Checked in the order a reader would want to hear about it: unusable numbers
 * first, then the three distinct ways a well-formed matrix can still be the
 * wrong kind of transform.
 */
export function rigidProblem(m: Mat3): string | null {
  if (m.length !== 9 || m.some((value) => !Number.isFinite(value))) {
    return 'rotation must be nine finite numbers in row-major order';
  }

  // Column norms: a uniform scale shows up here as all three being equal and
  // not one, a non-uniform scale as them disagreeing.
  const columns = [0, 1, 2].map((c) => Math.hypot(m[c], m[c + 3], m[c + 6]));
  const offNorm = Math.max(...columns.map((n) => Math.abs(n - 1)));
  if (offNorm > ROTATION_TOLERANCE) {
    const uniform = Math.max(...columns) - Math.min(...columns) <= ROTATION_TOLERANCE;
    return uniform
      ? `rotation carries a uniform scale of ${columns[0].toFixed(9)}; model_to_body must be `
        + 'unit-scale, and a scale here would silently resize anatomy'
      : `rotation columns have lengths ${columns.map((n) => n.toFixed(9)).join(', ')}; a `
        + 'non-uniform scale would deform anatomy';
  }

  // Off-diagonal Gram terms: a shear preserves column lengths but not angles.
  const dot = (a: number, b: number) => m[a] * m[b] + m[a + 3] * m[b + 3] + m[a + 6] * m[b + 6];
  const skew = Math.max(Math.abs(dot(0, 1)), Math.abs(dot(1, 2)), Math.abs(dot(0, 2)));
  if (skew > ROTATION_TOLERANCE) {
    return `rotation columns are not orthogonal (worst |dot| = ${skew.toExponential(3)}); a `
      + 'shear would deform anatomy';
  }

  const determinant =
    m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(determinant + 1) <= DETERMINANT_TOLERANCE) {
    return 'rotation has determinant -1: it is a reflection. A mirrored heart fits the same '
      + 'landmarks and is a different organ, so this is refused rather than corrected';
  }
  if (Math.abs(determinant - 1) > DETERMINANT_TOLERANCE) {
    return `rotation has determinant ${determinant.toFixed(9)}, which is not +1`;
  }
  return null;
}

const Mat3Schema = z
  .tuple([
    z.number(), z.number(), z.number(),
    z.number(), z.number(), z.number(),
    z.number(), z.number(), z.number(),
  ])
  .superRefine((value, ctx) => {
    const problem = rigidProblem(value as unknown as Mat3);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

/**
 * The exact pack revision this registration is for.
 *
 * A model-space transform is meaningless against a different revision of the
 * mesh it was fitted to, so the binding pins bytes rather than a version
 * string alone. A pack that is re-ingested gets a new fit, not this one.
 */
export const PackBinding = z.strictObject({
  pack_id: Slug,
  pack_version: z.string().min(1),
  pack_schema_version: z.string().min(1),
  pack_json_sha256: Sha256,
});

export const BodyFrame = z.strictObject({
  patient_left: z.tuple([z.literal(1), z.literal(0), z.literal(0)]),
  posterior: z.tuple([z.literal(0), z.literal(1), z.literal(0)]),
  superior: z.tuple([z.literal(0), z.literal(0), z.literal(1)]),
  handedness: z.literal('right'),
  units: z.literal('mm'),
  note: z.string().min(1),
});

export const ModelToBody = z.strictObject({
  rotation_row_major: Mat3Schema,
  translation_mm: Vec3.refine((v) => v.every((n) => Number.isFinite(n)), {
    message: 'translation must be finite',
  }),
  /** Literal 1. Not "close to 1": there is no reason for a registration to scale. */
  scale: z.literal(1),
});

/** The display groups the chest is drawn and toggled in. */
export const ContextGroup = z.enum([
  'skin', 'ribs', 'sternum', 'spine', 'lungs', 'diaphragm', 'shoulder',
]);
export type ContextGroup = z.infer<typeof ContextGroup>;

/**
 * One context geometry FILE, and the display groups inside it.
 *
 * A file rather than a group, because the groups share one glTF: they are one
 * download and one set of buffers, and each is a node in it. Describing them as
 * separate assets would mean repeating one digest and one byte count per group,
 * which reads as seven files that do not exist.
 *
 * Both the glTF and its `.bin` are digested. The `.bin` is where every vertex
 * actually lives, so a record that pinned only the JSON would pin the part that
 * matters least.
 */
export const ContextAsset = z.strictObject({
  gltf: z.string().min(1),
  bin: z.string().min(1),
  sha256: Sha256,
  bin_sha256: Sha256,
  bytes: z.number().int().nonnegative(),
  groups: z.array(z.strictObject({
    group: ContextGroup,
    triangles: z.number().int().nonnegative(),
    source_elements: z.array(z.string().min(1)).min(1),
  })).min(1),
});

export const Registration = z.looseObject({
  method: z.string().min(1),
  scheme: z.string().min(1),
  rms_residual_mm: z.number().nonnegative(),
  max_residual_mm: z.number().nonnegative(),
  per_landmark_residual_mm: z.record(z.string(), z.number().nonnegative()),
});

export const BodyContextV0 = z.strictObject({
  schema_version: z.literal('body-context/v0'),
  context_id: Slug,
  display_name: z.string().min(1),
  pack_binding: PackBinding,
  body_frame: BodyFrame,
  model_to_body: ModelToBody,
  registration: Registration,
  context_assets: z.array(ContextAsset),
  provenance: z.looseObject({
    creator: z.string().min(1),
    source: z.string().min(1),
    license: z.string().min(1),
    license_state: z.literal('confirmed'),
    attribution: z.string().min(1),
    license_history_caveat: z.string().min(1),
    not_a_patient: z.string().min(1),
  }),
});

export type BodyContextV0 = z.infer<typeof BodyContextV0>;

/** Parse, returning either the document or a readable problem. */
export function readBodyContext(
  value: unknown,
): { ok: true; context: BodyContextV0 } | { ok: false; problem: string } {
  const parsed = BodyContextV0.safeParse(value);
  if (parsed.success) return { ok: true, context: parsed.data };
  const first = parsed.error.issues[0];
  return {
    ok: false,
    problem: `${first.path.join('.') || '<root>'} — ${first.message}`,
  };
}
