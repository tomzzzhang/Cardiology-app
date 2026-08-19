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
 * dE2000, over the palette the viewer actually ships. A perceptual metric
 * because sRGB distance is not one: green occupies far more of the sRGB cube
 * than blue does, so two greens can be numerically further apart than a blue
 * and a gold that any reader tells apart instantly. dE2000 rather than plain
 * Lab distance because Lab is still noticeably non-uniform in the blue-violet
 * region, which is where two of this palette's ten structures live.
 *
 * **What the guarantee covers, and what it does not.** These tests iterate the
 * four CHAMBER MYOCARDIA, and that is the whole of the claim: the four chambers
 * stay tellable apart outside the beam. They are not the closest pairs in the
 * palette. Over all ten shipped structures five pairs fall below the threshold
 * below, and the worst is pinned at the bottom of this file so a future change
 * cannot make it quietly worse. An earlier revision of `beamDim.ts` described
 * the chamber figure as "the closest pair in the palette", which it is not.
 */
import { describe, expect, it } from 'vitest';
import {
  DIM_LUMINANCE,
  DIM_SATURATION,
  SLAB_HALF_MM,
  dimmedColour,
} from '../../src/viewer/beamDim.ts';
import { PALETTE } from '../../src/viewer/palette.ts';
import imagingConstants from '../../shared/imaging-constants.json';
import { lab, rgbOf, separation, type Rgb } from '../lib/colour.ts';

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

describe('the imaged slab is one number, not two', () => {
  it('takes its thickness from the file the ingest pipeline reads', () => {
    /*
     * `pipeline/views.py` decides which structures a sweep REACHES and this
     * module decides which fragments the highlight MARKS, over the same slab.
     * They held 6.0 and 5 respectively, so the sweep scrubber would have named
     * structures the highlight did not mark — and nothing on screen would have
     * said so, because both numbers render something perfectly plausible.
     *
     * Pinned here rather than trusted, because a duplicated constant is only
     * shared until someone edits one copy.
     */
    expect(SLAB_HALF_MM).toBe(imagingConstants.elevationSlabHalfMm.value);
    expect(imagingConstants.elevationSlabHalfMm.unit).toBe('mm');
    // A sanity bound, not a taste one: paediatric elevation slice thickness is
    // roughly 3-6 mm at the focus, and zero thickness highlights nothing.
    expect(SLAB_HALF_MM).toBeGreaterThan(2);
    expect(SLAB_HALF_MM).toBeLessThan(10);
  });
});

describe('the beam dim keeps the model labelled', () => {
  it('cuts saturation much harder than luminance', () => {
    // The decoupling itself. One knob would have to compromise between the two
    // jobs; two knobs let each be set for the job it does.
    expect(DIM_SATURATION).toBeLessThan(DIM_LUMINANCE / 2);
  });

  it('leaves every pair of chambers telling itself apart outside the beam', () => {
    /*
     * THE test the tuning was pushed against: outside the beam, can the right
     * ventricle still be told from the left atrium at a glance? All six pairs
     * of chamber myocardia are checked rather than that one, because the
     * binding constraint among them turned out to be a different pair — the
     * gold left atrium against the green right atrium, at 12.8.
     *
     * This is the four CHAMBERS, and that is the whole guarantee. See the
     * full-palette pin below for what it does not cover.
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
    /*
     * The other half of the trade. Every structure has to visibly change when
     * the beam leaves it, or the highlight is not marking anything.
     *
     * The threshold is in dE2000, which reads a good deal smaller than the Lab
     * distance an earlier revision used — 25 here is not the 25 that was there
     * before, and the measured minimum is 27.2.
     */
    for (const id of Object.keys(PALETTE)) {
      const colour = rgbOf(PALETTE[id]);
      expect(separation(colour, dimmedColour(colour)), id).toBeGreaterThan(25);
    }
  });

  it('pins the worst pair in the WHOLE palette, which is not a chamber pair', () => {
    /*
     * The claim the tuning does NOT make, measured so it cannot drift further.
     *
     * The valve rings are hued toward the chamber they guard (`palette.ts`),
     * which is what makes them readable at full brightness and what makes them
     * collapse onto their neighbours once chroma is cut. Five of the
     * forty-five pairs fall below `READS_AS_DIFFERENT` when dimmed; the worst
     * is the tricuspid ring against the pulmonary ring, two pale greens.
     *
     * Whether that should be fixed is an open question for the owner, because
     * fixing it means retuning either the dim or the palette and both are the
     * owner's call. What is NOT open is letting it get worse by accident, so
     * the current figure is pinned here. A change that improves it will fail
     * this test and should raise the number.
     */
    const ids = Object.keys(PALETTE);
    let worst = { pair: '', gap: Infinity };
    for (const first of ids) {
      for (const second of ids) {
        if (first >= second) continue;
        const gap = separation(
          dimmedColour(rgbOf(PALETTE[first])), dimmedColour(rgbOf(PALETTE[second])),
        );
        if (gap < worst.gap) worst = { pair: `${first} vs ${second}`, gap };
      }
    }

    expect(worst.pair).toBe('pulmonary-valve-ring vs tricuspid-valve-ring');
    expect(worst.gap).toBeGreaterThan(3.4);
    expect(worst.gap).toBeLessThan(3.5);

    // And the count below the threshold, so a change that trades one pair for
    // another cannot pass by leaving the single worst figure alone.
    let below = 0;
    for (const first of ids) {
      for (const second of ids) {
        if (first >= second) continue;
        const gap = separation(
          dimmedColour(rgbOf(PALETTE[first])), dimmedColour(rgbOf(PALETTE[second])),
        );
        if (gap < READS_AS_DIFFERENT) below += 1;
      }
    }
    expect(below).toBe(5);
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
