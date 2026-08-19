/**
 * The palette has three states, and the third one is a promise.
 *
 * 1. Named and in `PALETTE` — the substrate's own colours, which carry meaning.
 * 2. Identified but not in `PALETTE` — a derived muted colour. All 86
 *    BodyParts3D parts are here.
 * 3. Not identified at all — the neutral grey. Rodero's tags 11 to 24 are here,
 *    and grey means exactly one thing: "we declined to identify this".
 *
 * State 3 only says that while nothing else can say it, so the tests below pin
 * both directions: that an unidentified structure still gets the grey it always
 * got, and that no derived colour comes close enough to the grey, or to the
 * palette's left-red and right-blue, to blur what those already mean.
 *
 * The separation figures are measured in dE2000 over the packs this repository
 * actually contains, the same way `beamDim.test.ts` measures the beam dim, and
 * for the same reason: "tellable apart" is the kind of claim that gets asserted
 * from memory and quietly stops being true.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BLOOD_POOL_COLOUR,
  PALETTE,
  UNNAMED_COLOUR,
  derivedColour,
  structureColour,
} from '../../src/viewer/palette.ts';
import { lab, rgbOf, separation } from '../lib/colour.ts';
import { validatePack } from '../../src/schema/validate.ts';
import type { Pack, Structure } from '../../src/schema/packV0.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packsDir = join(repoRoot, 'public', 'packs');

function everyPack(): { id: string; pack: Pack }[] {
  return readdirSync(packsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const result = validatePack(
        JSON.parse(readFileSync(join(packsDir, entry.name, 'pack.json'), 'utf8')),
      );
      if (!result.ok) throw new Error(`${entry.name} does not validate`);
      return { id: entry.name, pack: result.pack };
    });
}

/** The structures that actually reach state two, across the whole repository. */
function derivedStructures(): { pack: string; structure: Structure }[] {
  return everyPack().flatMap(({ id, pack }) =>
    pack.meshes.structures
      .filter(
        (structure) =>
          structure.mesh_node !== null &&
          !structure.blood_pool &&
          structure.identified &&
          PALETTE[structure.id] === undefined,
      )
      .map((structure) => ({ pack: id, structure })),
  );
}

describe('the three states', () => {
  it('gives a palette structure its palette colour', () => {
    expect(structureColour('lv-myocardium', false, true)).toBe(PALETTE['lv-myocardium']);
  });

  it('gives an identified structure the palette does not name a derived colour', () => {
    const colour = structureColour('cavity-of-left-atrium-wall', false, true);
    expect(colour).not.toBe(UNNAMED_COLOUR);
    expect(colour).toBe(derivedColour('cavity-of-left-atrium-wall'));
  });

  /*
   * THE STATE THAT MUST NOT MOVE. Rodero's tags 11 to 24 are real tissue that
   * nobody has read yet, and the grey is the pack saying so. Everything the
   * grey communicates depends on it being reserved.
   */
  it('leaves an unidentified structure on the unnamed grey', () => {
    expect(structureColour('tagged-region-18', false, false)).toBe(UNNAMED_COLOUR);
    expect(UNNAMED_COLOUR).toBe(0x8a8f96);
  });

  it("keeps Rodero's unnamed tags on the grey, structure by structure", () => {
    const pack = everyPack().find((entry) => entry.id === 'normal-rodero')!.pack;
    const unidentified = pack.meshes.structures.filter((structure) => !structure.identified);
    expect(unidentified.map((s) => s.id).sort()).toEqual(
      Array.from({ length: 14 }, (_, index) => `tagged-region-${index + 11}`).sort(),
    );
    for (const structure of unidentified) {
      expect(structureColour(structure.id, structure.blood_pool, structure.identified))
        .toBe(UNNAMED_COLOUR);
    }
  });

  it('puts blood pool ahead of all three', () => {
    expect(structureColour('cavity-of-left-ventricle', true, true)).toBe(BLOOD_POOL_COLOUR);
    expect(structureColour('lv-myocardium', true, true)).toBe(BLOOD_POOL_COLOUR);
    expect(structureColour('tagged-region-18', true, false)).toBe(BLOOD_POOL_COLOUR);
  });

  it('is the same colour every time, for the same id', () => {
    expect(derivedColour('great-cardiac-vein')).toBe(derivedColour('great-cardiac-vein'));
    expect(derivedColour('great-cardiac-vein')).not.toBe(derivedColour('coronary-sinus'));
  });
});

describe('the derived band cannot claim a side', () => {
  const anchors = {
    'left heart red': PALETTE['lv-myocardium'],
    'right heart blue': PALETTE['rv-myocardium'],
  };

  it('stays well below the palette in chroma', () => {
    for (const { pack, structure } of derivedStructures()) {
      const [, a, b] = lab(rgbOf(derivedColour(structure.id)));
      expect(Math.hypot(a, b), `${pack}/${structure.id}`).toBeLessThan(28);
    }
    for (const anchor of Object.values(anchors)) {
      const [, a, b] = lab(rgbOf(anchor));
      expect(Math.hypot(a, b)).toBeGreaterThan(40);
    }
  });

  /*
   * Desaturating is not enough on its own: a muted slate blue is still blue,
   * and a learner who has been taught "blue is the right heart" on the shipped
   * substrate will read a coronary branch the same way. The hue arcs around
   * both anchors are excluded outright, so a derived colour cannot make a faint
   * version of the claim either.
   */
  it('never lands in the hue window of either anchor', () => {
    const hueOf = (hex: number) => {
      const [, a, b] = lab(rgbOf(hex));
      return (((Math.atan2(b, a) * 180) / Math.PI) + 360) % 360;
    };
    for (const [name, anchor] of Object.entries(anchors)) {
      const anchorHue = hueOf(anchor);
      for (const { pack, structure } of derivedStructures()) {
        const raw = Math.abs(hueOf(derivedColour(structure.id)) - anchorHue) % 360;
        const gap = Math.min(raw, 360 - raw);
        expect(gap, `${pack}/${structure.id} against ${name}`).toBeGreaterThan(20);
      }
    }
  });

  it('stays clear of the reserved grey', () => {
    for (const { pack, structure } of derivedStructures()) {
      expect(
        separation(rgbOf(derivedColour(structure.id)), rgbOf(UNNAMED_COLOUR)),
        `${pack}/${structure.id}`,
      ).toBeGreaterThan(8);
    }
  });
});

/**
 * SIBLINGS HAVE TO BE TELLABLE APART, and this is the measurement that says so.
 *
 * The largest sibling group in the repository is the ten diagonal branches of
 * the anterior descending artery, which is exactly the case where one grey for
 * everything failed. The derivation is a pure function of the structure id and
 * cannot see that two structures are siblings, so it cannot GUARANTEE a
 * separation; what it can do is be measured against the packs that exist. The
 * salt in `palette.ts` is chosen to maximise the figure below.
 *
 * A new pack can push the worst pair under the bar. When it does, this failing
 * test is the signal to change the derivation — not to lower the threshold.
 */
describe('sibling structures are tellable apart', () => {
  /** Structures sharing a parent, within one pack, that both reach state two. */
  function siblingGroups(): { name: string; ids: string[] }[] {
    const groups: { name: string; ids: string[] }[] = [];
    for (const { pack, structure } of derivedStructures()) {
      const name = `${pack}/${structure.parent ?? '(root)'}`;
      const found = groups.find((group) => group.name === name);
      if (found) found.ids.push(structure.id);
      else groups.push({ name, ids: [structure.id] });
    }
    return groups.filter((group) => group.ids.length > 1);
  }

  it('has sibling groups to measure, including a big one', () => {
    const groups = siblingGroups();
    expect(groups.length).toBeGreaterThan(10);
    expect(Math.max(...groups.map((group) => group.ids.length))).toBeGreaterThanOrEqual(10);
  });

  it('keeps every sibling pair above the bar, in dE2000', () => {
    let worst = { distance: Infinity, pair: '' };
    for (const { name, ids } of siblingGroups()) {
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const distance = separation(rgbOf(derivedColour(ids[i])), rgbOf(derivedColour(ids[j])));
          if (distance < worst.distance) {
            worst = { distance, pair: `${name}: ${ids[i]} vs ${ids[j]}` };
          }
        }
      }
    }
    /*
     * 7.5 rather than the beam dim's 10. The derived band is a THIRD of the
     * hue circle wide by construction, and two of its three axes are spent on
     * not making a claim about sides, so ten mutually separated colours cannot
     * be had at the beam dim's threshold. As shipped the worst pair measures
     * about 8.2; a just-noticeable difference is 2.3.
     */
    expect(worst.distance, `closest sibling pair — ${worst.pair}`).toBeGreaterThan(7.5);
  });
});
