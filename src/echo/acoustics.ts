/**
 * Acoustic authoring values, and the post-processing chain applied to the
 * envelope before it becomes a grey level.
 *
 * Perceptual priority 1 (`contracts/echo-renderer.md`) is *correct grey-level
 * ORDERING*, so everything here is relative and unitless. The pack supplies
 * `echogenicity` and `attenuation` per label; this module turns those into the
 * lookup the shader samples, and defines the TGC / log-compression / dynamic-
 * range curve that maps returned envelope to displayed brightness.
 *
 * Kept free of WebGL on purpose: this is the part with a right answer, so it is
 * the part that gets unit tests.
 */
import type { EchoLabel, EchoVolume, Pack } from '../schema/packV0.ts';

/** Voxel value 0 is background — see `public/packs/README.md`. */
export const BACKGROUND_LABEL = 0;

/** Width of the label lookup texture: one texel per possible `raw-u8` value. */
export const LABEL_LUT_SIZE = 256;

/**
 * Acoustic properties of blood, used for label 0 and for any voxel whose label
 * the pack does not describe.
 *
 * Background is not "nothing": the space inside a chamber is blood, and blood is
 * near-black but not black — it carries low-level scatter, and priority 1 puts
 * "blood near-black" at the bottom of the ordering rather than outside it.
 */
export const BLOOD: Readonly<{ echogenicity: number; attenuation: number }> = {
  echogenicity: 0.02,
  attenuation: 0.02,
};

/**
 * Pack labels -> an RGBA8 lookup, indexed by voxel value.
 *
 *   R = echogenicity   (0..1)
 *   G = attenuation    (0..1, clamped — see below)
 *   B = 255 where the label is described by the pack, 0 where it is background
 *       or undeclared. The shader uses this to find tissue/blood interfaces
 *       without a second lookup.
 *   A = unused, reserved.
 *
 * `attenuation` is unbounded in the schema (`z.number().min(0)`) but a texture
 * channel is not, so values are divided by `attenuationScale` and clamped. The
 * scale travels with the LUT so the shader can undo it exactly.
 */
export interface LabelLut {
  data: Uint8Array;
  attenuationScale: number;
  /** Label ids actually described, for diagnostics and tests. */
  described: number[];
}

export function buildLabelLut(labels: readonly EchoLabel[]): LabelLut {
  const attenuationScale = Math.max(
    1,
    ...labels.map((label) => label.attenuation),
  );

  const data = new Uint8Array(LABEL_LUT_SIZE * 4);
  // Undescribed values, including background, read as blood.
  for (let index = 0; index < LABEL_LUT_SIZE; index += 1) {
    data[index * 4 + 0] = Math.round(BLOOD.echogenicity * 255);
    data[index * 4 + 1] = Math.round((BLOOD.attenuation / attenuationScale) * 255);
    data[index * 4 + 2] = 0;
    data[index * 4 + 3] = 255;
  }

  const described: number[] = [];
  for (const label of labels) {
    const at = label.id * 4;
    data[at + 0] = Math.round(Math.min(1, label.echogenicity) * 255);
    data[at + 1] = Math.round(Math.min(1, label.attenuation / attenuationScale) * 255);
    data[at + 2] = 255;
    data[at + 3] = 255;
    described.push(label.id);
  }

  return { data, attenuationScale, described: described.sort((a, b) => a - b) };
}

/* -------------------------------------------------------------------------- */
/* post-processing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Knobs the renderer exposes. Defaults are the pediatric probe feel the spec
 * asks for — 5-12 MHz, shallow depth, focus around 4-5 cm.
 *
 * A view may override any of these through `views[i].echo_tuning`, which schema
 * v0 deliberately leaves as an open bag of scalars because the knob names are
 * fixed by this slice. These are those names.
 */
export interface EchoTuning {
  /** Overall gain applied before compression. */
  gain: number;
  /** Time-gain compensation: extra dB applied linearly with depth. */
  tgcDb: number;
  /** Displayed dynamic range in dB. Narrower is higher contrast. */
  dynamicRangeDb: number;
  /** Log-compression knee. Higher lifts low-level speckle into view. */
  compression: number;
  /** Scatterer density, in scatterers per mm along a scanline. */
  scattererDensity: number;
  /** Axial PSF sigma in mm at the focus. */
  psfAxialMm: number;
  /** Lateral PSF sigma in mm at the focus. */
  psfLateralMm: number;
  /** How much the lateral PSF widens away from the focus, per mm. */
  psfDefocus: number;
  /** Strength of the specular boundary term. */
  specular: number;
  /** Strength of the added boundary reflection. */
  boundaryReflection: number;
  /** Near-field clutter amplitude. */
  clutter: number;
  /** Rejection floor: envelope below this reads as black. */
  reject: number;
}

export const DEFAULT_TUNING: Readonly<EchoTuning> = {
  gain: 1.0,
  tgcDb: 26,
  dynamicRangeDb: 55,
  compression: 180,
  scattererDensity: 2.2,
  psfAxialMm: 0.42,
  psfLateralMm: 0.9,
  psfDefocus: 0.014,
  specular: 1.0,
  boundaryReflection: 0.55,
  clutter: 0.05,
  reject: 0.02,
};

/**
 * Merge a view's `echo_tuning` bag over the defaults.
 *
 * Unknown keys are IGNORED rather than rejected. The bag is open by design in
 * schema v0, and a pack authored against a later renderer must not fail to
 * display on an earlier one — it should display with the knobs that renderer
 * has. Non-numeric values for numeric knobs are dropped for the same reason.
 */
export function resolveTuning(bag: Record<string, number | boolean | string> | undefined): EchoTuning {
  const resolved: EchoTuning = { ...DEFAULT_TUNING };
  if (!bag) return resolved;
  for (const key of Object.keys(DEFAULT_TUNING) as (keyof EchoTuning)[]) {
    const value = bag[key];
    if (typeof value === 'number' && Number.isFinite(value)) resolved[key] = value;
  }
  return resolved;
}

/** Time-gain compensation factor at depth `rMm` of a `depthMm` sector. */
export function tgcGain(rMm: number, depthMm: number, tgcDb: number): number {
  const fraction = depthMm <= 0 ? 0 : Math.min(1, Math.max(0, rMm / depthMm));
  return Math.pow(10, (tgcDb * fraction) / 20);
}

/**
 * Envelope -> displayed brightness in [0, 1].
 *
 * Log compression first, then the dynamic-range window. Real scanners do it in
 * this order and it matters: compressing after windowing would clip the speckle
 * that priority 1 depends on before it could be seen.
 */
export function compress(envelope: number, tuning: EchoTuning): number {
  const gained = Math.max(0, envelope) * tuning.gain;
  if (gained <= tuning.reject) return 0;

  const compressed = Math.log(1 + tuning.compression * gained) / Math.log(1 + tuning.compression);
  // Map [-dynamicRange, 0] dB onto [0, 1].
  const db = 20 * Math.log10(Math.max(compressed, 1e-6));
  const normalized = 1 + db / tuning.dynamicRangeDb;
  return Math.min(1, Math.max(0, normalized));
}

/**
 * The grey-level ordering priority 1 requires, as a sortable score.
 *
 * Exported so a test can assert the ordering holds for a real pack rather than
 * trusting that the authored numbers happen to be right.
 */
export function greyOrdering(labels: readonly EchoLabel[]): { structure: string; echogenicity: number }[] {
  return [...labels]
    .sort((a, b) => b.echogenicity - a.echogenicity)
    .map((label) => ({ structure: label.structure, echogenicity: label.echogenicity }));
}

/** Everything the renderer needs from a pack's `echo_volume`, resolved once. */
export interface VolumeDescriptor {
  resolution: [number, number, number];
  /** Model space -> voxel space, 4x4 column-major, straight from the pack. */
  meshToVolume: number[];
  lut: LabelLut;
  scattererSeed: number;
}

export function describeVolume(echoVolume: EchoVolume): VolumeDescriptor {
  return {
    resolution: echoVolume.resolution,
    meshToVolume: echoVolume.mesh_to_volume,
    lut: buildLabelLut(echoVolume.labels),
    scattererSeed: echoVolume.scatterer_seed,
  };
}

export function describePack(pack: Pack): VolumeDescriptor {
  return describeVolume(pack.echo_volume);
}
