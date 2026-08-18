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

/** One source of colour for the surface and for its cut face — they must agree. */
export function structureColour(id: string, isBloodPool: boolean): number {
  if (isBloodPool) return BLOOD_POOL_COLOUR;
  return PALETTE[id] ?? UNNAMED_COLOUR;
}
