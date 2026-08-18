import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Wave 0 visual-regression seed.
 *
 * Two layers, on purpose:
 *  1. deterministic assertions that hold on any platform (canvas present, not
 *     blank, stub pack validated) — these gate CI from the first run;
 *  2. a tolerance-based screenshot comparison, which becomes a real gate once
 *     Linux baselines are committed (see `playwright.config.ts`).
 *
 * `?freeze=1` stops the hello-world animation so frames are reproducible.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/?freeze=1');
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });
});

test('renders a non-blank WebGL canvas', async ({ page }) => {
  const canvas = page.locator('.anatomy canvas');
  await expect(canvas).toBeVisible();

  const distinctColours = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.anatomy canvas');
    if (!canvas) return 0;
    const scratch = document.createElement('canvas');
    scratch.width = 64;
    scratch.height = 64;
    const context = scratch.getContext('2d');
    if (!context) return 0;
    context.drawImage(canvas, 0, 0, 64, 64);
    const { data } = context.getImageData(0, 0, 64, 64);
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return seen.size;
  });

  // A blank or failed context yields a single flat colour.
  expect(distinctColours).toBeGreaterThan(8);
});

test('loads and validates the stub content pack', async ({ page }) => {
  // The shell now defaults to the real Rodero pack, so the stub is requested
  // explicitly. Keeping a stub-backed assertion is deliberate: it is the only
  // pack whose contents are fixed by this repository, so it is the only one
  // that can pin loader behaviour without depending on ingest output.
  await page.goto('/?freeze=1&pack=stub');
  const status = page.getByTestId('pack-status');
  await expect(status).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
  await expect(status).toContainText('Synthetic stub pack');
  await expect(status).toContainText('validated');
  await expect(page.getByTestId('pack-error')).toHaveCount(0);
});

test('renders the simulated echo over the real labelled volume', async ({ page }) => {
  const panel = page.getByTestId('echo-panel');
  await expect(panel).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });

  // The "simulated" label is a contract requirement (contracts/echo-renderer.md
  // "Honesty requirements"), not decoration. It must be on screen with the image.
  await expect(page.getByTestId('echo-simulated')).toBeVisible();
  await expect(page.getByTestId('echo-provenance')).toContainText('Draft');

  // The sector must contain real grey-level STRUCTURE. A renderer that
  // saturated to a flat white fan — which an earlier revision did — would pass
  // any "canvas is not blank" check, so this asserts a spread of mid-greys
  // rather than merely more than one colour.
  const greys = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="echo-canvas"]');
    if (!canvas) return null;
    const scratch = document.createElement('canvas');
    scratch.width = 128;
    scratch.height = 128;
    const context = scratch.getContext('2d');
    if (!context) return null;
    context.drawImage(canvas, 0, 0, 128, 128);
    const { data } = context.getImageData(0, 0, 128, 128);
    let dark = 0;
    let mid = 0;
    let bright = 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = data[i];
      if (value < 24) dark += 1;
      else if (value > 232) bright += 1;
      else mid += 1;
    }
    return { dark, mid, bright, total: data.length / 4 };
  });

  expect(greys).not.toBeNull();
  // Blood and the region outside the sector are dark; tissue is mid-grey.
  expect(greys!.dark).toBeGreaterThan(greys!.total * 0.2);
  expect(greys!.mid).toBeGreaterThan(greys!.total * 0.05);
});

test('renders the sector vertex-down, the paediatric default for family B', async ({ page }) => {
  /*
   * `docs/view_canon.md` makes vertex-DOWN the paediatric convention for the
   * subcostal and apical families — transducer mark at the BOTTOM of the image,
   * the fan opening upward — and the shipped apical four-chamber declares it.
   * The renderer honoured the flag backwards and drew the deployed view
   * vertex-up, which no assertion here could see: every check on this canvas
   * was about grey levels, and a vertically mirrored sector has exactly the
   * same ones.
   *
   * So the assertion is about SHAPE. A sector is narrow at its vertex and wide
   * at full depth, so the extent of lit pixels across the panel grows away from
   * the vertex. Measuring that near the top and near the bottom says which way
   * up the fan is, independently of what is inside it.
   */
  await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });

  const width = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="echo-canvas"]');
    if (!canvas) return null;
    const size = 128;
    const scratch = document.createElement('canvas');
    scratch.width = size;
    scratch.height = size;
    const context = scratch.getContext('2d');
    if (!context) return null;
    context.drawImage(canvas, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);

    // Horizontal extent of lit pixels on one row, in columns.
    const litSpan = (row: number) => {
      let first = -1;
      let last = -1;
      for (let column = 0; column < size; column += 1) {
        if (data[(row * size + column) * 4] > 16) {
          if (first < 0) first = column;
          last = column;
        }
      }
      return first < 0 ? 0 : last - first + 1;
    };

    // Averaged over a band, so one speckle-free row cannot decide it.
    const band = (from: number, to: number) => {
      let total = 0;
      for (let row = from; row < to; row += 1) total += litSpan(row);
      return total / (to - from);
    };

    return { top: band(4, 20), bottom: band(size - 20, size - 4) };
  });

  expect(width).not.toBeNull();
  // Vertex at the bottom: the fan is wide at the top and pinched at the bottom.
  expect(width!.top).toBeGreaterThan(width!.bottom * 1.5);
});

test('the orbit is not clamped at the poles', async ({ page }) => {
  /*
   * The model has to turn all the way over: a subcostal view is read from
   * underneath, and comparing an apex-up display against an apex-down one means
   * getting the model into both. Pitch used to be clamped to +-1.5 radians
   * because the camera's `up` was pinned to (0, 1, 0), which has no basis
   * looking straight down and inverts past it.
   *
   * A clamp is invisible to any single-frame check, so this drags in two equal
   * stages and compares. Under the clamp the second stage would move the camera
   * barely at all — it was already against the stop — and the two frames would
   * be near-identical. It also asserts the far frame is not blank, which is
   * what a degenerate `lookAt` at the pole produces.
   */
  const canvas = page.locator('.anatomy canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const snapshot = () => page.evaluate(() => {
    const element = document.querySelector<HTMLCanvasElement>('.anatomy canvas');
    if (!element) return null;
    const scratch = document.createElement('canvas');
    scratch.width = 48;
    scratch.height = 48;
    const context = scratch.getContext('2d');
    if (!context) return null;
    context.drawImage(element, 0, 0, 48, 48);
    return [...context.getImageData(0, 0, 48, 48).data];
  });

  // Radians per pixel is 0.008, so 250 px is about 2 radians. Starting from the
  // reset pose, ONE stage already carries pitch past where the old clamp stood,
  // which is what makes the second stage decisive: unclamped it keeps turning,
  // clamped it cannot move at all and the two frames are identical.
  const dragBy = async (pixels: number) => {
    const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) {
      await page.mouse.move(centre.x, centre.y + (pixels * step) / 10);
    }
    await page.mouse.up();
    // The viewer draws on demand via rAF; give it a frame to land.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  };

  await dragBy(250);
  const nearPole = await snapshot();
  await dragBy(250);
  const pastPole = await snapshot();

  expect(nearPole).not.toBeNull();
  expect(pastPole).not.toBeNull();

  const differing = nearPole!.filter((value, index) => Math.abs(value - pastPole![index]) > 8);
  expect(differing.length).toBeGreaterThan(nearPole!.length * 0.05);

  // Not a blank frame: a degenerate camera at the pole renders nothing.
  const lit = pastPole!.filter((_value, index) => index % 4 === 0 && pastPole![index] > 40);
  expect(lit.length).toBeGreaterThan(20);
});

test('"Match echo" turns the model to the echo plane, and moves nothing else', async ({ page }) => {
  /*
   * The button exists to make one relationship visible: the echo image is a
   * slice of this model, taken on this plane. So it has to turn the model to
   * face that plane — and it has to do that WITHOUT touching the wedge, the
   * selected view or any pack data. `contracts/README.md`: the free cutter and
   * the vetted wedge may coincide visually and never merge.
   *
   * Both halves are asserted here, because "camera only" is exactly the kind of
   * claim that decays quietly.
   */
  await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });

  const sample = (selector: string) => page.evaluate((query) => {
    const canvas = document.querySelector<HTMLCanvasElement>(query);
    if (!canvas) return null;
    const scratch = document.createElement('canvas');
    scratch.width = 48;
    scratch.height = 48;
    const context = scratch.getContext('2d');
    if (!context) return null;
    context.drawImage(canvas, 0, 0, 48, 48);
    return [...context.getImageData(0, 0, 48, 48).data];
  }, selector);

  const differing = (a: number[], b: number[]) =>
    a.filter((value, index) => Math.abs(value - b[index]) > 8).length;

  const anatomyBefore = await sample('.anatomy canvas');
  const echoBefore = await sample('[data-testid="echo-canvas"]');
  const scrubBefore = await page.getByTestId('echo-scrub').inputValue();
  const cutBefore = await page.getByTestId('cut-readout').textContent();

  /*
   * The transition is animated, and that is NOT asserted here — it is asserted
   * in tests/unit/orbit.test.ts, over the easing curve and the glide step.
   *
   * Two attempts to assert it from the browser both measured the machine rather
   * than the code. Headless Chromium falls back to software GL and draws this
   * scene, with a stencil cap pass per structure, at a few frames per second:
   * counting distinct frames cannot separate a 700 ms animation from a cut, and
   * polling for the in-flight flag cannot see it either, because the flag is set
   * and cleared inside a single long frame with no gap for a poll to land in.
   *
   * What this test is for is the part a unit test cannot reach: that the button
   * moves the camera and moves NOTHING else.
   */
  await page.getByTestId('match-echo').click();
  await expect(page.getByTestId('anatomy-viewer'))
    .not.toHaveAttribute('data-camera-glide', 'true', { timeout: 10_000 });

  const anatomyAfter = await sample('.anatomy canvas');
  const echoAfter = await sample('[data-testid="echo-canvas"]');

  expect(anatomyBefore).not.toBeNull();
  // The camera really moved.
  expect(differing(anatomyBefore!, anatomyAfter!)).toBeGreaterThan(anatomyBefore!.length * 0.05);

  // CAMERA ONLY: the echo image, the sweep position and the cutter are untouched.
  expect(differing(echoBefore!, echoAfter!)).toBe(0);
  expect(await page.getByTestId('echo-scrub').inputValue()).toBe(scrubBefore);
  expect(await page.getByTestId('cut-readout').textContent()).toBe(cutBefore);
});

test('a drag moves the selected target and nothing else', async ({ page }) => {
  // Three drags, each forcing several full redraws of a 24-structure scene with
  // a stencil cap pass per structure. Under headless software GL that is slow
  // enough to exceed the default budget when the suite runs at full width.
  test.slow();
  /*
   * `contracts/viewer-core.md`: "The active target is always visible and is
   * exactly one of heart/camera, free cut, or echo view. A drag must never
   * silently manipulate a different object."
   *
   * The second sentence is the one worth testing, and it is a NEGATIVE claim,
   * so it is tested by dragging with each target selected and checking what did
   * NOT move. The camera has no readout, so the model image stands in for it.
   */
  const canvas = page.locator('.anatomy canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const drag = async (pixels: number) => {
    const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    for (let step = 1; step <= 4; step += 1) {
      await page.mouse.move(centre.x + (pixels * step) / 4, centre.y + (pixels * step) / 8);
    }
    await page.mouse.up();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  };

  const anatomy = () => page.evaluate(() => {
    const element = document.querySelector<HTMLCanvasElement>('.anatomy canvas');
    const scratch = document.createElement('canvas');
    scratch.width = 40;
    scratch.height = 40;
    const context = scratch.getContext('2d');
    if (!element || !context) return null;
    context.drawImage(element, 0, 0, 40, 40);
    return [...context.getImageData(0, 0, 40, 40).data];
  });
  const changed = (a: number[], b: number[]) =>
    a.filter((value, index) => Math.abs(value - b[index]) > 8).length;

  // Heart: the model turns, the sweep does not.
  await page.getByTestId('target-camera').click();
  const beforeCamera = await anatomy();
  const scrubBefore = await page.getByTestId('echo-scrub').inputValue();
  await drag(140);
  expect(changed(beforeCamera!, (await anatomy())!)).toBeGreaterThan(beforeCamera!.length * 0.05);
  expect(await page.getByTestId('echo-scrub').inputValue()).toBe(scrubBefore);

  // Echo view: the sweep moves. Its only permitted motion, and the same value
  // the scrubber slider owns — one `t`, two controls.
  await page.getByTestId('target-echo').click();
  await drag(150);
  expect(Number(await page.getByTestId('echo-scrub').inputValue()))
    .toBeGreaterThan(Number(scrubBefore));

  // Free cut: the plane turns while its depth `s` stays exactly where it was.
  await page.getByTestId('target-cut').click();
  const depthBefore = await page.getByTestId('cut-readout').textContent();
  const beforeCut = await anatomy();
  await drag(150);
  expect(await page.getByTestId('cut-readout').textContent()).toBe(depthBefore);
  expect(changed(beforeCut!, (await anatomy())!)).toBeGreaterThan(beforeCut!.length * 0.02);
});

test('the align bridge copies one way, and the copy is retracted by free movement', async ({ page }) => {
  /*
   * `contracts/README.md`: "Align free cut to echo view copies the selected
   * echo plane into the free cutter. Subsequent free movement breaks the
   * association and never modifies the saved view."
   *
   * So: the copy lands, the association is stated in words, and moving the
   * cutter afterwards retracts the statement while the view carries on
   * unchanged.
   */
  await expect(page.getByTestId('align-state')).toContainText('not aligned');

  const viewName = await page.locator('.echo__header h2').textContent();
  await page.getByTestId('align-cut').click();
  await expect(page.getByTestId('align-state')).toContainText(viewName!.trim());

  // The vetted view is untouched by the copy: same name, same sweep position,
  // same draft flag. There is no code path that could change them, and this is
  // the assertion that says so out loud.
  await expect(page.locator('.echo__header h2')).toHaveText(viewName!);
  await expect(page.getByTestId('echo-provenance')).toContainText('Draft');

  // Move the cutter freely; the claim is retracted.
  await page.getByTestId('target-cut').click();
  const box = await page.locator('.anatomy canvas').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 90, box!.y + box!.height / 2 + 40);
  await page.mouse.up();

  await expect(page.getByTestId('align-state')).toContainText('not aligned');
  await expect(page.locator('.echo__header h2')).toHaveText(viewName!);
});

test('scrubbing the sweep changes the image', async ({ page }) => {
  await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });

  const sample = () =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="echo-canvas"]');
      const scratch = document.createElement('canvas');
      scratch.width = 48;
      scratch.height = 48;
      const context = scratch.getContext('2d')!;
      context.drawImage(canvas!, 0, 0, 48, 48);
      return [...context.getImageData(0, 0, 48, 48).data].filter((_, i) => i % 4 === 0);
    });

  const before = await sample();
  await page.getByTestId('echo-scrub').fill('1');
  await page.waitForTimeout(500);
  const after = await sample();

  // The sweep drives a real change in probe pose, so the image must move. If
  // these matched, poseAt() would be returning the same pose for every scrub
  // position and the scrubber would be decorative.
  const changed = before.reduce((count, value, i) => count + (value === after[i] ? 0 : 1), 0);
  expect(changed).toBeGreaterThan(before.length * 0.1);
});

test('the wedge and the echo move together on one scrub value', async ({ page }) => {
  // The one-to-one match is structural — both read the same ImagingFrame — but
  // it is worth an end-to-end assertion, because a regression that gave either
  // panel its own scrub state would still render two plausible pictures.
  const sample = (selector: string) =>
    page.evaluate((sel) => {
      const canvas = document.querySelector<HTMLCanvasElement>(sel);
      const scratch = document.createElement('canvas');
      scratch.width = 40;
      scratch.height = 40;
      const context = scratch.getContext('2d')!;
      context.drawImage(canvas!, 0, 0, 40, 40);
      return [...context.getImageData(0, 0, 40, 40).data].filter((_, i) => i % 4 === 0);
    }, selector);

  const changed = (before: number[], after: number[]) =>
    before.reduce((count, value, i) => count + (value === after[i] ? 0 : 1), 0) / before.length;

  await page.getByTestId('echo-scrub').fill('0');
  await page.waitForTimeout(600);
  const anatomyStart = await sample('.anatomy canvas');
  const echoStart = await sample('[data-testid="echo-canvas"]');

  await page.getByTestId('echo-scrub').fill('1');
  await page.waitForTimeout(600);
  const anatomyEnd = await sample('.anatomy canvas');
  const echoEnd = await sample('[data-testid="echo-canvas"]');

  // One scrubber moved BOTH: the wedge in the scene and the echo image.
  expect(changed(anatomyStart, anatomyEnd)).toBeGreaterThan(0.02);
  expect(changed(echoStart, echoEnd)).toBeGreaterThan(0.1);
});

/**
 * `contracts/viewer-core.md`: "Cut faces render **solid**, via stencil-buffer
 * caps. A hollow cut is a bug, not a style."
 *
 * The discriminator is exact colour. Cap quads are unlit `MeshBasicMaterial`
 * in the structure's palette colour, so an interior cap pixel lands on that
 * value exactly. Every anatomy surface is `MeshStandardMaterial` under two
 * lights and cannot produce it except by coincidence at a single shading angle.
 * If clipping opened the model but the stencil pass drew nothing — which is the
 * failure mode when the WebGL context is created without a stencil buffer —
 * the cut region shows the lit interior of the far wall and this count is zero.
 *
 * The beam highlight is switched off first: it multiplies the cap colour
 * everywhere the beam does not reach, which would defeat an exact-match test
 * for reasons that have nothing to do with whether the cap is solid.
 */
test('the cut renders solid caps, not a hollow shell', async ({ page }) => {
  await expect(page.getByTestId('cut-enabled')).toBeChecked();
  await page.getByTestId('beam-dim').uncheck();

  const exactPaletteHits = async () =>
    page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.anatomy canvas');
      if (!canvas) return 0;
      const scratch = document.createElement('canvas');
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const context = scratch.getContext('2d', { willReadFrequently: true });
      if (!context) return 0;
      context.drawImage(canvas, 0, 0);
      const { data } = context.getImageData(0, 0, scratch.width, scratch.height);
      // The four chamber-wall palette entries from PackViewer.
      const palette = [
        [0xd9, 0x4f, 0x4f], [0x4f, 0x8f, 0xd9],
        [0xe0, 0xa3, 0x3c], [0x5f, 0xb8, 0x7a],
      ];
      let hits = 0;
      for (let i = 0; i < data.length; i += 4) {
        for (const [r, g, b] of palette) {
          if (data[i] === r && data[i + 1] === g && data[i + 2] === b) {
            hits += 1;
            break;
          }
        }
      }
      return hits;
    });

  expect(await exactPaletteHits()).toBeGreaterThan(200);

  /*
   * And the caps follow the plane: pushed clear of the model, they vanish.
   *
   * The value is written through React's own value setter rather than with
   * `fill()`, which does not drive a range input. Dispatching `input` after it
   * is what React listens for, so this exercises the real state path — slider
   * to `s` to plane to cap — instead of poking the renderer behind it.
   */
  await page.getByTestId('cut-offset').evaluate((node: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(node, node.max);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.getByTestId('cut-readout')).not.toContainText('0.0 mm');
  expect(await exactPaletteHits()).toBe(0);
});

test('a rejected pack is not reachable in the production build', async ({ page }) => {
  // The visual suite runs against a real production build, so this is the only
  // check that exercises the shipped artefact. Both rejected packs are licence
  // blocked; the requirement is that their FILES are absent, not merely that
  // the shell declines to show them.
  for (const packId of ['normal-alberta-neonatal', 'normal-vhl-heart0102']) {
    const response = await page.request.get(`/packs/${packId}/pack.json`);
    expect(response.status(), `${packId} pack.json must not be served`).toBe(404);

    const asset = await page.request.get(`/packs/${packId}/assets/echo-volume.raw`);
    expect(asset.status(), `${packId} assets must not be served`).toBe(404);
  }

  // And a deep link to one fails visibly rather than rendering a blank screen.
  await page.goto('/?freeze=1&pack=normal-alberta-neonatal');
  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-status', 'error', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('pack-error')).toContainText('not published');
});

test('no console errors on load', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/?freeze=1');
  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-status', 'ok', {
    timeout: 15_000,
  });

  expect(errors).toEqual([]);
});

test('app shell screenshot', async ({ page }, testInfo) => {
  const baseline = testInfo.snapshotPath('app-shell.png');
  const seeding = !['none', 'missing'].includes(testInfo.config.updateSnapshots);
  test.skip(
    !seeding && !existsSync(baseline),
    `no committed baseline for project "${testInfo.project.name}" yet — ` +
      'seed one with `npm run test:visual:update` on the target platform (wave 1)',
  );

  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-status', 'ok', {
    timeout: 15_000,
  });
  await expect(page).toHaveScreenshot('app-shell.png', { fullPage: true });
});
