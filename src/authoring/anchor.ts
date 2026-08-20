/**
 * Anchor the probe to the view axis: one press, an ordinary `ProbePose`.
 *
 * ## Why this gesture and not a drag
 *
 * `probeControl.ts` already argues that positioning a transducer is not a drag,
 * and this does not reopen it. What it adds is the gesture for GROSS placement,
 * which the pad is a poor instrument for: getting from an arbitrary starting
 * orientation to roughly the right window is forty presses of a two-degree
 * button, and the author already has a control that expresses "look at it from
 * here" perfectly — the camera. So the author orbits to the angle they want,
 * presses once, and the probe is on that axis looking at the model. The pad
 * then does what it is good at.
 *
 * ## What comes out is an ordinary pose
 *
 * Nothing downstream can tell this pose came from a camera. In particular the
 * `lateral_axis` is the camera's own right vector made EXACTLY orthogonal to
 * the beam by `imagingFrame` — the same Gram-Schmidt the renderer applies to
 * authored axes — rather than by a private orthogonalisation here. Going
 * through `probeFrame.ts` is the point: the pose this emits is one
 * `imagingFrame` accepts unchanged, so the wedge on the model and the echo fan
 * derive from it exactly as they do from a saved pose, and the schema's unit
 * and orthogonality refinements pass with a great deal of room to spare.
 *
 * ## Units
 *
 * Model coordinates are treated as MILLIMETRES, because that is what
 * `imagingFrame` does with them: it converts `fan.depth_cm` to millimetres and
 * compares it against model-space distances directly. The derivation has to
 * share the renderer's assumption or the fan it computes and the fan that gets
 * drawn are two different fans. A pack declaring `units: "cm"` is therefore
 * already mis-scaled against the echo renderer today; that is a pre-existing
 * question for the schema v1 revision and is not silently patched here.
 */
import { imagingFrame } from '../echo/probeFrame.ts';
import type { ProbePose } from '../schema/packV0.ts';
import type { Vec3 } from '../schema/primitives.ts';
import {
  DEFAULT_FAN_ANGLE_DEG, defaultDepthCm, depthShortfallCm, derivedStandoffMm,
  requiredDepthCm, sphereInsideFan,
} from './standoff.ts';

/**
 * What the viewer hands the anchor: the camera, and the model, in MODEL space.
 *
 * Model space rather than world space, because a `ProbePose` is authored in
 * model space and `meshes.canonical_pose` sits between the two. Every shipped
 * pack poses by identity today, which is exactly why getting this wrong would
 * go unnoticed until the first posed pack — so the conversion happens at the
 * viewer boundary, where the matrix is, and this module never sees a world
 * coordinate.
 */
export interface ViewAnchor {
  /** Camera forward, unit. The direction the author is looking. */
  forward: Vec3;
  /** Camera right, unit. Becomes `lateral_axis` after orthogonalisation. */
  right: Vec3;
  /** Centre of the model's bounding sphere. */
  centre: Vec3;
  /** Radius of the model's bounding sphere. */
  radius: number;
}

/**
 * The fan and display settings the anchored pose carries.
 *
 * Copied from an authored view when the pack has one. `Place from camera` keeps
 * the sector width, focus and display conventions, and never SHRINKS depth. It
 * may expand depth in the resulting working pose to the measured minimum needed
 * to reach the model's far side. The template is never mutated; saving and
 * exporting remain the separate path by which that draft value can leave the
 * working pose.
 */
export type AnchorTemplate = Pick<ProbePose, 'fan' | 'display'>;

/**
 * The template for a pack with no authored view at all.
 *
 * Five of the nine packs on the shelf are in this state, and they are the ones
 * this whole unit exists for. Something has to be chosen; `angle_deg` is a
 * middle-of-the-road sector and the depth follows the model, so the first
 * anchored pose on an unlabelled pack is usable rather than arbitrary.
 */
export function defaultTemplate(radiusMm: number, fanAngleDeg = DEFAULT_FAN_ANGLE_DEG): AnchorTemplate {
  const standoff = derivedStandoffMm(radiusMm, fanAngleDeg);
  const depth = defaultDepthCm(standoff, radiusMm);
  return {
    fan: {
      angle_deg: fanAngleDeg,
      depth_cm: depth,
      /*
       * Focus at the middle of the model rather than at the middle of the
       * depth: the depth reaches past the far side by construction, so half of
       * it lands behind the heart.
       */
      focus_cm: Math.min(depth, Math.max(0.1, requiredDepthCm(standoff, 0))),
    },
    display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
  };
}

/**
 * What the anchor did, and what it could not do without changing content.
 *
 * Returned alongside the pose rather than logged, because the one thing this
 * has to be able to say out loud is "the fan you authored is too short for
 * where the probe now has to sit" — and a clamp would have hidden exactly that.
 */
export interface AnchorReport {
  /** The standoff actually used, in model units (mm). */
  standoffMm: number;
  /** What the bounding sphere and fan angle imply, before any override. */
  derivedMm: number;
  /** The pack's `interaction.authoring_standoff_mm`, when it supplied one. */
  overrideMm: number | null;
  /** Depth needed to reach the far side of the model, in cm. */
  requiredDepthCm: number;
  /** Depth supplied by the selected view/template, before placement. */
  sourceDepthCm: number;
  /** Depth carried by the resulting local working pose. Never less than source. */
  appliedDepthCm: number;
  /** How much placement expanded depth, or null when the source already reached. */
  depthShortCm: number | null;
  /** Whether the bounding sphere is inside the resulting fan, angle AND depth. */
  contains: boolean;
}

export interface AnchorResult {
  pose: ProbePose;
  report: AnchorReport;
}

/**
 * Place the probe on the camera's axis, aimed at the model.
 *
 * The origin is `centre - forward * standoff`, so the beam through the origin
 * passes exactly through the bounding sphere's centre. That is a deliberate
 * choice over "wherever the camera's ray happens to go": the camera looks at
 * the interaction pivot `C`, which is not in general the bounding sphere's
 * centre, and a fan aimed at `C` needs a longer standoff to contain a sphere
 * centred elsewhere — spending the difference on empty margin, which is the
 * same mistake `framingRadius` records having made once already. The DIRECTION
 * is the author's; the AIM POINT is the model.
 */
export function anchoredPose(
  anchor: ViewAnchor, template: AnchorTemplate, overrideMm: number | null = null,
): AnchorResult {
  const derived = derivedStandoffMm(anchor.radius, template.fan.angle_deg);
  const standoff = overrideMm !== null && Number.isFinite(overrideMm) && overrideMm > 0
    ? overrideMm
    : derived;
  const neededDepthCm = requiredDepthCm(standoff, anchor.radius);
  const sourceDepthCm = template.fan.depth_cm;
  const depthShortCm = depthShortfallCm({
    standoffMm: standoff,
    radiusMm: anchor.radius,
    authoredDepthCm: sourceDepthCm,
  });
  const appliedDepthCm = Math.max(sourceDepthCm, neededDepthCm);

  const forward = unit(anchor.forward);
  const origin: Vec3 = [
    anchor.centre[0] - forward[0] * standoff,
    anchor.centre[1] - forward[1] * standoff,
    anchor.centre[2] - forward[2] * standoff,
  ];

  /*
   * The orthogonalisation goes THROUGH `imagingFrame`, not around it. A private
   * Gram-Schmidt here would be a second implementation of the one thing the
   * renderer and the wedge already agree on, and two implementations of an
   * orthogonalisation is how a fan ends up nearly-planar.
   */
  const provisional: ProbePose = {
    origin,
    beam_axis: forward,
    lateral_axis: anchor.right,
    // Fresh objects are essential here: a standard slot is a deep-frozen clone
    // of pack content, and placement must never write through it.
    fan: { ...template.fan, depth_cm: appliedDepthCm },
    display: { ...template.display },
  };
  const frame = imagingFrame(provisional);

  const pose: ProbePose = {
    ...provisional,
    beam_axis: frame.beam,
    lateral_axis: frame.lateral,
  };

  return {
    pose,
    report: {
      standoffMm: standoff,
      derivedMm: derived,
      overrideMm: overrideMm !== null && Number.isFinite(overrideMm) && overrideMm > 0
        ? overrideMm
        : null,
      requiredDepthCm: neededDepthCm,
      sourceDepthCm,
      appliedDepthCm,
      depthShortCm,
      contains: sphereInsideFan({
        standoffMm: standoff,
        radiusMm: anchor.radius,
        fanAngleDeg: template.fan.angle_deg,
        depthMm: appliedDepthCm * 10,
      }),
    },
  };
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 0)) throw new Error('the view axis is degenerate: the camera has no direction');
  return [v[0] / length, v[1] / length, v[2] / length];
}
