/**
 * Which packs reach the deployed site.
 *
 * This is the ONE list. The production build filter, the loader's guard, and the
 * CI check all read it, so a pack cannot be published by one route while being
 * rejected by another.
 *
 * The repository deliberately contains packs that are NOT published. They are
 * evidence: the wave 1a substrate survey compared three candidate Normal-heart
 * assets through one pipeline, and the two that lost are kept so the comparison
 * remains reproducible and auditable. Keeping them and shipping them are
 * different things.
 *
 * Removal from the deployed site is enforced at BUILD time — the rejected packs
 * are absent from `dist/`, not merely hidden by a runtime flag — so no deep
 * link, guessed URL, or bug in the shell can reach them. The runtime guard below
 * is a second line that fails loudly and early; it is not the mechanism.
 */

/** Packs copied into `dist/` and reachable on the deployed site. */
export const PUBLISHED_PACK_IDS = ['stub', 'normal-rodero'] as const;

export type PublishedPackId = (typeof PUBLISHED_PACK_IDS)[number];

/** The pack the shell shows when nothing else is asked for. */
export const DEFAULT_PACK_ID: PublishedPackId = 'normal-rodero';

/**
 * Why a pack in this repository is not published.
 *
 * Two independent kinds of reason, and both are recorded because they fail
 * differently: a SUBSTRATE verdict can be revisited by re-reading the geometry,
 * whereas a LICENCE block cannot be resolved by anything in this repository at
 * all.
 */
export interface Rejection {
  /** Why the geometry lost the wave 1a comparison. */
  substrate: string;
  /** Why it may not be published regardless of the substrate verdict. */
  licence: string;
}

export const REJECTED_PACKS: Readonly<Record<string, Rejection>> = {
  'normal-alberta-neonatal': {
    substrate:
      'Rejected as substrate (2026-08-19). The blood pool and the myocardium interpenetrate ' +
      'rather than nesting: they are not a cast-and-shell pair, so wall thickness cannot be ' +
      'derived by pairing them. Their extents differ sharply (84.5 mm against 43.5 mm on the ' +
      'superior axis, the blood pool running up the great vessels where no myocardium exists), ' +
      'only about a third of the blood-pool surface lies inside the myocardium, and the ' +
      'pairwise distance spreads from 0.05 mm to 33.9 mm. Renders as a blobby echo.',
    licence:
      'Publication BLOCKED pending written confirmation. 3dheartproject.com states a site-wide ' +
      'CC BY-NC grant, while the per-model Sketchfab grant and the licence file inside the ' +
      'download both read CC BY 4.0. The conflict is unresolved, so the pack does not ship ' +
      'whatever its substrate verdict.',
  },
  'normal-vhl-heart0102': {
    substrate:
      'Rejected as substrate (2026-08-19). A single undivided tissue body: one material, one ' +
      'echo label, no per-chamber structures, so nothing can be shown or hidden per chamber and ' +
      'a sweep has no ordered structure list to read out. Interior endocardial surfaces are ' +
      'genuinely present, but the mesh carries 1,026 connected components — trabecular islands ' +
      'and segmentation debris — which render as voids through the tissue.',
    licence:
      'CC BY-NC 4.0. Not published: a non-commercial pack binds the whole application to the ' +
      'non-commercial red lines, and that constraint is not accepted for the published build.',
  },
};

/** Both rejected packs render in orientations that could not be verified. */
export const UNVERIFIED_ORIENTATION_NOTE =
  'Both rejected packs also render in UNVERIFIED orientations. Neither source carries chamber ' +
  'labels, so superior and patient-left cannot be derived from the geometry the way they are for ' +
  'the Rodero pack; each declares the glTF default and says so in its own provenance. Verifying ' +
  'them is deliberately not done, because they are not shipping.';

export function isPublishedPack(packId: string): boolean {
  return (PUBLISHED_PACK_IDS as readonly string[]).includes(packId);
}

export function rejectionFor(packId: string): Rejection | undefined {
  return REJECTED_PACKS[packId];
}
