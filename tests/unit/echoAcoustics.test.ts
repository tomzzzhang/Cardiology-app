/**
 * Priority 1 in `contracts/echo-renderer.md` is correct grey-level ORDERING.
 * These tests pin the lookup and the compression curve that produce it, and
 * assert the ordering against the real shipped pack rather than a fixture — a
 * pack whose authored echogenicity is in the wrong order would render a
 * plausible-looking image of the wrong thing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_LABEL,
  BLOOD,
  DEFAULT_TUNING,
  LABEL_LUT_SIZE,
  buildLabelLut,
  compress,
  describePack,
  greyOrdering,
  resolveTuning,
  tgcGain,
} from '../../src/echo/acoustics.ts';
import { validatePack } from '../../src/schema/validate.ts';
import type { EchoLabel } from '../../src/schema/packV0.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function pack(id: string) {
  const raw = JSON.parse(readFileSync(join(repoRoot, 'public', 'packs', id, 'pack.json'), 'utf8'));
  const result = validatePack(raw);
  if (!result.ok) throw new Error(`${id} does not validate`);
  return result.pack;
}

const labels: EchoLabel[] = [
  { id: 1, structure: 'lv-myocardium', echogenicity: 0.55, attenuation: 0.45 },
  { id: 7, structure: 'valve-ring', echogenicity: 0.9, attenuation: 0.8 },
];

describe('buildLabelLut', () => {
  it('covers every possible raw-u8 value', () => {
    expect(buildLabelLut(labels).data.length).toBe(LABEL_LUT_SIZE * 4);
  });

  it('writes each label at its own voxel value', () => {
    const lut = buildLabelLut(labels);
    expect(lut.data[1 * 4]).toBe(Math.round(0.55 * 255));
    expect(lut.data[7 * 4]).toBe(Math.round(0.9 * 255));
    expect(lut.described).toEqual([1, 7]);
  });

  it('reads background as blood, not as silence', () => {
    // A chamber lumen is blood. Rendering it as "no material" would remove the
    // low-level scatter that puts blood at the bottom of the ordering rather
    // than outside it.
    const lut = buildLabelLut(labels);
    expect(lut.data[BACKGROUND_LABEL * 4]).toBe(Math.round(BLOOD.echogenicity * 255));
    expect(lut.data[BACKGROUND_LABEL * 4 + 2]).toBe(0);
  });

  it('marks described labels in the blue channel so the shader can find interfaces', () => {
    const lut = buildLabelLut(labels);
    expect(lut.data[1 * 4 + 2]).toBe(255);
    expect(lut.data[200 * 4 + 2]).toBe(0);
  });

  it('scales attenuation into the channel and reports the scale for the shader to undo', () => {
    const strong: EchoLabel[] = [
      { id: 1, structure: 'a', echogenicity: 0.5, attenuation: 4 },
      { id: 2, structure: 'b', echogenicity: 0.5, attenuation: 2 },
    ];
    const lut = buildLabelLut(strong);
    expect(lut.attenuationScale).toBe(4);
    expect(lut.data[1 * 4 + 1]).toBe(255);
    expect(lut.data[2 * 4 + 1]).toBe(Math.round(255 * 0.5));
  });

  it('never lets an out-of-range authored value overflow its channel', () => {
    const lut = buildLabelLut([{ id: 3, structure: 'x', echogenicity: 1, attenuation: 0 }]);
    expect(Math.max(...lut.data)).toBeLessThanOrEqual(255);
  });
});

describe('resolveTuning', () => {
  it('returns the pediatric defaults when a view tunes nothing', () => {
    expect(resolveTuning(undefined)).toEqual(DEFAULT_TUNING);
    expect(resolveTuning({})).toEqual(DEFAULT_TUNING);
  });

  it('applies a known override', () => {
    expect(resolveTuning({ dynamicRangeDb: 40 }).dynamicRangeDb).toBe(40);
  });

  it('ignores unknown keys instead of refusing the pack', () => {
    // echo_tuning is an open bag in schema v0. A pack authored against a later
    // renderer must still display on this one.
    expect(() => resolveTuning({ someFutureKnob: 3 })).not.toThrow();
    expect(resolveTuning({ someFutureKnob: 3 })).toEqual(DEFAULT_TUNING);
  });

  it('drops non-numeric and non-finite values for numeric knobs', () => {
    expect(resolveTuning({ gain: 'loud' }).gain).toBe(DEFAULT_TUNING.gain);
    expect(resolveTuning({ gain: Number.POSITIVE_INFINITY }).gain).toBe(DEFAULT_TUNING.gain);
  });
});

describe('tgcGain', () => {
  it('is unity at the transducer face and maximal at full depth', () => {
    expect(tgcGain(0, 120, 26)).toBeCloseTo(1, 12);
    expect(tgcGain(120, 120, 26)).toBeCloseTo(Math.pow(10, 26 / 20), 9);
  });

  it('increases monotonically with depth', () => {
    let previous = 0;
    for (const r of [0, 20, 40, 60, 80, 100, 120]) {
      const gain = tgcGain(r, 120, 26);
      expect(gain).toBeGreaterThan(previous);
      previous = gain;
    }
  });

  it('clamps beyond the sector rather than amplifying without bound', () => {
    expect(tgcGain(500, 120, 26)).toBe(tgcGain(120, 120, 26));
  });
});

describe('compress', () => {
  it('maps to the unit interval', () => {
    for (const envelope of [0, 1e-4, 0.01, 0.2, 0.5, 1, 40]) {
      const value = compress(envelope, DEFAULT_TUNING);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('is monotonic, so brighter returns are never displayed darker', () => {
    let previous = -1;
    for (const envelope of [0.03, 0.05, 0.1, 0.2, 0.4, 0.8, 1]) {
      const value = compress(envelope, DEFAULT_TUNING);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('rejects below the floor', () => {
    expect(compress(DEFAULT_TUNING.reject * 0.5, DEFAULT_TUNING)).toBe(0);
  });

  it('lifts low-level speckle above black — blood is near-black, not black', () => {
    const blood = compress(0.06, DEFAULT_TUNING);
    expect(blood).toBeGreaterThan(0);
    expect(blood).toBeLessThan(compress(0.55, DEFAULT_TUNING));
  });

  it('spends its range on mid-greys instead of saturating to white', () => {
    // Regression for the double-compression bug: a log knee followed by a dB
    // window pushed everything above ~1% of full scale to within a few dB of
    // white, so the sector rendered bimodal with no mid-grey. That reads as CT,
    // which is precisely the Stage 0 failure the contract names.
    const samples = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.7, 1.0];
    const values = samples.map((envelope) => compress(envelope, DEFAULT_TUNING));
    const saturated = values.filter((value) => value > 0.98).length;
    const midGrey = values.filter((value) => value > 0.15 && value < 0.85).length;
    expect(saturated).toBeLessThanOrEqual(1);
    expect(midGrey).toBeGreaterThanOrEqual(4);
  });

  it('puts full scale at white and the dynamic range below it at black', () => {
    expect(compress(1, DEFAULT_TUNING)).toBeCloseTo(1, 6);
    const floor = Math.pow(10, -DEFAULT_TUNING.dynamicRangeDb / 20);
    expect(compress(floor * 0.9, DEFAULT_TUNING)).toBe(0);
  });

  it('narrowing the dynamic range raises contrast', () => {
    // Contrast is the SEPARATION between two returns, not the brightness of
    // one. A narrower window steepens the ramp, so a mid-level sample actually
    // darkens while the gap between bright and dim widens. Asserting on a
    // single sample would have pinned the opposite, and wrongly.
    const gap = (dynamicRangeDb: number) =>
      compress(0.5, { ...DEFAULT_TUNING, dynamicRangeDb }) -
      compress(0.05, { ...DEFAULT_TUNING, dynamicRangeDb });
    expect(gap(40)).toBeGreaterThan(gap(70));
  });
});

describe('the shipped pack', () => {
  it('describes a volume the renderer can consume', () => {
    const descriptor = describePack(pack('normal-rodero'));
    expect(descriptor.resolution).toEqual([192, 192, 192]);
    expect(descriptor.meshToVolume).toHaveLength(16);
    expect(descriptor.lut.described.length).toBeGreaterThan(0);
  });

  it('orders myocardium above blood', () => {
    const p = pack('normal-rodero');
    const ordering = greyOrdering(p.echo_volume.labels);
    const lv = ordering.find((entry) => entry.structure === 'lv-myocardium');
    expect(lv).toBeDefined();
    expect(lv!.echogenicity).toBeGreaterThan(BLOOD.echogenicity);
  });

  it('gives every declared label an echogenicity inside the authored range', () => {
    for (const label of pack('normal-rodero').echo_volume.labels) {
      expect(label.echogenicity).toBeGreaterThanOrEqual(0);
      expect(label.echogenicity).toBeLessThanOrEqual(1);
      expect(label.attenuation).toBeGreaterThanOrEqual(0);
    }
  });

  it('never assigns a label to the reserved background value', () => {
    for (const label of pack('normal-rodero').echo_volume.labels) {
      expect(label.id).not.toBe(BACKGROUND_LABEL);
    }
  });
});
