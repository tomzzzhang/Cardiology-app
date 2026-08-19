import { expect, test } from '@playwright/test';
import { measureEchoFill } from '../lib/measureEchoFill.mjs';

/**
 * Does the echo image depend on the renderer's internal sampling?
 *
 * ## The concern
 *
 * `src/echo/shaders/psfPass.ts` divides the coherent pass by `sqrt(sum(w^2))`.
 * That is the normalisation which leaves a white-noise input with the variance
 * it arrived with, so INDEPENDENT scatterers — the tissue interior — are
 * resolution-invariant by construction.
 *
 * A specular boundary return is not independent. It is correlated across the
 * kernel, and the normalisation that leaves a correlated input alone is
 * `sum(w)`. The ratio `sum(w) / sqrt(sum(w^2))` grows as `sqrt(sigma)`, and
 * sigma in texels is proportional to the scanline count — so on that reading
 * the boundary term should gain about 3 dB per doubling of lateral resolution
 * while the interior stays put, and `boundaryReflection: 0.55` would be
 * silently pinned to the one sampling it was tuned under.
 *
 * ## What is actually measured
 *
 * It does not happen. Rim-versus-core across the left-ventricular wall is flat
 * to within 0.06 dB over a FOUR-fold span of polar resolution:
 *
 *     0.5x  192 x 256    rim 0.648  core 0.539  ratio 1.203   -0.04 dB
 *     1x    384 x 512    rim 0.688  core 0.569  ratio 1.209    0.00 dB
 *     2x    768 x 1024   rim 0.743  core 0.619  ratio 1.201   -0.06 dB
 *
 * Both terms rise together — about 1.2 dB of displayed grey across that whole
 * span — and their RATIO, which is what `boundaryReflection` sets, does not
 * move. The reasoning above assumes the boundary return is correlated across
 * the PSF kernel; in this renderer it is generated per sample at a label
 * transition along the ray, so its axial extent is closer to one sample than to
 * a kernel width, and it is normalised much as the speckle is.
 *
 * So the tuning constant is NOT pinned to the shipped sampling, and this test
 * is what keeps that true. It is a real gate rather than a note: a future
 * change to the PSF normalisation that reintroduced the dependence would still
 * render a perfectly plausible image at the shipped resolution.
 *
 * The tolerance is 0.5 dB — an order of magnitude above the measured spread and
 * well below the ~3 dB per doubling the failure mode would produce, so it
 * distinguishes the two without being sensitive to speckle seed or to which
 * chords a given run happens to catch.
 */
const TOLERANCE_DB = 0.5;
const SCALES = [0.5, 1, 2];

test('the echo does not depend on the renderer\'s internal sampling', async ({ page }) => {
  // Three full renders of a ray-marched volume, each followed by a per-scanline
  // read-back. Slow under headless software GL by a wide margin.
  test.slow();

  const ratios: { scale: number; ratio: number; rim: number; core: number }[] = [];

  for (const scale of SCALES) {
    await page.goto(`/?freeze=1&pack=normal-rodero&polar=${scale}`);
    await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready', {
      timeout: 60_000,
    });

    const report = await page.evaluate(measureEchoFill, {
      packId: 'normal-rodero',
      structure: 'lv-myocardium',
    });

    // A measurement over too few chords is noise, not a reading.
    expect(report.chords, `chords at ${scale}x`).toBeGreaterThan(20);
    ratios.push({
      scale,
      ratio: report.rimVersusCore.ratio,
      rim: report.rimVersusCore.rim,
      core: report.rimVersusCore.core,
    });
  }

  const reference = ratios.find((row) => row.scale === 1)!.ratio;
  for (const row of ratios) {
    const drift = 20 * Math.log10(row.ratio / reference);
    expect(
      Math.abs(drift),
      `rim/core at ${row.scale}x is ${row.ratio.toFixed(3)} against ${reference.toFixed(3)} `
        + `at 1x — ${drift.toFixed(2)} dB. The failure this guards is the PSF's coherent `
        + 'normalisation making a specular return resolution-dependent, which would pin '
        + 'boundaryReflection to one sampling.',
    ).toBeLessThan(TOLERANCE_DB);
  }

  // And the wall really does have a brighter border than middle at every
  // sampling — an invariant ratio of 1.0 would satisfy the check above while
  // meaning the boundary term had stopped working altogether.
  for (const row of ratios) {
    expect(row.ratio, `rim/core at ${row.scale}x`).toBeGreaterThan(1.05);
  }
});
