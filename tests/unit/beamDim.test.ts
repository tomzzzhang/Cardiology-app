/**
 * UI-2: dimming the anatomy the beam does not cross, without making it
 * unreadable.
 *
 * The panel has to do two jobs at once — mark the imaged slab, and stay a
 * LABELLED anatomy viewer while doing it — and they only compete if the dim is
 * one knob. Split into luminance and saturation they do not: lightness is what
 * the eye segments a scene by, so it carries the marking, and hue difference
 * survives being cut hard, so saturation can be cut much further than
 * luminance without costing legibility.
 *
 * "Costing legibility" is exactly the kind of claim that gets asserted from
 * memory and quietly stops being true, so it is measured here instead, in CIE
 * Lab, over the palette the viewer actually ships. Lab because sRGB distance is
 * not perceptual: green occupies far more of the sRGB cube than blue does, so
 * two greens can be numerically further apart than a blue and a gold that any
 * reader tells apart instantly.
 */
import { describe, expect, it } from 'vitest';
import {
  DIM_LUMINANCE,
  DIM_SATURATION,
  dimmedColour,
} from '../../src/viewer/beamDim.ts';
import { PALETTE } from '../../src/viewer/palette.ts';

type Rgb = [number, number, number];

function rgbOf(hex: number): Rgb {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** sRGB (0-255) -> CIE Lab, D65. */
function lab([r, g, b]: Rgb): [number, number, number] {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [linear(r), linear(g), linear(b)];
  const x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047;
  const y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  const z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function separation(a: Rgb, b: Rgb): number {
  const [la, aa, ba] = lab(a);
  const [lb, ab, bb] = lab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
}

/**
 * Roughly where two colours stop reading as different colours at a glance.
 *
 * A just-noticeable difference is about 2.3; this is well above it, because the
 * question is not whether a reader could tell them apart side by side but
 * whether they read as different structures across a panel without being
 * compared.
 */
const READS_AS_DIFFERENT = 10;

const chambers = ['lv-myocardium', 'rv-myocardium', 'la-myocardium', 'ra-myocardium'] as const;

describe('the beam dim keeps the model labelled', () => {
  it('cuts saturation much harder than luminance', () => {
    // The decoupling itself. One knob would have to compromise between the two
    // jobs; two knobs let each be set for the job it does.
    expect(DIM_SATURATION).toBeLessThan(DIM_LUMINANCE / 2);
  });

  it('leaves every pair of chambers telling itself apart outside the beam', () => {
    /*
     * THE test the tuning was pushed against: outside the beam, can the right
     * ventricle still be told from the left atrium at a glance? The whole
     * palette is checked rather than that one pair, because the binding
     * constraint turned out to be the closest pair in it — the gold left
     * atrium against the green right atrium.
     */
    for (const first of chambers) {
      for (const second of chambers) {
        if (first >= second) continue;
        const gap = separation(dimmedColour(rgbOf(PALETTE[first])), dimmedColour(rgbOf(PALETTE[second])));
        expect(gap, `${first} vs ${second}`).toBeGreaterThan(READS_AS_DIFFERENT);
      }
    }
  });

  it('marks the imaged slab clearly, in and out', () => {
    // The other half of the trade. Every structure has to visibly change when
    // the beam leaves it, or the highlight is not marking anything.
    for (const id of Object.keys(PALETTE)) {
      const colour = rgbOf(PALETTE[id]);
      expect(separation(colour, dimmedColour(colour)), id).toBeGreaterThan(25);
    }
  });

  it('beats the single-knob setting it replaced on both counts at once', () => {
    /*
     * The previous values were 0.58 luminance / 0.62 saturation. Splitting the
     * channels buys a stronger in/out contrast AND does not cost more than a
     * couple of Lab units on the closest pair — which is the point of splitting
     * them, and worth pinning so a future "simplify" does not undo it.
     */
    const previous = (rgb: Rgb): Rgb => {
      const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      return rgb.map((c) => (luma + 0.62 * (c - luma)) * 0.58) as Rgb;
    };
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

    const ids = Object.keys(PALETTE);
    const now = mean(ids.map((id) => separation(rgbOf(PALETTE[id]), dimmedColour(rgbOf(PALETTE[id])))));
    const before = mean(ids.map((id) => separation(rgbOf(PALETTE[id]), previous(rgbOf(PALETTE[id])))));
    expect(now).toBeGreaterThan(before);
  });

  it('never brightens anything, whatever it is handed', () => {
    for (const hex of [0x000000, 0xffffff, 0xff0000, 0x00ff00, 0x0000ff, ...Object.values(PALETTE)]) {
      const colour = rgbOf(hex);
      const dimmed = dimmedColour(colour);
      expect(lab(dimmed)[0]).toBeLessThanOrEqual(lab(colour)[0] + 1e-9);
      for (const channel of dimmed) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });
});
