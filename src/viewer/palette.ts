/**
 * The structure palette, and the one place a structure's colour comes from.
 *
 * Its own module because the surface, its stencil cap and the beam dim all have
 * to agree about what colour a structure is — a cap in a different red from the
 * wall it belongs to reads as a second tissue — and because the colours are
 * measured against in `tests/unit/beamDim.test.ts`, which should not have to
 * import a React component to find out what the model looks like.
 */
/**
 * Distinct hues for the named structures; anything unnamed stays neutral grey.
 *
 * Each valve ring is hued toward the chamber it guards, so the pairing is
 * readable without labels: mitral toward the left-heart reds and golds, aortic
 * toward the aorta's violet, tricuspid and pulmonary toward the right-heart
 * greens and teals. They are lighter than the walls because a fibrous annulus
 * is the brightest thing in the neighbourhood on the echo side too.
 */
export const PALETTE: Record<string, number> = {
  'lv-myocardium': 0xd94f4f,
  'rv-myocardium': 0x4f8fd9,
  'la-myocardium': 0xe0a33c,
  'ra-myocardium': 0x5fb87a,
  'aortic-wall': 0xc45ec4,
  'pulmonary-artery-wall': 0x46b8b0,
  'mitral-valve-ring': 0xf2d98a,
  'tricuspid-valve-ring': 0x9fe0b4,
  'aortic-valve-ring': 0xe7a8e7,
  'pulmonary-valve-ring': 0x8fdcd6,
};

export const BLOOD_POOL_COLOUR = 0x8fbcd8;
export const UNNAMED_COLOUR = 0x8a8f96;

/* -------------------------------------------------------------------------- */
/* state two: a colour for a structure the palette has never heard of          */
/* -------------------------------------------------------------------------- */

/**
 * The band the derived colours live in, and why it is this narrow.
 *
 * The palette makes a CLAIM with colour: red is left heart, blue is right. A
 * generated colour must not be able to make that claim by accident, so the
 * derived band is chosen to be visibly a different KIND of colour rather than a
 * different value of the same one — chroma around 20 against the palette's 45
 * to 60, and lightness held in the middle. A desaturated slate-green and the
 * left ventricle's red are not two shades of the same statement.
 *
 * Within that band the only freedom left is hue and a little lightness, and
 * those are what separate one structure from its neighbours. Three lightness
 * steps and two chroma steps rather than hue alone: at this chroma, hue on its
 * own gives about ten distinguishable steps, and the largest sibling group here
 * is ten coronary branches, which would collide constantly.
 */
const DERIVED_CHROMA = [14, 20, 26] as const;
const DERIVED_LIGHTNESS = [48, 58, 68] as const;

/**
 * The two hue windows a derived colour may never land in.
 *
 * Desaturating is not enough on its own. A muted slate blue and the right
 * ventricle's blue are still the same family, and a learner reading "blue means
 * right heart" off the substrate will read a coronary branch the same way. So
 * the arcs around the palette's left-red and right-blue anchors are excluded
 * outright and the derived hues are mapped onto what is left. The cost is a
 * third of the hue circle; the thing bought is that a generated colour cannot
 * make a claim about sides at all, rather than making a faint one.
 *
 * Lab hue angles of `lv-myocardium` (0xd94f4f) and `rv-myocardium` (0x4f8fd9).
 */
const FORBIDDEN_HUES = [28.5, 273.1] as const;
const FORBIDDEN_HALF_WIDTH = 28;

/**
 * Hue fraction in [0, 1) -> a degree angle outside both forbidden windows.
 *
 * The two windows cut the circle into two arcs — the long one between red and
 * blue going through yellow and green, and the short one going the other way
 * through violet — and the fraction is laid across both end to end. Laying it
 * across the whole circle and then pushing forbidden values out would pile
 * colours up against the window edges, which is the opposite of what this is
 * for.
 */
function allowedHue(fraction: number): number {
  const [first, second] = FORBIDDEN_HUES;
  const arcs: [number, number][] = [
    [first + FORBIDDEN_HALF_WIDTH, second - FORBIDDEN_HALF_WIDTH],
    [second + FORBIDDEN_HALF_WIDTH, first - FORBIDDEN_HALF_WIDTH + 360],
  ];
  const spans = arcs.map(([from, to]) => to - from);
  const offset = fraction * (spans[0] + spans[1]);
  const [from, within] =
    offset < spans[0] ? [arcs[0][0], offset] : [arcs[1][0], offset - spans[0]];
  return (from + within) % 360;
}

/**
 * A salt on the hash, and the only thing in this module chosen by measurement.
 *
 * The derivation has to be a pure function of the structure id, so there is no
 * way to guarantee that two siblings do not land on the same colour — the
 * derivation cannot see that they are siblings. What can be done is to pick the
 * salt that maximises the WORST sibling separation over the packs this
 * repository actually contains, and to pin that measurement as a test. See
 * `tests/unit/palette.test.ts`.
 *
 * That makes this value data-dependent and honest about it: a new pack can push
 * the worst pair below the bar, and when it does, the failing test is the
 * signal to change the derivation rather than to raise the bar.
 *
 * As shipped, the closest sibling pair anywhere in this repository measures
 * **8.2 dE2000** — nine posterior ventricular branches of the right coronary
 * artery. A just-noticeable difference is about 2.3.
 */
const SALT = 4559;

/**
 * FNV-1a over the structure id.
 *
 * A hash rather than a counter because the colour must be a property of the
 * structure and of nothing else: the same structure has to come out the same
 * colour in every session, on every machine, whatever else the pack contains
 * and whatever order the loader happens to traverse it in. An index into a
 * ladder would move every colour the moment a pack gained a structure.
 *
 * The multiplier is FNV's own. `>>> 0` keeps it unsigned, so the arithmetic
 * cannot drift into the negative and produce a different hue on a different
 * engine.
 */
function hash32(id: string): number {
  let value = (0x811c9dc5 ^ SALT) >>> 0;
  for (let index = 0; index < id.length; index += 1) {
    value ^= id.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

/** CIE Lab (D65) -> packed sRGB, clamped into gamut. */
function labToHex(lightness: number, aStar: number, bStar: number): number {
  const fy = (lightness + 16) / 116;
  const fx = fy + aStar / 500;
  const fz = fy - bStar / 200;
  const invert = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = 0.95047 * invert(fx);
  const y = invert(fy);
  const z = 1.08883 * invert(fz);

  const linear = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
  const channels = linear.map((value) => {
    const gamma = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(gamma * 255)));
  });
  return (channels[0] << 16) | (channels[1] << 8) | channels[2];
}

/**
 * A stable muted colour for a structure the palette does not name.
 *
 * Generated in Lab rather than in HSL, because the constraint this has to meet
 * is perceptual: "cannot be mistaken for the palette's left-red or right-blue"
 * is a statement about chroma, and HSL saturation is not chroma — a fully
 * saturated yellow and a fully saturated blue are nowhere near as far apart in
 * the eye as the number suggests. Working in Lab also lets the separation
 * between two derived colours be MEASURED, in `tests/unit/palette.test.ts`,
 * rather than judged by eye.
 */
export function derivedColour(id: string): number {
  const value = hash32(id);
  // 12 bits of hue, so two ids have to agree closely to land near each other,
  // and the remaining bits pick the lightness and chroma step.
  const hue = allowedHue((value & 0xfff) / 0x1000);
  const lightness = DERIVED_LIGHTNESS[(value >>> 12) % DERIVED_LIGHTNESS.length];
  const chroma = DERIVED_CHROMA[(value >>> 16) % DERIVED_CHROMA.length];
  const radians = (hue * Math.PI) / 180;
  return labToHex(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians));
}

/**
 * One source of colour for the surface and for its cut face — they must agree.
 *
 * THREE states, not two (owner decision, 2026-08-19; `docs/observations.md`
 * entry 24 is the reasoning).
 *
 * 1. **Named, and in the palette** — the palette's colour. This is the selected
 *    substrate and the colours carry meaning: left heart red, right heart blue.
 * 2. **Identified, but not in the palette** — a derived muted colour, stable
 *    for that structure forever. All 86 BodyParts3D parts are here: every one
 *    of them IS identified, from the source's own concept map, and they simply
 *    do not share slugs with a palette keyed to the Rodero substrate. Rendering
 *    them all in the unnamed grey said something false about them.
 * 3. **Not identified at all** — the neutral grey, unchanged. Rodero's tags 11
 *    to 24 are here. This is an honesty signal and means one thing only: "we
 *    declined to identify this". It is the state that must not move, because
 *    everything it says depends on nothing else being able to say it.
 *
 * Blood pool comes first, ahead of all three, and keeps its own colour: a cast
 * of the lumen is not a fourth kind of naming, it is a different kind of thing.
 */
export function structureColour(id: string, isBloodPool: boolean, identified: boolean): number {
  if (isBloodPool) return BLOOD_POOL_COLOUR;
  const named = PALETTE[id];
  if (named !== undefined) return named;
  if (!identified) return UNNAMED_COLOUR;
  return derivedColour(id);
}
