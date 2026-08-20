/**
 * The model's axes, derived from one apical four-chamber pose.
 *
 * ## The idea, and why it is the right one
 *
 * An apical four-chamber is not just another view. The transducer sits at the
 * apex and the beam runs to the base, so the pose states three things at once:
 *
 * * **`beam_axis` IS the cardiac long axis**, with the sign the atria are on —
 *   the owner's "up is the atrium direction".
 * * **The fan plane IS the four-chamber plane**, so the in-plane axis is the
 *   septum-to-lateral-wall direction: left and right.
 * * **The plane normal is anterior-posterior**, because it is what is left.
 *
 * Place that one view on an unlabelled model and the model has a frame. Nothing
 * else in this repository can produce one from a gesture; the only other route
 * is the pipeline's landmark derivation, which needs labelled anatomy the
 * unlabelled packs do not have.
 *
 * ## Why it is needed more than it looks
 *
 * **Eight of the nine packs declare `orientation: up=+y, anterior=+z,
 * patient_left=+x`, and only `normal-rodero` carries an `anatomical_frame`
 * behind it.** The other eight carry the ingest's default triple: not measured,
 * just written into the field a measurement would go in. A frame derived from a
 * placed A4C is the first evidence any of them would have.
 *
 * ## What this does NOT do, and the reason is the whole point
 *
 * **It does not write `meshes.orientation` or `meshes.anatomical_frame`.** Those
 * are pack content with a recorded derivation, a checks list and a source; a
 * runtime that overwrote them would replace evidence with a gesture and the
 * pack would go on claiming the derivation it no longer had. The frame is
 * DERIVED here, reported here, and carried out in the export for an ingest to
 * write with its own provenance. Same rule as every other pose in this unit.
 *
 * ## The one thing geometry cannot decide
 *
 * `basal` is fixed by the beam. The other two are fixed only up to the sign of
 * the in-plane axis: rolling the probe 180 degrees produces the same PLANE with
 * left and right exchanged, and no amount of geometry can tell which one the
 * author meant — that is what a septum on one side of the image rather than the
 * other means, and it is read off the anatomy, not computed.
 *
 * So the sign is taken from the pose's OWN display convention (`display.flip_lr`)
 * and the assumption is stated on screen rather than buried. A left-handed
 * basis would silently mirror the anatomy, so `anterior` is CONSTRUCTED from
 * the other two rather than measured independently, which makes the triple
 * right-handed by definition and the schema's own handedness refinement a
 * tautology instead of a trap.
 */
import { cross, dot, imagingFrame, normalize } from '../echo/probeFrame.ts';
import type { ProbePose } from '../schema/packV0.ts';
import type { Vec3 } from '../schema/primitives.ts';

/**
 * The basis a pack's `meshes.anatomical_frame.basis_source_to_pack` carries,
 * in the same order and with the same handedness convention:
 * `patient_left x basal` points along `anterior`.
 */
export interface CardiacBasis {
  patient_left: Vec3;
  basal: Vec3;
  anterior: Vec3;
}

export interface DerivedFrame {
  basis: CardiacBasis;
  /**
   * Whether the in-plane axis was flipped to honour the pose's `display.flip_lr`.
   *
   * Reported because it is the one choice geometry did not make.
   */
  flippedForDisplay: boolean;
  /** `patient_left x basal · anterior`. Positive by construction; asserted anyway. */
  handedness: number;
}

/**
 * Derive the model's axes from an apical four-chamber pose.
 *
 * Goes through `imagingFrame`, like everything else that reads a pose, so the
 * basis is built from the same orthonormalised axes the wedge and the echo use
 * rather than from the raw authored numbers.
 */
export function frameFromFourChamber(pose: ProbePose): DerivedFrame {
  const frame = imagingFrame(pose);

  const basal = frame.beam;
  const flippedForDisplay = pose.display.flip_lr;
  const patientLeft: Vec3 = flippedForDisplay
    ? [-frame.lateral[0], -frame.lateral[1], -frame.lateral[2]]
    : frame.lateral;

  // Constructed, not measured: this is what makes the triple right-handed by
  // definition rather than by luck.
  const anterior = normalize(cross(patientLeft, basal));

  return {
    basis: { patient_left: patientLeft, basal, anterior },
    flippedForDisplay,
    handedness: dot(cross(patientLeft, basal), anterior),
  };
}

/**
 * How far the derived axes are from what the pack declares, in degrees.
 *
 * The interesting number when the pack's declaration is the ingest default —
 * which is eight packs out of nine. A large angle is not an error: it is the
 * measurement of how wrong the guess was, and it is the reason to run the
 * export through an ingest rather than leave the declaration standing.
 */
export function frameDisagreementDeg(
  derived: CardiacBasis, declared: CardiacBasis,
): { patient_left: number; basal: number; anterior: number } {
  return {
    patient_left: angleDeg(derived.patient_left, declared.patient_left),
    basal: angleDeg(derived.basal, declared.basal),
    anterior: angleDeg(derived.anterior, declared.anterior),
  };
}

function angleDeg(a: Vec3, b: Vec3): number {
  const unitA = normalize(a);
  const unitB = normalize(b);
  // Via the cross product rather than acos(dot), which loses precision at the
  // small angles this is most often asked about.
  return (Math.atan2(
    Math.hypot(...cross(unitA, unitB)),
    dot(unitA, unitB),
  ) * 180) / Math.PI;
}
