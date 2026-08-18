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
  REJECTED_PACKS,
  UNVERIFIED_ORIENTATION_NOTE,
  isPublishedPack,
  rejectionFor,
} from '../../src/packs/published.ts';

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
      const accounted = isPublishedPack(packId) || rejectionFor(packId) !== undefined;
      expect(accounted, `pack "${packId}" is neither published nor rejected`).toBe(true);
    }
  });

  it('refuses the licence-blocked packs', () => {
    expect(isPublishedPack('normal-alberta-neonatal')).toBe(false);
    expect(isPublishedPack('normal-vhl-heart0102')).toBe(false);
  });

  it('records a substrate reason AND a licence reason for each rejection', () => {
    // They fail differently: a substrate verdict can be revisited by re-reading
    // the geometry; a licence block cannot be resolved from this repository.
    for (const [packId, rejection] of Object.entries(REJECTED_PACKS)) {
      expect(rejection.substrate.length, `${packId} substrate reason`).toBeGreaterThan(80);
      expect(rejection.licence.length, `${packId} licence reason`).toBeGreaterThan(40);
    }
  });

  it('names the unreconciled grant for Alberta and the NC constraint for Heart0102', () => {
    expect(REJECTED_PACKS['normal-alberta-neonatal'].licence).toMatch(/CC BY-NC/);
    expect(REJECTED_PACKS['normal-alberta-neonatal'].licence).toMatch(/CC BY 4\.0/);
    expect(REJECTED_PACKS['normal-vhl-heart0102'].licence).toMatch(/CC BY-NC 4\.0/);
  });

  it('states that both rejected packs render in unverified orientations', () => {
    expect(UNVERIFIED_ORIENTATION_NOTE).toMatch(/UNVERIFIED/);
  });
});

describe('rejected packs stay in the repository as evidence', () => {
  it('keeps their pack.json and assets on disk', () => {
    // Not published is not the same as deleted. The wave 1a comparison has to
    // stay reproducible.
    for (const packId of Object.keys(REJECTED_PACKS)) {
      expect(existsSync(join(packsDir, packId, 'pack.json')), packId).toBe(true);
    }
  });

  it('carries the verdict inside each rejected pack own provenance', () => {
    // The reasoning must survive being read by someone holding only the pack.
    for (const packId of Object.keys(REJECTED_PACKS)) {
      const pack = JSON.parse(readFileSync(join(packsDir, packId, 'pack.json'), 'utf8'));
      const note: string = pack.provenance.modified.note;
      expect(note, packId).toMatch(/REJECTED AS SUBSTRATE/);
      expect(note, packId).toMatch(/UNVERIFIED/);
    }
  });

  it('keeps their provenance and licence intact', () => {
    for (const packId of Object.keys(REJECTED_PACKS)) {
      const pack = JSON.parse(readFileSync(join(packsDir, packId, 'pack.json'), 'utf8'));
      expect(pack.provenance.license.length).toBeGreaterThan(0);
      expect(pack.provenance.creator.length).toBeGreaterThan(0);
      expect(pack.provenance.vetted.status).toBe('draft');
    }
  });
});
