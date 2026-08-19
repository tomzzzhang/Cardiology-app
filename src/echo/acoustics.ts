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
  /** Display gamma applied after the dB window. <1 lifts mid-greys, >1 deepens them. */
  gamma: number;
  /** Attenuation of a label with coefficient 1.0, in dB/cm. Round trip is twice this. */
  attenuationDbPerCm: number;
  /** Scatterer density, in scatterers per mm along a scanline. */
  scattererDensity: number;
  /**
   * Diffuse backscatter amplitude, as a fraction of a label's echogenicity.
   *
   * The ratio between the tissue interior and a specular interface. Diffuse
   * backscatter from sub-resolution scatterers is far weaker than a specular
   * reflection off a boundary, and this is where that difference lives.
   */
  scatter: number;
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
  /*
   * TGC compensates the attenuation the beam actually suffers. Setting it far
   * above that does not "brighten the image" — it lifts the near-anechoic
   * regions, because they are the ones with nothing attenuating them. At 42 dB
   * over a 16 cm sector the blood outside the heart came back mid-grey, which
   * inverts priority 1's ordering: blood must be near-black.
   */
  tgcDb: 8,
  /*
   * Wide enough to hold the whole scale the model produces at once: a specular
   * interface near full scale, diffuse myocardium about 25 dB under it, blood
   * about 29 dB under that. At 55 dB the two ends did not fit — tissue clipped
   * to white and blood fell through the rejection floor to black, so the sector
   * came out as a two-tone mask with no mid-grey anywhere in it, which is the
   * "reads as a segmentation, not an echo" failure.
   */
  dynamicRangeDb: 60,
  gamma: 1.25,
  attenuationDbPerCm: 4.0,
  /*
   * Scatterer cells must be comfortably FINER than the PSF, or the speckle
   * degenerates into visible dots: the convolution has nothing to average and
   * each cell survives as its own blob. Density here puts roughly three cells
   * inside one PSF width.
   */
  scattererDensity: 3.6,
  /*
   * Diffuse tissue sits ~20 dB below a PERFECT reflector, in the PRE-COMPRESSION
   * ENVELOPE. Both qualifications matter, and their absence made this comment
   * read as contradicting a measurement it does not contradict.
   *
   * * **Pre-compression.** This is a ratio of envelope amplitudes, before the
   *   60 dB log window and gamma 1.25 in `displayPass.ts`. Displayed grey is a
   *   compressed function of it: 20 dB of envelope is about 0.25 of the grey
   *   scale here, not a factor of ten of brightness.
   * * **Perfect reflector.** It is a statement about the model, not about this
   *   pack. No interface in this substrate is a perfect reflector; the
   *   strongest is blood against myocardium, an echogenicity step of about
   *   0.53, and `boundaryReflection` below puts it ~14 dB above the tissue
   *   interior rather than 20.
   *
   * Neither figure is the 1.21 that `npm run measure:echo` reports for rim
   * versus core, and that is not a disagreement either: 1.21 is a ratio of
   * DISPLAYED GREY averaged over the outer 1.5 mm of a wall chord against its
   * middle. Worked back through the window and gamma it is 6.3 dB of envelope
   * separation over that window — lower than the 14 dB peak because the axial
   * PSF is 0.7 mm and a 1.5 mm window mixes interface energy into the core and
   * interior energy into the rim. Three quantities, three numbers, and the
   * table in `docs/observations.md` now says which is which.
   *
   * With the pack's echogenicity 0.55 for myocardium this puts the myocardial
   * envelope near -25 dB, roughly the middle of the window, and blood at 0.02
   * near -54 dB — dark but still textured rather than a hole.
   */
  scatter: 0.1,
  psfAxialMm: 0.7,
  psfLateralMm: 0.95,
  psfDefocus: 0.014,
  specular: 1.0,
  /*
   * A strong interface — blood against myocardium, an echogenicity step of
   * about 0.53 — now returns ~0.29 at normal incidence, some 14 dB above the
   * tissue interior rather than swamping it, PRE-COMPRESSION and measured at
   * the interface itself rather than over a window. The border reads as a
   * border and the wall behind it still reads as a wall.
   *
   * This value is NOT pinned to the renderer's internal sampling, which was an
   * open worry: the PSF's coherent pass normalises by `sqrt(sum(w^2))`, which
   * is resolution-invariant for independent scatterers but not for a return
   * correlated across the kernel, so a specular term could have gained ~3 dB
   * per doubling of lateral resolution. Measured, it does not: rim versus core
   * is flat to 0.06 dB over a four-fold span of polar resolution, because the
   * boundary return is generated per sample at a label transition and so is
   * closer to an impulse than to a correlated block.
   * `tests/visual/echo-resolution.spec.ts` holds that.
   */
  boundaryReflection: 0.55,
  clutter: 0.012,
  /*
   * Rejection has to sit BELOW blood, or it deletes the darkest real signal in
   * the image instead of the noise floor. At 0.02 it was above blood's ~0.002
   * envelope, so every chamber rendered as pure black and the sector lost the
   * low end of its scale entirely.
   */
  reject: 0.0008,
};

/**
 * Merge a view's `echo_tuning` bag over the defaults.
 *
 * Unknown keys are IGNORED rather than rejected. The bag is open by design in
 * the schema, and a pack authored against a later renderer must not fail to
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
 * ONE logarithmic mapping, not two. An earlier revision applied a log-compression
 * knee and *then* a dynamic-range window, which double-compressed: every return
 * above roughly a hundredth of full scale landed within a few dB of white, and
 * the rendered sector came out bimodal — saturated inside, black outside — with
 * almost no mid-grey. That is the "looks like CT" failure the contract's Stage 0
 * benchmark is meant to catch, and it was a modelling error rather than a tuning
 * one.
 *
 * A scanner maps the envelope logarithmically onto the displayed dynamic range:
 * full scale is white, `dynamicRangeDb` below full scale is black, and
 * everything between is linear IN DECIBELS. `gamma` then shapes the mid-greys.
 * That is what this is.
 */
export function compress(envelope: number, tuning: EchoTuning): number {
  const gained = Math.max(0, envelope) * tuning.gain;
  if (gained <= tuning.reject) return 0;

  const db = 20 * Math.log10(gained);
  const normalized = 1 + db / tuning.dynamicRangeDb;
  return Math.pow(Math.min(1, Math.max(0, normalized)), tuning.gamma);
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
  /*
   * An EXPLORE-ONLY pack reaching the echo renderer is a shell bug, not a
   * content problem, so it throws rather than degrading into an empty image.
   * The shell's job is to refuse Echo mode for these packs and SAY SO; a blank
   * canvas would look like a broken renderer instead of a pack with no echo.
   */
  if (pack.echo_volume === undefined) {
    throw new Error(
      `pack "${pack.meta.id}" is EXPLORE-ONLY: it carries no echo_volume, so there is `
        + 'nothing to render. Echo mode must be refused for it before reaching here.',
    );
  }
  return describeVolume(pack.echo_volume);
}
