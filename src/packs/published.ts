/**
 * Which packs reach the deployed site.
 *
 * This is the ONE list. The production build filter, the loader's guard, and the
 * CI check all read it, so a pack cannot be published by one route while being
 * rejected by another.
 *
 * The repository contains packs that are NOT deployed to Pages, for two
 * unrelated reasons. This file controls the deployed site only. Git history is
 * itself public distribution, so inclusion here never authorises committing an
 * asset whose redistribution or modification rights are unresolved.
 *
 * Some are EVIDENCE: the wave 1a substrate survey compared three candidate
 * Normal-heart assets through one pipeline, and the two that lost are kept so
 * the comparison remains reproducible and auditable.
 *
 * The rest are the SHELF: real models brought in to be looked at, judged by eye
 * rather than by a metric. None of them ships. Every one carries a licence state
 * (schema v0.1) and anything but `confirmed` is unpublishable by rule, checked
 * in `scripts/check-provenance.ts` and again in the unit tests. A shelf pack may
 * also be withdrawn from the normal development picker without deleting the
 * pack or its evidence.
 *
 * Tracking a rights-cleared pack and deploying it are different decisions.
 *
 * Removal from the deployed site is enforced at BUILD time — the rejected packs
 * are absent from `dist/`, not merely hidden by a runtime flag — so no deep
 * link, guessed URL, or bug in the shell can reach them. The runtime guard below
 * is a second line that fails loudly and early; it is not the mechanism.
 */

import type { LicenseState } from '../schema/packV0.ts';

/** Packs copied into `dist/` and reachable on the deployed site. */
export const PUBLISHED_PACK_IDS = ['stub', 'normal-rodero'] as const;

export type PublishedPackId = (typeof PUBLISHED_PACK_IDS)[number];

/** The pack the shell shows when nothing else is asked for. */
export const DEFAULT_PACK_ID: PublishedPackId = 'normal-rodero';

/**
 * Why a pack in this repository is not published.
 *
 * Two independent kinds of reason, recorded separately because they fail
 * differently: a SUBSTRATE verdict can be revisited by re-reading the geometry,
 * whereas a LICENCE block cannot be resolved by anything in this repository at
 * all. `licence` is required because every unpublished pack has a publication
 * reason even when its geometry was never in a comparison; `substrate` is
 * present only where a verdict was actually reached.
 */
export interface NotPublished {
  /** Why it may not be published. Always recorded. */
  licence: string;
  /** Why the geometry lost the wave 1a comparison, where it was in one. */
  substrate?: string;
}

export const UNPUBLISHED_PACKS: Readonly<Record<string, NotPublished>> = {
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
  'normal-vhl-heart0102-chambers': {
    licence:
      'CC BY-NC 4.0. Not published: a non-commercial pack binds the whole application to the ' +
      'non-commercial red lines, and that constraint is not accepted for the published build. ' +
      'Identical to the position on normal-vhl-heart0102, from which this pack is derived.',
  },
  'tof-cobivecox-chd0017001': {
    licence:
      'CC BY 4.0, state "confirmed" — read from the Zenodo record\'s own licence field. Not ' +
      'published anyway: nothing new ships in this build. It is also patient-derived ' +
      'congenital anatomy from an imaging atlas, and whether a repaired Tetralogy of Fallot ' +
      'ventricle belongs in a teaching tool is a clinical question, not a licence one.',
  },
  'motion-straus-us-patient01': {
    licence:
      'NO LICENCE STATEMENT EXISTS at the source, so the state is "unconfirmed". The dataset ' +
      "page, the Girder collection description and its metadata were all read and none names " +
      'a licence; the only access statement anywhere is that the database is public and needs ' +
      'no login, which is permission to DOWNLOAD and says nothing about redistribution or ' +
      'derivative works. Resolving it means writing to the depositors.',
  },
  'normal-kit-four-chamber': {
    licence:
      'CC BY-NC 4.0, state "non_commercial" — read from the Zenodo record\'s own licence ' +
      'field. PERMANENTLY UNPUBLISHABLE: a non-commercial pack binds the whole application ' +
      'to the NC red lines, and that constraint is not accepted for the published build. ' +
      'The same position already taken on the Visible Heart Labs pack.',
  },
  'anatomy-bodyparts3d-heart': {
    licence:
      'CC BY 4.0, state "confirmed" — read from the rights holder\'s own licence page, which ' +
      'grants redistribution and derivative works explicitly. A CONTRADICTION is recorded in ' +
      'the pack rather than resolved: older mirrors of the same project state CC BY-SA 2.1 ' +
      'Japan, and if that reading is the right one this pack is a share-alike derivative. Not ' +
      'published either way, so the contradiction costs nothing until it has to be settled.',
  },
  'motion-biv-cinemri': {
    licence:
      'CC BY 4.0, state "confirmed" — read from the Zenodo record\'s own licence field. ' +
      'Not published anyway: this build is for the owner\'s own use, nothing new ships, and ' +
      'the pack is undocumented supplementary data of unverified quality. It is here to be ' +
      'LOOKED AT, which is the only claim made for it. ' +
      'WHY IT IS KEPT, since every visible criterion says delete it: it loses to STRAUS on ' +
      'every technical axis — 10 frames against 30, no vertex correspondence, half a cycle, ' +
      'and 11 components of segmentation debris — and anyone judging the two on quality would ' +
      'drop this one and be right to. But STRAUS has NO LICENCE STATEMENT at its source at ' +
      'all, and this is CC BY 4.0 confirmed, which makes it the only moving asset here that ' +
      'could EVER ship. A worse model that may be published outranks a better one that may ' +
      'not. Deleting it leaves the project with no motion it is allowed to show.',
  },
};

/** Both wave 1a rejects render in orientations that could not be verified. */
export const UNVERIFIED_ORIENTATION_NOTE =
  'Both rejected packs also render in UNVERIFIED orientations. Neither source carries chamber ' +
  'labels, so superior and patient-left cannot be derived from the geometry the way they are for ' +
  'the Rodero pack; each declares the glTF default and says so in its own provenance. Verifying ' +
  'them is deliberately not done, because they are not shipping.';

export function isPublishedPack(packId: string): boolean {
  return (PUBLISHED_PACK_IDS as readonly string[]).includes(packId);
}

export function unpublishedReason(packId: string): NotPublished | undefined {
  return UNPUBLISHED_PACKS[packId];
}

/* -------------------------------------------------------------------------- */
/* the catalogue registry and picker policy                                   */
/* -------------------------------------------------------------------------- */

/**
 * What a pack IS, which decides which modes it can even offer.
 *
 * Not a licence state and not a publication state: a pack can be confirmed,
 * published and still Explore-only. This is the shape of the content.
 */
export type PackKind =
  /** Labelled, with an echo volume and views. Echo and Explore both work. */
  | 'echo'
  /** Geometry only. Explore works; Echo is refused, visibly. */
  | 'explore';

export interface CatalogueEntry {
  id: string;
  /** `meta.display_name`, so the picker does not invent its own names. */
  displayName: string;
  kind: PackKind;
  licenseState: LicenseState;
  /** Whether the pack carries keyframed geometry the cine control can play. */
  moving: boolean;
  /**
   * An ENGINE FIXTURE rather than content.
   *
   * The stub is two nested boxes. It is published on purpose — the visual suite
   * runs against the production artefact and needs one pack whose contents this
   * repository fixes — but it is not something a learner should be offered
   * beside a heart. The picker hides fixtures on the deployed site and marks
   * them in development, where seeing them is the point.
   */
  fixture?: boolean;
  /** One short line on what this pack is, for the chip's title. */
  summary: string;
}

/**
 * Every pack in the repository: the complete registry behind the model picker.
 *
 * It lives here, beside the publication rule, rather than in a manifest
 * generated from the packs, for one reason: a manifest built from `public/`
 * would still list the packs the build prunes, so the picker would offer links
 * that 404 on the deployed site. Reading the catalogue from the same module
 * that decides publication means the picker cannot offer what the build will
 * not ship.
 *
 * It is DUPLICATED data, and duplicated data drifts, so
 * `tests/unit/publishedPacks.test.ts` checks every field of every entry against
 * the pack.json actually on disk — the id, the display name, the kind, the
 * licence state and whether it moves. A catalogue that disagrees with a pack
 * fails the build rather than misdescribing a model in the picker.
 */
export const PACK_CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'normal-rodero',
    displayName: 'Normal heart — Rodero/CEMRG average four-chamber',
    kind: 'echo',
    licenseState: 'confirmed',
    moving: false,
    // Six since the corrected poses were adopted and B4 and F1 were created
    // (pack 0.1.2, 2026-08-21). Counted rather than remembered would be better;
    // until then this string is content and has to be kept true.
    summary: 'The selected substrate. 24 labelled structures, six draft views.',
  },
  {
    id: 'stub',
    displayName: 'Synthetic stub pack',
    kind: 'echo',
    licenseState: 'confirmed',
    moving: false,
    summary: 'Synthetic engine fixture. Two nested boxes — not anatomy.',
    fixture: true,
  },
  {
    id: 'normal-alberta-neonatal',
    displayName: 'Normal Neonatal Heart — 3D Heart Project',
    kind: 'echo',
    licenseState: 'unconfirmed',
    moving: false,
    summary: 'Wave 1a reject. Blood pool and myocardium interpenetrate.',
  },
  {
    id: 'normal-vhl-heart0102',
    displayName: 'Healthy Pediatric Heart — Visible Heart Labs Heart0102',
    kind: 'echo',
    licenseState: 'non_commercial',
    moving: false,
    summary: 'Wave 1a reject. One undivided tissue body, 1,026 components.',
  },
  {
    id: 'normal-vhl-heart0102-chambers',
    displayName: 'Healthy Pediatric Heart — Heart0102, chamber-labelled',
    kind: 'echo',
    licenseState: 'non_commercial',
    moving: false,
    summary: 'Hand-labelled derivative. Six lumen and six chamber myocardium structures.',
  },
  {
    id: 'tof-cobivecox-chd0017001',
    displayName: 'Tetralogy of Fallot — CobivecoX patient-specific biventricular surfaces',
    kind: 'explore',
    licenseState: 'confirmed',
    moving: false,
    summary: 'Congenital. LV and RV endocardium, epicardium, four valve annuli.',
  },
  {
    id: 'motion-straus-us-patient01',
    displayName: 'Multimodality STRAUS — simulated ultrasound myocardium, one healthy patient',
    kind: 'explore',
    licenseState: 'unconfirmed',
    moving: true,
    summary: '30 frames, a whole cycle, with vertex correspondence. Synthetic.',
  },
  {
    id: 'normal-kit-four-chamber',
    displayName: 'KIT four-chamber heart — chambers, epicardium and pericardium',
    kind: 'explore',
    licenseState: 'non_commercial',
    moving: false,
    summary: 'Four chamber cavities, an epicardium and a pericardial shell. Watertight.',
  },
  {
    id: 'anatomy-bodyparts3d-heart',
    displayName: 'BodyParts3D heart — separately modelled valve leaflets and cusps',
    kind: 'explore',
    licenseState: 'confirmed',
    moving: false,
    summary: '86 separate parts: leaflets, cusps, papillary muscles, coronaries.',
  },
  {
    id: 'motion-biv-cinemri',
    displayName: 'Cardiac Motion — biventricular surfaces from cine-MRI',
    kind: 'explore',
    licenseState: 'confirmed',
    moving: true,
    summary: 'Ten cine-MRI frames, end-diastole to end-systole. Unlabelled.',
  },
];

/**
 * Research packs retained on disk but withdrawn from the normal picker.
 *
 * Owner decisions: four geometry-only models were withdrawn on 2026-08-20 as
 * not useful enough to offer in their current form; on 2026-08-22 the original
 * undivided Heart0102 was superseded in the picker by its chamber-labelled
 * derivative. Their packs and provenance remain in the repository, and
 * development deep links still work, so neither decision deletes evidence.
 * BodyParts3D is the one geometry-only pack that remains selectable.
 */
export const PICKER_HIDDEN_PACK_IDS = [
  // Retained as the 2026-08-19 substrate-rejection evidence, but superseded in
  // the research shelf by the chamber-labelled derivative.
  'normal-vhl-heart0102',
  'tof-cobivecox-chd0017001',
  'motion-straus-us-patient01',
  'normal-kit-four-chamber',
  'motion-biv-cinemri',
] as const;

const pickerHiddenPackIds = new Set<string>(PICKER_HIDDEN_PACK_IDS);

/**
 * What the picker should offer here.
 *
 * In a production build that is the published packs, MINUS the engine fixtures.
 * Unpublished packs are not in `dist/` at all, so offering them would offer a
 * 404; the fixtures are there and must stay there, but a chip reading
 * "Synthetic stub pack" beside a real heart advertises a test artefact as
 * content. It stays reachable by `?pack=stub`, which is how the visual suite
 * and anyone debugging the loader get to it.
 *
 * In development it is the active shelf plus the engine fixture. Withdrawn
 * research packs remain loadable through an explicit `?pack=` deep link, but
 * are not advertised in the picker.
 */
export function cataloguedPacks(production: boolean): readonly CatalogueEntry[] {
  return production
    ? PACK_CATALOGUE.filter((entry) => isPublishedPack(entry.id) && !entry.fixture)
    : PACK_CATALOGUE.filter((entry) => !pickerHiddenPackIds.has(entry.id));
}

/**
 * Which BODY CONTEXTS reach the deployed site.
 *
 * A body context is a second kind of shippable directory under `public/`, and
 * it needs the same control for the same reason: `public/body-context/<id>/`
 * carries several megabytes of third-party thoracic geometry, and a context
 * that shipped while the pack it is bound to did not would be a licence
 * exposure attached to a heart that is not there.
 *
 * A context ships only if the pack it serves ships. `fitted-chest-bp3d-heart0102-chambers`
 * is bound to `normal-vhl-heart0102-chambers`, whose source is CC BY-NC 4.0
 * and whose `license_state` is `non_commercial`, so it is development-only —
 * and its own chest mesh is a share-alike derivative besides.
 *
 * Enforced at BUILD time by `vite.config.ts` and asserted afterwards by
 * `npm run check:published-packs`, exactly as the pack list is.
 */
export const PUBLISHED_CONTEXT_IDS = ['adult-reference-chest-bp3d'] as const;

export const UNPUBLISHED_CONTEXTS: Readonly<Record<string, string>> = {
  'fitted-chest-bp3d-heart0102-chambers':
    'Bound to normal-vhl-heart0102-chambers, which is CC BY-NC 4.0 and non_commercial and ' +
    'does not ship. The chest mesh itself is a BodyParts3D derivative carried under ' +
    'CC BY-SA 2.1 Japan, uniformly scaled to that heart, and is development-only.',
};

export function isPublishedContext(contextId: string): boolean {
  return (PUBLISHED_CONTEXT_IDS as readonly string[]).includes(contextId);
}

/** Human wording for a licence state, for the chip. */
export const LICENSE_STATE_LABEL: Readonly<Record<LicenseState, string>> = {
  confirmed: 'licence confirmed',
  non_commercial: 'non-commercial',
  unconfirmed: 'licence unconfirmed',
  permission_pending: 'permission pending',
};
