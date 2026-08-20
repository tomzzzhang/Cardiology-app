/**
 * How far back the transducer has to sit for the fan to contain the heart.
 *
 * This is geometry with an exact answer, which is the reason it is a module
 * with tests rather than a number somebody tuned until `normal-rodero` stopped
 * clipping. The number a derivation produces can be wrong; a number typed into
 * a component cannot even be wrong, because there is nothing it is claiming.
 *
 * ## What "the fan contains the model" means here
 *
 * The imaging fan is PLANAR — `probeFrame.ts` sweeps `u` in [-1, 1] through a
 * half-angle of `fan.angle_deg / 2` about the beam, in the plane the beam and
 * lateral axes span — so a fan cannot literally contain a solid. The property
 * that is actually wanted is the one that survives the probe being rolled:
 * whatever roll about the beam the author settles on, the model's silhouette
 * must lie inside the sector. That is exactly containment of the bounding
 * SPHERE by the CONE OF REVOLUTION about the beam with the same half-angle, so
 * that is what is derived and what the tests assert.
 *
 * For a sphere of radius `R` whose centre lies on the axis at distance `d` from
 * the apex, the cone of half-angle `a` contains it when the perpendicular from
 * the centre to the cone's surface is at least `R`:
 *
 *     d * sin(a) >= R      i.e.      d >= R / sin(a)
 *
 * The tangency case is the equality, so the derivation is that quotient with a
 * margin on top. Nothing here is approximate and nothing is fitted.
 */

/**
 * How much further back than tangency the derived standoff sits.
 *
 * Tangency is a mathematical answer and a poor practical one: at exactly
 * `R / sin(a)` the model's silhouette touches both edges of the sector, so the
 * fan's outermost scanline grazes the heart and any nudge of the probe — which
 * is the entire point of anchor-then-adjust — pushes part of it out. Twelve per
 * cent buys a visible band of black around the widest cross-section without
 * shrinking the heart into the middle of the sector.
 *
 * It is a judgement call between two things the author needs at once and it is
 * logged in `docs/observations.md` rather than presented as derived.
 */
export const STANDOFF_MARGIN = 1.12;

/** The default sector width, for a pack with no authored view to copy one from. */
export const DEFAULT_FAN_ANGLE_DEG = 75;

/** Distance at which the cone of `fanAngleDeg` is exactly tangent to the sphere. */
export function tangentStandoffMm(radiusMm: number, fanAngleDeg: number): number {
  const half = (fanAngleDeg * Math.PI) / 360;
  const sin = Math.sin(half);
  if (!(radiusMm > 0) || !(sin > 0)) {
    throw new Error(
      `a standoff needs a positive radius and a positive fan angle; `
      + `got radius ${radiusMm}, angle ${fanAngleDeg}`,
    );
  }
  return radiusMm / sin;
}

/**
 * The derived standoff: tangency plus the margin.
 *
 * A wider fan needs less distance and a narrow one needs a lot — a 30-degree
 * sector has to sit nearly four radii back where a 120-degree sector sits at
 * little more than one. That spread is why this is derived per pack and per fan
 * rather than shared: the same constant cannot be right for a neonatal heart at
 * a 90-degree sector and an adult cast at 60.
 */
export function derivedStandoffMm(
  radiusMm: number, fanAngleDeg: number, margin = STANDOFF_MARGIN,
): number {
  return tangentStandoffMm(radiusMm, fanAngleDeg) * margin;
}

/**
 * Whether a sphere on the beam axis at `standoffMm` is inside the fan.
 *
 * Both conditions, because a sector is bounded two ways and only one of them is
 * about the angle: the cone has to be wide enough, AND `fan.depth_cm` has to
 * reach past the far side of the model. A pose that satisfies the first and
 * fails the second images the near half of a heart and stops.
 */
export function sphereInsideFan(input: {
  standoffMm: number; radiusMm: number; fanAngleDeg: number; depthMm: number;
}): boolean {
  const { standoffMm, radiusMm, fanAngleDeg, depthMm } = input;
  const half = (fanAngleDeg * Math.PI) / 360;
  const wideEnough = standoffMm * Math.sin(half) >= radiusMm;
  const deepEnough = depthMm >= standoffMm + radiusMm;
  return wideEnough && deepEnough;
}

/**
 * The depth the fan needs to reach the far side of the model, in centimetres.
 *
 * Centimetres because that is the unit `ProbePose.fan.depth_cm` is authored in,
 * and converting once here is cheaper than remembering which unit is in hand at
 * each of the three call sites.
 */
export function requiredDepthCm(standoffMm: number, radiusMm: number): number {
  return (standoffMm + radiusMm) / 10;
}

/**
 * How much depth a pack's authored fan is SHORT, or null when it reaches.
 *
 * The explicit authoring placement uses this as a MONOTONIC adjustment: it may
 * expand the local working pose by this amount, but never shrink the supplied
 * depth and never mutate the loaded pack. Keeping the measurement separate is
 * what lets the placement report say exactly what changed before a later save,
 * export and ingest make that draft value durable.
 */
export function depthShortfallCm(input: {
  standoffMm: number; radiusMm: number; authoredDepthCm: number;
}): number | null {
  const needed = requiredDepthCm(input.standoffMm, input.radiusMm);
  const short = needed - input.authoredDepthCm;
  return short > 0 ? short : null;
}

/**
 * A whole-centimetre depth that reaches, for a pack with no authored fan.
 *
 * This is NOT the deferred question above. There is no authored `depth_cm` on a
 * pack with no views, so there is nothing being overwritten; something has to
 * be chosen, and a number derived from the model is the only choice that is
 * right at two very different scales. Rounded up to a whole centimetre because
 * that is how a depth control on a real machine reads.
 */
export function defaultDepthCm(standoffMm: number, radiusMm: number): number {
  return Math.ceil(requiredDepthCm(standoffMm, radiusMm));
}
