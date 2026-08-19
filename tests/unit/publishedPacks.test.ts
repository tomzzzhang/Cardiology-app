/**
 * The published allowlist is a licence control, not a preference.
 *
 * Two packs in this repository may not reach a public URL: one has an
 * unreconciled grant, the other is non-commercial. These tests pin the list and
 * the reasons, so removing a pack from the allowlist stays a deliberate act with
 * a recorded justification rather than an edit that passes unnoticed.
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACK_ID,
  PUBLISHED_PACK_IDS,
  UNPUBLISHED_PACKS,
  UNVERIFIED_ORIENTATION_NOTE,
  isPublishedPack,
  unpublishedReason,
  LICENSE_STATE_LABEL,
  PACK_CATALOGUE,
  cataloguedPacks,
} from '../../src/packs/published.ts';
import { LICENSE_STATES, mayBePublished, type LicenseState } from '../../src/schema/packV0.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packsDir = join(repoRoot, 'public', 'packs');

function packIdsInRepo(): string[] {
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('the published allowlist', () => {
  it('publishes the selected substrate and the engine fixture, and nothing else', () => {
    expect([...PUBLISHED_PACK_IDS].sort()).toEqual(['normal-rodero', 'stub']);
  });

  it('defaults to the selected substrate', () => {
    expect(DEFAULT_PACK_ID).toBe('normal-rodero');
    expect(isPublishedPack(DEFAULT_PACK_ID)).toBe(true);
  });

  it('accounts for every pack in the repository', () => {
    // A pack that is neither published nor explicitly rejected would ship by
    // accident the moment someone adds it, which is how a licence breach happens.
    for (const packId of packIdsInRepo()) {
      const accounted = isPublishedPack(packId) || unpublishedReason(packId) !== undefined;
      expect(accounted, `pack "${packId}" is neither published nor rejected`).toBe(true);
    }
  });

  it('refuses the licence-blocked packs', () => {
    expect(isPublishedPack('normal-alberta-neonatal')).toBe(false);
    expect(isPublishedPack('normal-vhl-heart0102')).toBe(false);
  });

  it('records a publication reason for every unpublished pack', () => {
    for (const [packId, entry] of Object.entries(UNPUBLISHED_PACKS)) {
      expect(entry.licence.length, `${packId} licence reason`).toBeGreaterThan(40);
    }
  });

  it('records a substrate reason as well wherever a verdict was reached', () => {
    // The two reasons fail differently: a substrate verdict can be revisited by
    // re-reading the geometry; a licence block cannot be resolved from this
    // repository at all. A shelf model that was never in the wave 1a comparison
    // has no substrate verdict to record, and inventing one would be worse.
    for (const packId of WAVE_1A_REJECTS) {
      expect(UNPUBLISHED_PACKS[packId].substrate?.length, packId).toBeGreaterThan(80);
    }
  });

  it('names the unreconciled grant for Alberta and the NC constraint for Heart0102', () => {
    expect(UNPUBLISHED_PACKS['normal-alberta-neonatal'].licence).toMatch(/CC BY-NC/);
    expect(UNPUBLISHED_PACKS['normal-alberta-neonatal'].licence).toMatch(/CC BY 4\.0/);
    expect(UNPUBLISHED_PACKS['normal-vhl-heart0102'].licence).toMatch(/CC BY-NC 4\.0/);
  });

  it('states that both rejected packs render in unverified orientations', () => {
    expect(UNVERIFIED_ORIENTATION_NOTE).toMatch(/UNVERIFIED/);
  });
});

/** The wave 1a losers, as opposed to the shelf models that never competed. */
const WAVE_1A_REJECTS = Object.keys(UNPUBLISHED_PACKS).filter(
  (packId) => UNPUBLISHED_PACKS[packId].substrate !== undefined,
);

describe('rejected packs stay in the repository as evidence', () => {
  it('keeps their pack.json and assets on disk', () => {
    // Not published is not the same as deleted. The wave 1a comparison has to
    // stay reproducible.
    for (const packId of WAVE_1A_REJECTS) {
      expect(existsSync(join(packsDir, packId, 'pack.json')), packId).toBe(true);
    }
  });

  it('carries the verdict inside each rejected pack own provenance', () => {
    // The reasoning must survive being read by someone holding only the pack.
    for (const packId of WAVE_1A_REJECTS) {
      const pack = JSON.parse(readFileSync(join(packsDir, packId, 'pack.json'), 'utf8'));
      const note: string = pack.provenance.modified.note;
      expect(note, packId).toMatch(/REJECTED AS SUBSTRATE/);
      expect(note, packId).toMatch(/UNVERIFIED/);
    }
  });

  it('keeps their provenance and licence intact', () => {
    for (const packId of WAVE_1A_REJECTS) {
      const pack = JSON.parse(readFileSync(join(packsDir, packId, 'pack.json'), 'utf8'));
      expect(pack.provenance.license.length).toBeGreaterThan(0);
      expect(pack.provenance.creator.length).toBeGreaterThan(0);
      expect(pack.provenance.vetted.status).toBe('draft');
    }
  });
});

describe('the licence state gates publication (schema v0.1)', () => {
  /*
   * The rule enforced here is the same one `scripts/check-provenance.ts`
   * applies, over the same real packs. It is duplicated deliberately: the CI
   * script runs at build time and this runs in `npm run test`, so removing the
   * script would not silently remove the rule.
   */
  it('publishes no pack whose licence is anything but confirmed', () => {
    for (const packId of packIdsInRepo()) {
      const pack = JSON.parse(readFileSync(join(packsDir, packId, 'pack.json'), 'utf8'));
      const state = pack.provenance.license_state as LicenseState;
      if (!mayBePublished(state)) {
        expect(isPublishedPack(packId), `${packId} is "${state}" and must not ship`).toBe(false);
      }
    }
  });

  it('gives every pack in the repository a licence state', () => {
    for (const packId of packIdsInRepo()) {
      const pack = JSON.parse(readFileSync(join(packsDir, packId, 'pack.json'), 'utf8'));
      expect(LICENSE_STATES, packId).toContain(pack.provenance.license_state);
    }
  });

  it('records the reason each unpublished pack cannot ship', () => {
    // A pack can be off the list for a substrate verdict, a licence, or both.
    // What it may not be is off the list for no recorded reason.
    for (const packId of packIdsInRepo()) {
      if (isPublishedPack(packId)) continue;
      const pack = JSON.parse(readFileSync(join(packsDir, packId, 'pack.json'), 'utf8'));
      const reasoned =
        unpublishedReason(packId) !== undefined
        || !mayBePublished(pack.provenance.license_state as LicenseState);
      expect(reasoned, `${packId} is unpublished with no recorded reason`).toBe(true);
    }
  });
});

describe('the model picker catalogue', () => {
  /*
   * The catalogue is duplicated data: it restates, in TypeScript, facts that
   * live in each pack.json. It is duplicated on purpose — a manifest generated
   * from `public/` would still list the packs the build prunes, so the picker
   * would offer links that 404 on the deployed site — and duplicated data
   * drifts, so every field is checked against the pack it describes.
   */
  function packOnDisk(packId: string): any {
    return JSON.parse(readFileSync(join(packsDir, packId, 'pack.json'), 'utf8'));
  }

  it('lists every pack in the repository, and nothing that is not there', () => {
    expect(PACK_CATALOGUE.map((entry) => entry.id).sort()).toEqual(packIdsInRepo());
  });

  it('carries each pack own display name rather than one of its own', () => {
    for (const entry of PACK_CATALOGUE) {
      expect(entry.displayName, entry.id).toBe(packOnDisk(entry.id).meta.display_name);
    }
  });

  it('describes each pack kind the way the pack itself does', () => {
    // The picker groups by this, and the grouping is a promise about which
    // modes will be available. Getting it wrong would put an Explore-only pack
    // under a heading that says Echo works.
    for (const entry of PACK_CATALOGUE) {
      const pack = packOnDisk(entry.id);
      const exploreOnly = pack.echo_volume === undefined;
      expect(entry.kind, entry.id).toBe(exploreOnly ? 'explore' : 'echo');
      expect(entry.moving, entry.id).toBe(pack.meshes.keyframes !== undefined);
    }
  });

  it('shows each pack real licence state on the chip', () => {
    for (const entry of PACK_CATALOGUE) {
      expect(entry.licenseState, entry.id).toBe(packOnDisk(entry.id).provenance.license_state);
    }
  });

  it('offers only published packs in a production build', () => {
    const production = cataloguedPacks(true);
    expect(production.every((entry) => isPublishedPack(entry.id))).toBe(true);
    expect(production.map((entry) => entry.id).sort()).toEqual([...PUBLISHED_PACK_IDS].sort());
  });

  it('offers everything in development, because looking at them is the point', () => {
    expect(cataloguedPacks(false)).toEqual(PACK_CATALOGUE);
  });

  it('names every licence state, so no chip can render an empty tag', () => {
    for (const state of LICENSE_STATES) {
      expect(LICENSE_STATE_LABEL[state].length).toBeGreaterThan(0);
    }
  });
});
