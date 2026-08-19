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
  // Two long drags, each forcing many full redraws of a 24-structure scene with
  // a stencil cap pass per structure. Under headless software GL that exceeds
  // the default budget when the suite runs several workers at once.
  test.slow();
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

/* --------------------------------------------------------------------------
   Direct manipulation: what a drag moves is what is under the pointer
   -------------------------------------------------------------------------- */

/**
 * The affordances publish their own screen positions on the viewer's host
 * element. That is a deliberate test seam: "the handles and the tilt arrow are
 * present and hittable under a coarse pointer" is a gate, and a gate that can
 * only be checked by guessing pixel coordinates is not a gate. These are the
 * same numbers the hit test uses, so dragging to them exercises the real
 * dispatch rather than a parallel one.
 */
async function handlePositions(page: import('@playwright/test').Page) {
  const raw = await page.getByTestId('anatomy-viewer').getAttribute('data-cut-handles');
  return raw === null ? [] : (JSON.parse(raw) as { id: string; x: number; y: number }[]);
}

/**
 * The positions are published on the next drawn frame, and the viewer draws on
 * demand — so a read straight after a click can land before the frame that
 * would have answered it. Polled rather than slept on: under headless software
 * GL a redraw of this scene is hundreds of milliseconds and any fixed wait is
 * either flaky or wasteful.
 */
async function waitForHandles(page: import('@playwright/test').Page) {
  await expect
    .poll(async () => (await handlePositions(page)).length, { timeout: 15_000 })
    .toBe(4);
  return handlePositions(page);
}

async function arrowPosition(page: import('@playwright/test').Page) {
  const raw = await page.getByTestId('anatomy-viewer').getAttribute('data-tilt-arrow');
  return raw === null ? null : (JSON.parse(raw) as { x: number; y: number });
}

async function panelOrigin(page: import('@playwright/test').Page) {
  const box = await page.locator('.anatomy canvas').boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function dragFrom(
  page: import('@playwright/test').Page, from: { x: number; y: number }, dx: number, dy: number,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(from.x + (dx * step) / 6, from.y + (dy * step) / 6);
  }
  await page.mouse.up();
  // The viewer draws on demand via rAF; give it a frame to land.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

/**
 * A point in the panel that is not on any affordance.
 *
 * Picked by measuring rather than assumed, because the cut rectangle is
 * deliberately larger than the model — a sheet of glass passed through the
 * heart — so its handles can sit anywhere along the panel's edges depending on
 * how the plane is turned.
 */
async function emptySpot(page: import('@playwright/test').Page) {
  const box = await panelOrigin(page);
  const handles = await handlePositions(page);
  const arrow = await arrowPosition(page);
  const avoid = [...handles, ...(arrow ? [arrow] : [])];
  const candidates = [
    { x: box.width * 0.5, y: box.height * 0.5 },
    { x: box.width * 0.12, y: box.height * 0.12 },
    { x: box.width * 0.88, y: box.height * 0.12 },
    { x: box.width * 0.12, y: box.height * 0.88 },
    { x: box.width * 0.88, y: box.height * 0.88 },
    { x: box.width * 0.5, y: box.height * 0.12 },
    { x: box.width * 0.12, y: box.height * 0.5 },
  ];
  const clearance = (point: { x: number; y: number }) =>
    avoid.reduce((least, item) => Math.min(least, Math.hypot(item.x - point.x, item.y - point.y)),
      Infinity);
  const best = candidates.reduce((a, b) => (clearance(a) >= clearance(b) ? a : b));
  expect(clearance(best), 'somewhere in the panel is not an affordance').toBeGreaterThan(45);
  return { x: box.x + best.x, y: box.y + best.y };
}

function sampleCanvas(page: import('@playwright/test').Page, selector: string) {
  return page.evaluate((query) => {
    const element = document.querySelector<HTMLCanvasElement>(query);
    const scratch = document.createElement('canvas');
    scratch.width = 40;
    scratch.height = 40;
    const context = scratch.getContext('2d');
    if (!element || !context) return null;
    context.drawImage(element, 0, 0, 40, 40);
    return [...context.getImageData(0, 0, 40, 40).data];
  }, selector);
}

const changed = (a: number[], b: number[]) =>
  a.filter((value, index) => Math.abs(value - b[index]) > 8).length;

test('a drag moves what is under the pointer, and nothing else', async ({ page }) => {
  // Several drags, each forcing full redraws of a 24-structure scene with a
  // stencil cap pass per structure. Under headless software GL that is slow
  // enough to exceed the default budget when the suite runs at full width.
  test.slow();
  /*
   * The interaction model this replaced was explicit target selection: a
   * radiogroup naming heart / cut / echo, read by the drag. It is gone. What a
   * drag moves is now decided POSITIONALLY, by what is under the pointer, and
   * the negative claim — that a drag does not silently move anything else — is
   * the part worth testing.
   */
  await expect(page.getByTestId('drag-target')).toHaveCount(0);

  // Handles exist only in Free mode: in Echo plane the cutter is not the
  // learner's to move, and the handles are neither drawn nor hittable.
  await page.getByTestId('cutter-mode-free').click();
  const handles = await waitForHandles(page);

  const box = await panelOrigin(page);
  const scrubBefore = await page.getByTestId('echo-scrub').inputValue();
  const depthBefore = await page.getByTestId('cut-readout').textContent();

  // A handle: the plane turns while its depth `s` stays exactly where it was.
  const beforeCut = await sampleCanvas(page, '.anatomy canvas');
  await dragFrom(page, { x: box.x + handles[0].x, y: box.y + handles[0].y }, 120, 60);
  expect(await page.getByTestId('cut-readout').textContent()).toBe(depthBefore);
  expect(await page.getByTestId('echo-scrub').inputValue()).toBe(scrubBefore);
  expect(changed(beforeCut!, (await sampleCanvas(page, '.anatomy canvas'))!))
    .toBeGreaterThan(beforeCut!.length * 0.02);

  // Empty panel: the camera turns, and nothing else does.
  const empty = await emptySpot(page);
  const beforeCamera = await sampleCanvas(page, '.anatomy canvas');
  const depthBeforeOrbit = await page.getByTestId('cut-readout').textContent();
  await dragFrom(page, empty, 140, 70);
  expect(changed(beforeCamera!, (await sampleCanvas(page, '.anatomy canvas'))!))
    .toBeGreaterThan(beforeCamera!.length * 0.05);
  expect(await page.getByTestId('cut-readout').textContent()).toBe(depthBeforeOrbit);
  expect(await page.getByTestId('echo-scrub').inputValue()).toBe(scrubBefore);
});

test('the tilt arrow scrubs the sweep, and writes nothing else', async ({ page }) => {
  test.slow();
  /*
   * The arrow replaced the "Echo view" drag target. It is an INPUT, not a new
   * owner of the sweep: it writes `t` through the same path the slider writes
   * through, so the wedge and the echo image still advance from one clock, and
   * the pose it produces is `frameAt(probe, sweep, t)` by construction — pinned
   * as arithmetic in tests/unit/tiltArrow.test.ts.
   *
   * What this adds is the end-to-end half: the drag really reaches the sweep,
   * and the vetted view is identical before and after.
   */
  await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });

  const arrow = await arrowPosition(page);
  expect(arrow, 'the default view has a sweep, so it has an arrow').not.toBeNull();

  const box = await panelOrigin(page);
  const viewName = await page.locator('.echo__header h2').textContent();
  const scrubBefore = Number(await page.getByTestId('echo-scrub').inputValue());
  const depthBefore = await page.getByTestId('cut-readout').textContent();

  // A drag long enough to move `t` well clear of where it started, in both
  // directions, so the test cannot pass on the tangent's sign by luck.
  await dragFrom(page, { x: box.x + arrow!.x, y: box.y + arrow!.y }, 200, 0);
  const after = Number(await page.getByTestId('echo-scrub').inputValue());
  await dragFrom(page, { x: box.x + arrow!.x, y: box.y + arrow!.y }, -200, 0);
  const back = Number(await page.getByTestId('echo-scrub').inputValue());
  expect(Math.abs(after - scrubBefore) + Math.abs(back - after)).toBeGreaterThan(0.05);

  // `t` is hard-clamped: no wrap, no rubber band, at either end.
  for (const pixels of [3000, -3000]) {
    await dragFrom(page, { x: box.x + arrow!.x, y: box.y + arrow!.y }, pixels, 0);
    const t = Number(await page.getByTestId('echo-scrub').inputValue());
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(1);
  }

  // The vetted view is untouched: same name, same draft flag, and the cutter
  // did not move either. Nothing a learner can do writes to `views[]`.
  await expect(page.locator('.echo__header h2')).toHaveText(viewName!);
  await expect(page.getByTestId('echo-provenance')).toContainText('Draft');
  expect(await page.getByTestId('cut-readout').textContent()).toBe(depthBefore);
});

test('the echo-synced cutter follows the sweep, and the view is identical after', async ({ page }) => {
  test.slow();
  /*
   * The one-shot "Align cut to echo view" bridge is gone; the cutter has a
   * named MODE instead. `contracts/README.md` still holds: data flows
   * probe -> cutter and never the reverse, so the whole point of this test is
   * the negative half — the view's name, its sweep value and its draft flag are
   * identical before and after every kind of cutter interaction there now is.
   */
  await expect(page.getByTestId('cutter-mode-echo')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('cutter-mode-state')).toContainText('imaging plane');
  // Echo-synced: the plane is not the learner's, so there is nothing to grab.
  expect(await handlePositions(page)).toHaveLength(0);

  const viewName = await page.locator('.echo__header h2').textContent();
  const sweepBefore = await page.getByTestId('echo-scrub').inputValue();

  // Following, not aligned once: scrubbing moves the cut plane with the sweep.
  const beforeScrub = await sampleCanvas(page, '.anatomy canvas');
  await page.getByTestId('echo-scrub').fill('0.05');
  await page.waitForTimeout(500);
  expect(changed(beforeScrub!, (await sampleCanvas(page, '.anatomy canvas'))!))
    .toBeGreaterThan(beforeScrub!.length * 0.02);
  await page.getByTestId('echo-scrub').fill(sweepBefore);
  await page.waitForTimeout(500);

  /*
   * In this mode the cut IS the imaging plane, so there is no depth to choose
   * and the slider is disabled — DISABLED rather than removed, so the control
   * the learner will look for is where they left it and its state says why it
   * does nothing. The readout names the plane instead of a number.
   */
  await expect(page.getByTestId('cut-offset')).toBeDisabled();
  await expect(page.getByTestId('cut-readout')).toContainText('on echo plane');

  // The Cut checkbox stays live in both modes: turning the cut off to see the
  // whole heart WITH the fan on it is a thing worth being able to do.
  await expect(page.getByTestId('cut-enabled')).toBeEnabled();

  /*
   * Switching to Free ADOPTS the current plane rather than jumping to some
   * other one, so the cut through the anatomy is unchanged; what appears is the
   * rectangle and its handles, because the plane is now a separate object the
   * learner can take hold of. In Echo plane the rectangle is not drawn at all —
   * the wedge already shows where that plane is, and a second outline on it
   * would say there are two objects there.
   */
  await page.getByTestId('cutter-mode-free').click();
  expect(await waitForHandles(page)).toHaveLength(4);
  await expect(page.getByTestId('cutter-mode-state')).toContainText('Free cut');
  await expect(page.getByTestId('cut-offset')).toBeEnabled();
  await expect(page.getByTestId('cut-readout')).not.toContainText('on echo plane');

  // The echo panel does NOT blank in Free mode. The mode name carries the
  // distinction; blanking on every stray drag would be hostile now that the
  // plane is directly draggable.
  await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('echo-canvas')).toBeVisible();

  // And through all of it, the vetted view is untouched.
  await expect(page.locator('.echo__header h2')).toHaveText(viewName!);
  await expect(page.getByTestId('echo-scrub')).toHaveValue(sweepBefore);
  await expect(page.getByTestId('echo-provenance')).toContainText('Draft');
});

test('the affordances are present and hittable under a coarse pointer', async ({ page }, testInfo) => {
  test.slow();
  /*
   * The gate. A coarse pointer has no hover, so a proximity-revealed handle is
   * simply an invisible control: the first contact a finger makes with the
   * screen is already the press. Both pointer classes are asserted here — the
   * suite runs a desktop project and a phone project — because the interesting
   * failure is the two diverging.
   */
  const expected = testInfo.project.name === 'phone-portrait' ? 'coarse' : 'fine';
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-pointer-class', expected);

  await page.getByTestId('cutter-mode-free').click();
  const handles = await waitForHandles(page);
  expect(handles).toHaveLength(4);
  expect(await arrowPosition(page)).not.toBeNull();

  // Hittable, not merely published: a drag that starts on one really turns the
  // plane, and really does not move its depth.
  const box = await panelOrigin(page);
  const depthBefore = await page.getByTestId('cut-readout').textContent();
  const before = await sampleCanvas(page, '.anatomy canvas');
  await dragFrom(page, { x: box.x + handles[0].x, y: box.y + handles[0].y }, 110, 55);
  expect(changed(before!, (await sampleCanvas(page, '.anatomy canvas'))!))
    .toBeGreaterThan(before!.length * 0.02);
  expect(await page.getByTestId('cut-readout').textContent()).toBe(depthBefore);
});

test('the wheel zooms without a modifier, in every mode', async ({ page }) => {
  test.slow();
  /*
   * "A wheel that sometimes does something else is a bug, not a mode." So this
   * checks the wheel in both cutter modes and in both top-level modes, rather
   * than once in the default configuration where a regression would hide.
   */
  const box = await panelOrigin(page);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const wheelChangesTheView = async (label: string) => {
    const before = await sampleCanvas(page, '.anatomy canvas');
    const depth = await page.getByTestId('cut-readout').textContent();
    await page.mouse.move(centre.x, centre.y);
    // Several notches: one step is deliberately small, because a wheel that
    // crosses the whole useful range of distances in three notches cannot be
    // used to look at something slightly closer.
    for (let notch = 0; notch < 6; notch += 1) await page.mouse.wheel(0, -120);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(changed(before!, (await sampleCanvas(page, '.anatomy canvas'))!), label)
      .toBeGreaterThan(before!.length * 0.02);
    // Zoom, not depth: the modifier-free wheel must never move the cutter.
    expect(await page.getByTestId('cut-readout').textContent(), label).toBe(depth);
  };

  await wheelChangesTheView('echo mode, cutter synced');
  await page.getByTestId('cutter-mode-free').click();
  await wheelChangesTheView('echo mode, cutter free');

  await page.getByTestId('mode-explore').click();
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-viewer-mode', 'explore');
  await wheelChangesTheView('explore mode');
});

test('unlocking the probe withdraws the view\'s claim, and locking restores it', async ({ page }) => {
  test.slow();
  /*
   * The probe is normally pinned to its view: every reachable pose is
   * `frameAt(probe, sweep, t)`, and that constraint is what lets the echo panel
   * put a view's name on an image. Unlocking it is an explicit owner decision
   * (2026-08-19), and it is paid for by LABELLING rather than by hiding.
   *
   * So the assertions here are about the label keeping step with the truth:
   * the name and the draft flag survive the toggle alone, go the moment the
   * probe is actually moved, and come back exactly when it is locked again.
   */
  await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });
  const viewName = await page.getByTestId('echo-view-name').textContent();
  const scrubBefore = await page.getByTestId('echo-scrub').inputValue();

  // Unlocking alone changes nothing: the pose is still the view's pose, so the
  // view's name is still true and must not be retracted.
  await page.getByTestId('probe-free').check();
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-probe-lock', 'free');
  await expect(page.getByTestId('echo-view-name')).toHaveText(viewName!);
  await expect(page.getByTestId('echo-provenance')).toContainText('Draft');
  // The sweep no longer drives the probe, and says so rather than lying.
  await expect(page.getByTestId('echo-scrub')).toBeDisabled();
  // And the tilt arrow is gone: it would misdescribe what a drag now does.
  await expect(page.getByTestId('anatomy-viewer')).not.toHaveAttribute('data-tilt-arrow', /.*/);

  // Moving it retracts the claim.
  const raw = await page.getByTestId('anatomy-viewer').getAttribute('data-probe');
  expect(raw, 'the probe publishes a grab point while unlocked').not.toBeNull();
  const probe = JSON.parse(raw!) as { x: number; y: number };
  const box = await panelOrigin(page);
  const echoBefore = await sampleCanvas(page, '[data-testid="echo-canvas"]');
  await dragFrom(page, { x: box.x + probe.x, y: box.y + probe.y }, 70, 30);

  await expect(page.getByTestId('echo-view-name')).toContainText('not a saved view');
  await expect(page.getByTestId('echo-provenance')).toContainText('Unvetted plane');
  // The image really did move: an unvetted plane that rendered the vetted one
  // would be the worst of both.
  await page.waitForTimeout(600);
  expect(changed(echoBefore!, (await sampleCanvas(page, '[data-testid="echo-canvas"]'))!))
    .toBeGreaterThan(echoBefore!.length * 0.05);

  // Locking again discards the free pose rather than merging it, so the view
  // comes back exactly — same name, same draft flag, same sweep position.
  await page.getByTestId('probe-free').uncheck();
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-probe-lock', 'onTrack');
  await expect(page.getByTestId('echo-view-name')).toHaveText(viewName!);
  await expect(page.getByTestId('echo-provenance')).toContainText('Draft');
  await expect(page.getByTestId('echo-scrub')).toBeEnabled();
  expect(await page.getByTestId('echo-scrub').inputValue()).toBe(scrubBefore);
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-tilt-arrow', /.*/);
});

/* --------------------------------------------------------------------------
   Explore: the app is a heart-model explorer as well as an echo trainer
   -------------------------------------------------------------------------- */

test('Explore drops the probe entirely, and keeps the notice', async ({ page }) => {
  await page.goto('/?freeze=1&mode=explore');
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });

  // Everything that belongs to the probe is absent, not merely hidden.
  await expect(page.getByTestId('echo-panel')).toHaveCount(0);
  await expect(page.getByTestId('match-echo')).toHaveCount(0);
  await expect(page.getByTestId('beam-dim')).toHaveCount(0);
  await expect(page.getByTestId('probe-free')).toHaveCount(0);
  await expect(page.getByTestId('anatomy-viewer')).not.toHaveAttribute('data-tilt-arrow', /.*/);

  // There is no probe to sync to, so the cutter is forced free — and says so.
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-cutter-mode', 'free');
  await expect(page.getByTestId('cutter-mode-state')).toContainText('Explore');
  await expect(page.getByTestId('cutter-mode-echo')).toHaveCount(0);

  // The non-diagnostic notice is NOT behind a mode. `contracts/app-shell.md`
  // rule 4: simulated labelling and the notice are always present.
  await expect(page.locator('.shell__footer')).toContainText('not for diagnostic use');

  // The cutter still works here — this is the mode for inspecting the model.
  await page.getByTestId('cut-enabled').check();
  expect(await waitForHandles(page)).toHaveLength(4);
});

test('Echo is the default on a cold link, and the mode round-trips through the URL', async ({ page }) => {
  /*
   * `contracts/app-shell.md`: a link encodes what is on screen. Explore is a
   * first-class mode, so an Explore link has to be shareable — and the default
   * with no param has to stay Echo, so the open-link-to-an-oriented-view path
   * is unchanged for someone arriving cold.
   */
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-viewer-mode', 'echo');
  await expect(page.getByTestId('echo-panel')).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get('mode')).toBeNull();

  await page.getByTestId('mode-explore').click();
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-viewer-mode', 'explore');
  expect(new URL(page.url()).searchParams.get('mode')).toBe('explore');

  await page.getByTestId('mode-echo').click();
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-viewer-mode', 'echo');
  expect(new URL(page.url()).searchParams.get('mode')).toBeNull();
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
  // The depth slider is only live in Free mode; in Echo plane the cut IS the
  // imaging plane and there is no depth to choose.
  await page.getByTestId('cutter-mode-free').click();

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
