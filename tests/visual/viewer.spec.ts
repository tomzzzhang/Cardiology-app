import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { UNPUBLISHED_PACKS, cataloguedPacks } from '../../src/packs/published.ts';

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
  await page.goto('?freeze=1');
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });
});

/**
 * The structure count, read only once it is actually a count.
 *
 * `Number(await getAttribute(...))` on an attribute that is not set yet returns
 * `Number(null)` — which is `0`, not `NaN`. Every assertion built on it then
 * waits for `data-drawn-structures` to become `"0"`, which it never does, and
 * the test fails on a timeout that looks like a rendering bug and is really a
 * read that happened one frame too early. `a drag orbits and does not isolate
 * anything` failed exactly once this way under parallel workers and passed in
 * isolation and on a clean re-run, so the mechanism was never captured; this
 * removes the dependency rather than claiming the diagnosis.
 *
 * Waiting on the attribute matching a positive integer is what makes it safe:
 * the wait cannot succeed on an unset attribute, so the value that comes back
 * is always a real one.
 */
async function structureCount(page: Page): Promise<number> {
  const viewer = page.getByTestId('anatomy-viewer');
  await expect(viewer).toHaveAttribute('data-structure-count', /^[1-9][0-9]*$/);
  return Number(await viewer.getAttribute('data-structure-count'));
}

/**
 * Enter Explore and wait until the viewer says it is actually there.
 *
 * Clicking the control and waiting for the panel proves React re-rendered. It
 * does not prove the SCENE has switched, and the tests below then drag on that
 * scene and count what it drew.
 */
async function enterExplore(page: Page): Promise<void> {
  await page.getByTestId('mode-explore').click();
  await expect(page.getByTestId('structure-panel')).toBeVisible();
  await expect(page.getByTestId('anatomy-viewer'))
    .toHaveAttribute('data-viewer-mode', 'explore');
}

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
  await page.goto('?freeze=1&pack=stub');
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
  // The standing safeguard: simulated echo is labelled simulated. The red
  // banner over the image is gone (owner, 2026-08-19 — the flags are being
  // reworked as a set); the statement is in the provenance line and the panel
  // header, and it still has to be on screen.
  await expect(page.getByTestId('echo-simulated')).toBeVisible();
  await expect(page.getByTestId('echo-panel-note')).toHaveText('Simulated');
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

test('calibrates the echo with one-centimetre depth dots on the screen-right fan edge', async ({ page }) => {
  await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });

  const scale = page.getByTestId('echo-depth-markers');
  await expect(scale).toBeVisible();
  await expect(scale).toHaveAttribute('data-interval-mm', '10');
  await expect(page.getByTestId('echo-canvas')).toHaveAttribute(
    'aria-label',
    /Depth scale: one dot per centimetre; full depth [\d.]+ centimetres\./,
  );

  const result = await scale.evaluate((element) => {
    const stage = element.parentElement?.getBoundingClientRect();
    const depthMm = Number(element.getAttribute('data-depth-mm'));
    const markers = [...element.querySelectorAll<HTMLElement>('.echo__depth-marker')].map(
      (marker) => {
        const rect = marker.getBoundingClientRect();
        return {
          depthMm: Number(marker.dataset.depthMm),
          left: Number.parseFloat(marker.style.left),
          top: Number.parseFloat(marker.style.top),
          box: {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
          background: getComputedStyle(marker).backgroundColor,
        };
      },
    );
    return {
      depthMm,
      markerCount: Number(element.getAttribute('data-marker-count')),
      stage: stage && {
        left: stage.left,
        right: stage.right,
        top: stage.top,
        bottom: stage.bottom,
      },
      markers,
    };
  });

  // Integer centimetres strictly inside the live depth: never the vertex, and
  // never a half-clipped dot on an exact distal boundary.
  let expectedCount = 0;
  for (let depthMm = 10; depthMm < result.depthMm - 1e-9; depthMm += 10) {
    expectedCount += 1;
  }
  expect(result.markerCount).toBe(expectedCount);
  expect(result.markers).toHaveLength(expectedCount);
  expect(result.markers.map((marker) => marker.depthMm)).toEqual(
    result.markers.map((_marker, index) => (index + 1) * 10),
  );

  // Assert rendered CSS geometry, not merely inline coordinates. Every dot is
  // an actual visible 3 px square and its whole box stays inside the stage.
  expect(result.stage).not.toBeNull();
  for (const marker of result.markers) {
    expect(marker.box.width).toBeCloseTo(3, 3);
    expect(marker.box.height).toBeCloseTo(3, 3);
    expect(marker.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(marker.box.left).toBeGreaterThanOrEqual(result.stage!.left - 0.01);
    expect(marker.box.right).toBeLessThanOrEqual(result.stage!.right + 0.01);
    expect(marker.box.top).toBeGreaterThanOrEqual(result.stage!.top - 0.01);
    expect(marker.box.bottom).toBeLessThanOrEqual(result.stage!.bottom + 0.01);
  }

  // The default B1 presentation is vertex-down. A radial screen-right ruler
  // therefore travels up and out along the fan edge as depth increases.
  for (let index = 1; index < result.markers.length; index += 1) {
    expect(result.markers[index].left).toBeGreaterThan(result.markers[index - 1].left);
    expect(result.markers[index].top).toBeLessThan(result.markers[index - 1].top);
  }
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
   * the saved wedge may coincide visually and never merge.
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
 * element. That is a deliberate test seam: hit testing against guessed pixel
 * coordinates would be a parallel implementation. These are the same numbers
 * the real dispatch uses. The desktop suite is active; the retained phone
 * project exercises the coarse branch only when run manually.
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
 * A point in the panel that is not on a cut handle.
 *
 * Picked by measuring rather than assumed, because the cut rectangle is
 * deliberately larger than the model — a sheet of glass passed through the
 * heart — so its handles can sit anywhere along the panel's edges depending on
 * how the plane is turned. The probe control pad is excluded by construction:
 * the candidates below stay clear of the bottom-right corner it occupies.
 */
async function emptySpot(page: import('@playwright/test').Page) {
  const box = await panelOrigin(page);
  const avoid = await handlePositions(page);
  const candidates = [
    { x: box.width * 0.5, y: box.height * 0.5 },
    { x: box.width * 0.12, y: box.height * 0.12 },
    { x: box.width * 0.88, y: box.height * 0.12 },
    { x: box.width * 0.12, y: box.height * 0.88 },
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

test('the probe control pad steps the sweep, and writes nothing else', async ({ page }) => {
  test.slow();
  /*
   * The pad replaced a drag affordance — an arrow under the probe that scrubbed
   * the sweep — and the replacement is not cosmetic. Positioning a transducer
   * is not a drag: the probe turns about three of its OWN axes, a drag has two
   * degrees of freedom and no way to say which it meant, and even the one
   * motion a drag can express unambiguously is better served by a button that
   * steps a known amount than by a gesture whose gain depends on where the
   * camera happens to be.
   *
   * Locked, the pad's fan buttons write `t` and nothing else, through the same
   * path the slider writes through — pinned as arithmetic in
   * tests/unit/probeControl.test.ts. What this adds is the end-to-end half.
   */
  await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('anatomy-viewer')).not.toHaveAttribute('data-tilt-arrow', /.*/);

  // Locked, only the fan pair exists: there is no on-track meaning for aiming
  // within the plane or rolling the probe, so offering them would be offering
  // controls that cannot do anything.
  await expect(page.getByTestId('probe-pad')).toHaveAttribute('data-probe-pad', 'sweep');
  for (const control of [
    'probe-aim-left', 'probe-roll-cw', 'probe-closer', 'probe-recentre',
  ]) {
    await expect(page.getByTestId(control)).toHaveCount(0);
  }

  const viewName = await page.getByTestId('echo-view-name').textContent();
  const depthBefore = await page.getByTestId('cut-readout').textContent();
  const start = Number(await page.getByTestId('echo-scrub').inputValue());

  await page.getByTestId('probe-fan-up').click();
  const forward = Number(await page.getByTestId('echo-scrub').inputValue());
  expect(forward).toBeGreaterThan(start);

  // The opposite button returns it exactly. A stepped control that does not
  // reverse walks the probe every time a learner overshoots and corrects.
  await page.getByTestId('probe-fan-down').click();
  expect(Number(await page.getByTestId('echo-scrub').inputValue())).toBeCloseTo(start, 6);

  // `t` is hard-clamped: no wrap at either end, however many presses land.
  for (const control of ['probe-fan-up', 'probe-fan-down']) {
    for (let press = 0; press < 30; press += 1) await page.getByTestId(control).click();
    const t = Number(await page.getByTestId('echo-scrub').inputValue());
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(1);
  }

  // The saved view is untouched: same name, same draft flag, and the cutter
  // did not move either. Nothing a learner can do writes to `views[]`.
  await expect(page.getByTestId('echo-view-name')).toHaveText(viewName!);
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
   * In this mode the cut IS the imaging plane, so there is no depth to choose:
   * the readout names the plane instead of a number, and the depth arrow that
   * would move it is not drawn, because the plane is not the learner's here.
   */
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
  await expect(page.getByTestId('cut-readout')).not.toContainText('on echo plane');

  // The echo panel does NOT blank in Free mode. The mode name carries the
  // distinction; blanking on every stray drag would be hostile now that the
  // plane is directly draggable.
  await expect(page.getByTestId('echo-panel')).toHaveAttribute('data-status', 'ready');
  await expect(page.getByTestId('echo-canvas')).toBeVisible();

  // And through all of it, the saved view is untouched.
  await expect(page.locator('.echo__header h2')).toHaveText(viewName!);
  await expect(page.getByTestId('echo-scrub')).toHaveValue(sweepBefore);
  await expect(page.getByTestId('echo-provenance')).toContainText('Draft');
});

test('the affordances are present and hittable for the active pointer class', async ({ page }, testInfo) => {
  test.slow();
  /*
   * Normal CI and release runs select the desktop project. The coarse branch is
   * retained for the explicit manual phone harness and is not a current gate.
   */
  const expected = testInfo.project.name === 'phone-portrait' ? 'coarse' : 'fine';
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-pointer-class', expected);

  await page.getByTestId('cutter-mode-free').click();
  const handles = await waitForHandles(page);
  expect(handles).toHaveLength(4);

  // The probe control pad is buttons, so it is hittable by construction — but
  // it has to be BIG ENOUGH, and that is a rule the CSS carries rather than the
  // code. The manual phone harness still records its larger prototype cell.
  const cell = await page.getByTestId('probe-fan-up').boundingBox();
  expect(cell).not.toBeNull();
  const minimum = testInfo.project.name === 'phone-portrait' ? 30 : 22;
  expect(Math.min(cell!.width, cell!.height)).toBeGreaterThanOrEqual(minimum);

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

  // The pad grows the four controls that only mean something off the track.
  await expect(page.getByTestId('probe-pad')).toHaveAttribute('data-probe-pad', 'free');
  for (const control of [
    'probe-aim-left', 'probe-aim-right', 'probe-roll-cw', 'probe-roll-ccw',
    'probe-closer', 'probe-further', 'probe-recentre',
  ]) {
    await expect(page.getByTestId(control)).toBeVisible();
  }

  // Moving it retracts the claim — and each of the three axes does, since each
  // one is a real motion off the saved track.
  const echoBefore = await sampleCanvas(page, '[data-testid="echo-canvas"]');
  for (const control of ['probe-roll-cw', 'probe-aim-left', 'probe-fan-up', 'probe-closer']) {
    await page.getByTestId(control).click();
  }

  await expect(page.getByTestId('echo-view-name')).toContainText('not a saved view');
  await expect(page.getByTestId('echo-provenance')).toContainText('Unvetted plane');
  // The image really did move: a free plane that rendered the saved one
  // would be the worst of both.
  await page.waitForTimeout(600);
  expect(changed(echoBefore!, (await sampleCanvas(page, '[data-testid="echo-canvas"]'))!))
    .toBeGreaterThan(echoBefore!.length * 0.05);

  /*
   * Recentre: back onto the saved track WITHOUT locking. A learner who has
   * turned the probe somewhere unrecognisable should not have to toggle off and
   * on to find their way back, and the way back has to restore the claim too —
   * the pose really is the view's again.
   */
  await page.getByTestId('probe-recentre').click();
  await expect(page.getByTestId('echo-view-name')).toHaveText(viewName!);
  await expect(page.getByTestId('echo-provenance')).toContainText('Draft');
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-probe-lock', 'free');
  await expect(page.getByTestId('probe-free')).toBeChecked();

  // Locking discards the free pose rather than merging it, so the view comes
  // back exactly — same name, same draft flag, same sweep position.
  await page.getByTestId('probe-aim-right').click();
  await page.getByTestId('probe-free').uncheck();
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-probe-lock', 'onTrack');
  await expect(page.getByTestId('echo-view-name')).toHaveText(viewName!);
  await expect(page.getByTestId('echo-provenance')).toContainText('Draft');
  await expect(page.getByTestId('echo-scrub')).toBeEnabled();
  expect(await page.getByTestId('echo-scrub').inputValue()).toBe(scrubBefore);
  await expect(page.getByTestId('probe-aim-left')).toHaveCount(0);
});

/* --------------------------------------------------------------------------
   Explore: the app is a heart-model explorer as well as an echo trainer
   -------------------------------------------------------------------------- */

test('Explore drops the probe entirely, and keeps the notice', async ({ page }) => {
  // Switch modes rather than reloading: `beforeEach` has already loaded the
  // pack, and a second full load of a WebGL scene per test is what pushed this
  // file past the 30 s timeout under parallel workers.
  await enterExplore(page);

  // Everything that belongs to the probe is absent, not merely hidden.
  await expect(page.getByTestId('echo-panel')).toHaveCount(0);
  await expect(page.getByTestId('match-echo')).toHaveCount(0);
  await expect(page.getByTestId('beam-dim')).toHaveCount(0);
  await expect(page.getByTestId('probe-free')).toHaveCount(0);
  await expect(page.getByTestId('probe-pad')).toHaveCount(0);

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
  // Forty wheel events, each forcing a full redraw with a stencil cap pass per
  // structure. Slow under headless software GL when the suite runs in parallel.
  test.slow();
  await expect(page.getByTestId('cut-enabled')).toBeChecked();
  /*
   * Both overlays off first. The beam dim multiplies the cap colour everywhere
   * the beam does not reach, and the ghost lays the removed half back over the
   * cut at 7% — either would defeat an exact-match test for reasons that have
   * nothing to do with whether the cap is solid.
   */
  await page.getByTestId('beam-dim').uncheck();
  await page.getByTestId('ghost-cutaway').uncheck();
  /*
   * Depth is only the learner's in Free mode; in Echo plane the cut IS the
   * imaging plane and there is no depth to choose.
   *
   * Awaited rather than assumed: switching modes ADOPTS the current plane, which
   * writes the depth value, and a write of our own that lands before React
   * flushes that would simply be overwritten.
   */
  await page.getByTestId('cutter-mode-free').click();
  await expect(page.getByTestId('cut-readout')).not.toContainText('on echo plane');

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
   * Driven by the DEPTH ARROW rather than by a slider, because the slider is
   * gone — the arrow in the scene replaced it. Shift-wheel writes the same `s`
   * and is what this uses, since it reaches the value without having to find
   * the arrow's projected position first.
   */
  const box = await panelOrigin(page);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  for (let notch = 0; notch < 40; notch += 1) {
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Shift');
  }

  await expect(page.getByTestId('cut-readout')).not.toContainText('0.0 mm');
  /*
   * Polled, not sampled once. Forty wheel events each schedule a redraw of a
   * 24-structure scene with a stencil pass per structure, and under headless
   * software GL with the whole suite running in parallel the last of those
   * redraws can land well after the last event was dispatched. A single read
   * catches a half-moved plane and fails on a picture that is on its way to
   * being right.
   */
  await expect.poll(exactPaletteHits, { timeout: 15_000 }).toBe(0);
});

test('no unpublished pack is reachable in the production build', async ({ page }) => {
  // The visual suite runs against a real production build, so this is the only
  // check that exercises the shipped artefact. The requirement is that these
  // packs' FILES are absent, not merely that the shell declines to show them —
  // the repository is public and the deployed site is public, and those are two
  // separate promises.
  //
  // The list comes from `published.ts` rather than being spelled out here, so a
  // pack added to the shelf is covered by this test the moment it is added.
  for (const packId of Object.keys(UNPUBLISHED_PACKS)) {
    const response = await page.request.get(`packs/${packId}/pack.json`);
    expect(response.status(), `${packId} pack.json must not be served`).toBe(404);

    const directory = await page.request.get(`packs/${packId}/assets/model.gltf`);
    expect(directory.status(), `${packId} assets must not be served`).toBe(404);
  }

  // And a deep link to one fails visibly rather than rendering a blank screen.
  await page.goto('?freeze=1&pack=normal-alberta-neonatal');
  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-status', 'error', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('pack-error')).toContainText('not published');
});

test('the picker offers exactly what the build ships', async ({ page }) => {
  /*
   * The picker is the one place a learner sees what models exist, so on the
   * deployed site it must not advertise a pack the build pruned — that would be
   * a chip that 404s — nor an engine fixture, which is published on purpose and
   * is two nested boxes. Development's active catalogue is unit-tested
   * separately, because this suite only ever sees the production artefact.
   */
  const offered = cataloguedPacks(true);
  const picker = page.getByTestId('pack-picker');
  await expect(picker).toBeVisible();

  if (offered.length < 2) {
    /*
     * One real pack ships today, so there is nothing to pick, and the control
     * degrades to a LABEL rather than to an empty droplist or to nothing at
     * all: a learner still has to be able to see which model they are looking
     * at. Asserted rather than skipped, and it flips to the branch below the
     * moment a second pack is published.
     */
    await expect(picker).toHaveAttribute('data-picker', 'single');
    await expect(page.getByTestId('pack-select')).toHaveCount(0);
    await expect(page.getByTestId('pack-only')).toHaveText(offered[0].displayName);
  } else {
    await expect(picker).toHaveAttribute('data-picker', 'list');
    const select = page.getByTestId('pack-select');
    await expect(select).toBeVisible();
    // COLLAPSED HEIGHT IS ONE ROW, whatever the catalogue holds. That is the
    // whole reason this stopped being a wall of chips.
    expect((await select.boundingBox())!.height).toBeLessThan(64);
    for (const entry of offered) {
      await expect(select.locator(`option[value="${entry.id}"]`)).toHaveCount(1);
    }
    expect(await select.locator('option').count()).toBe(offered.length);
    // Nothing on the deployed site is unpublished, so nothing may say it is.
    await expect(picker.locator('.picker__tag--unpublished')).toHaveCount(0);
  }

  // The licence state of whatever is showing is stated, always. A pack with no
  // licence state is the failure check:provenance exists to prevent, shown to a
  // learner.
  await expect(picker.locator('.picker__tag')).not.toHaveCount(0);

  /*
   * THE FIXTURE IS NEVER OFFERED. It is published on purpose — the visual suite
   * runs against the production artefact and needs one pack whose contents this
   * repository fixes — and it is two nested boxes, which is not something to
   * offer a learner beside a heart. Nor is anything the build pruned, which
   * would be an option that 404s.
   */
  for (const packId of [...Object.keys(UNPUBLISHED_PACKS), 'stub']) {
    await expect(page.getByTestId(`pack-option-${packId}`)).toHaveCount(0);
    await expect(page.locator(`[data-testid=pack-picker] option[value="${packId}"]`))
      .toHaveCount(0);
    await expect(page.getByTestId(`pack-only`).filter({ hasText: packId })).toHaveCount(0);
  }

  /*
   * Hidden from the picker is NOT removed from the build. The stub stays
   * published and reachable by `?pack=`, which is how this suite and anyone
   * debugging the loader get to it.
   */
  expect((await page.request.get('packs/stub/pack.json')).status()).toBe(200);
  await page.goto('?freeze=1&pack=stub');
  await expect(page.getByTestId('pack-status')).toContainText('Synthetic stub pack', {
    timeout: 15_000,
  });
  // And the picker still does not offer it, even while it is what is on screen.
  await expect(page.getByTestId('pack-option-stub')).toHaveCount(0);
});

test('no console errors on load', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('?freeze=1');
  await expect(page.getByTestId('pack-status')).toHaveAttribute('data-status', 'ok', {
    timeout: 15_000,
  });

  expect(errors).toEqual([]);
});

/*
 * PER-STRUCTURE VISIBILITY, driven end to end.
 *
 * `data-drawn-structures` is the SCENE's own count of what is on the model,
 * published for exactly this: reading pixels back out of a WebGL canvas
 * measures the readback as much as it measures the scene, and "isolating a
 * structure takes the others off the model" is a claim about the scene.
 */
test('isolate shows one structure, and empty space brings the rest back', async ({ page }) => {
  // Switch modes rather than reloading: `beforeEach` has already loaded the
  // pack, and a second full load of a WebGL scene per test is what pushed this
  // file past the 30 s timeout under parallel workers.
  await enterExplore(page);

  const viewer = page.getByTestId('anatomy-viewer');
  const total = await structureCount(page);
  expect(total).toBeGreaterThan(1);
  await expect(viewer).toHaveAttribute('data-drawn-structures', String(total));

  // From the list.
  await page.getByTestId('structure-isolate-lv-myocardium').click();
  await expect(viewer).toHaveAttribute('data-drawn-structures', '1');
  await expect(page.getByTestId('structure-isolated')).toContainText('Left ventricular myocardium');

  // Isolating the same thing again is the way back — one click, from anywhere.
  await page.getByTestId('structure-isolate-lv-myocardium').click();
  await expect(viewer).toHaveAttribute('data-drawn-structures', String(total));
  await expect(page.getByTestId('structure-isolated')).toHaveCount(0);
});

test('a click on the model isolates, and a click on empty space shows all', async ({ page }) => {
  // Switch modes rather than reloading: `beforeEach` has already loaded the
  // pack, and a second full load of a WebGL scene per test is what pushed this
  // file past the 30 s timeout under parallel workers.
  await enterExplore(page);

  const viewer = page.getByTestId('anatomy-viewer');
  const total = await structureCount(page);
  const canvas = page.locator('.anatomy canvas');
  const box = (await canvas.boundingBox())!;

  /*
   * Find a point that is actually ON the model rather than assuming the middle
   * of the panel is: the camera frames the model's BOUNDS, and this substrate
   * has a gap between the great vessels exactly there.
   *
   * Probed by CLICKING rather than by hovering, because a coarse pointer has no
   * hover and the phone project is exactly where that matters. A click that
   * lands on empty space shows everything, which is the state this loop starts
   * from, so a miss costs nothing and the loop tries the next point.
   */
  let isolated = false;
  for (const [fx, fy] of [[0.5, 0.65], [0.65, 0.5], [0.5, 0.5], [0.35, 0.5], [0.5, 0.35]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    if ((await viewer.getAttribute('data-drawn-structures')) === '1') {
      isolated = true;
      break;
    }
    await expect(viewer).toHaveAttribute('data-drawn-structures', String(total));
  }
  expect(isolated, 'no point on the model isolated anything').toBe(true);

  // A corner is empty space, and empty space is the escape.
  await page.mouse.click(box.x + 8, box.y + 8);
  await expect(viewer).toHaveAttribute('data-drawn-structures', String(total));
});

test('a drag orbits and does not isolate anything', async ({ page }) => {
  // Switch modes rather than reloading: `beforeEach` has already loaded the
  // pack, and a second full load of a WebGL scene per test is what pushed this
  // file past the 30 s timeout under parallel workers.
  await enterExplore(page);

  const viewer = page.getByTestId('anatomy-viewer');
  const total = await structureCount(page);
  const box = (await page.locator('.anatomy canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 60, cy + 20, { steps: 6 });
  await page.mouse.up();

  // A drag is a drag. The click gesture is only what a drag was NOT.
  await expect(viewer).toHaveAttribute('data-drawn-structures', String(total));
  await expect(page.getByTestId('structure-isolated')).toHaveCount(0);
});

test('hide takes one structure off, and show all is the escape', async ({ page }) => {
  // Switch modes rather than reloading: `beforeEach` has already loaded the
  // pack, and a second full load of a WebGL scene per test is what pushed this
  // file past the 30 s timeout under parallel workers.
  await enterExplore(page);

  const viewer = page.getByTestId('anatomy-viewer');
  const total = await structureCount(page);

  await page.getByTestId('structure-hide-lv-myocardium').click();
  await expect(viewer).toHaveAttribute('data-drawn-structures', String(total - 1));

  await page.getByTestId('structure-show-all').click();
  await expect(viewer).toHaveAttribute('data-drawn-structures', String(total));
});

test('the structure filter narrows the list without touching the model', async ({ page }) => {
  // Switch modes rather than reloading: `beforeEach` has already loaded the
  // pack, and a second full load of a WebGL scene per test is what pushed this
  // file past the 30 s timeout under parallel workers.
  await enterExplore(page);

  const viewer = page.getByTestId('anatomy-viewer');
  const total = await structureCount(page);

  await page.getByTestId('structure-filter').fill('mitral');
  await expect(page.getByTestId('structure-count')).toContainText(`of ${total}`);
  const rows = await page.locator('.structures__row').count();
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThan(total);
  // Filtering is a view of the list. Nothing left the model.
  await expect(viewer).toHaveAttribute('data-drawn-structures', String(total));
});

/*
 * KEYBOARD REACHABLE. Hospital desktops are a first-class target, and a control
 * that needs a mouse is a control some of them do not have.
 */
test('the structure list is operable from the keyboard', async ({ page }) => {
  // Switch modes rather than reloading: `beforeEach` has already loaded the
  // pack, and a second full load of a WebGL scene per test is what pushed this
  // file past the 30 s timeout under parallel workers.
  await enterExplore(page);

  const viewer = page.getByTestId('anatomy-viewer');
  await page.getByTestId('structure-filter').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(viewer).not.toHaveAttribute(
    'data-drawn-structures',
    String(await viewer.getAttribute('data-structure-count')),
  );
});

/*
 * EXPLORE ONLY.
 *
 * Echo is a claim about one saved probe pose imaging a whole heart, and a
 * learner who had isolated one coronary branch would be looking at an echo of a
 * heart that is not the heart on screen. The restriction is structural rather
 * than a hidden button: in Echo the list does not exist and a click on the model
 * does nothing.
 */
test('Echo mode has no structure list and no click-to-isolate', async ({ page }) => {
  const viewer = page.getByTestId('anatomy-viewer');
  await expect(viewer).toHaveAttribute('data-viewer-mode', 'echo');
  await expect(page.getByTestId('structure-panel')).toHaveCount(0);

  const total = await structureCount(page);
  const box = (await page.locator('.anatomy canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(viewer).toHaveAttribute('data-drawn-structures', String(total));
});

test('an isolate made in Explore does not follow the learner into Echo', async ({ page }) => {
  const viewer = page.getByTestId('anatomy-viewer');
  await enterExplore(page);
  const total = await structureCount(page);

  await page.getByTestId('structure-isolate-lv-myocardium').click();
  await expect(viewer).toHaveAttribute('data-drawn-structures', '1');

  await page.getByTestId('mode-echo').click();
  await expect(viewer).toHaveAttribute('data-drawn-structures', String(total));
  await expect(page.getByTestId('structure-panel')).toHaveCount(0);

  // And it is still there on the way back: the isolate was about the model.
  await page.getByTestId('mode-explore').click();
  await expect(viewer).toHaveAttribute('data-drawn-structures', '1');
});

/*
 * ONE ANSWER ABOUT WHICH WAY IS UP, and it is two controls that agree.
 */
test('the horizon lock is offered in Echo only, and defaults off', async ({ page }) => {
  const viewer = page.getByTestId('anatomy-viewer');
  await expect(page.getByTestId('horizon-lock')).not.toBeChecked();
  await expect(viewer).toHaveAttribute('data-horizon-lock', 'off');

  await page.getByTestId('horizon-lock').check();
  await expect(viewer).toHaveAttribute('data-horizon-lock', 'on');

  /*
   * Explore does not offer it at all. Free inspection is the point there and
   * the turntable was removed because it could not reach every angle
   * (`docs/observations.md` entry 35); the lock leaves with the mode rather
   * than following a learner into one that does not offer it.
   */
  await page.getByTestId('mode-explore').click();
  await expect(page.getByTestId('horizon-lock')).toHaveCount(0);
  await expect(viewer).toHaveAttribute('data-horizon-lock', 'off');
});

test('the apex toggle flips the echo panel and never the model', async ({ page }) => {
  const viewer = page.getByTestId('anatomy-viewer');
  const canvas = page.locator('.anatomy canvas');

  /* The model's own pixels, before and after. They must not move. */
  const anatomy = async () => canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const scratch = document.createElement('canvas');
    scratch.width = 48;
    scratch.height = 48;
    const context = scratch.getContext('2d')!;
    context.drawImage(source, 0, 0, 48, 48);
    return [...context.getImageData(0, 0, 48, 48).data].join(',');
  });

  const echoFrames = async () => Number(
    await page.locator('[data-testid=echo-panel] canvas').getAttribute('data-echo-frame') ?? '0',
  );

  const before = await anatomy();
  const framesBefore = await echoFrames();

  await expect(page.getByTestId('apex-flip')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('apex-flip').click();
  await expect(page.getByTestId('apex-flip')).toHaveAttribute('aria-pressed', 'true');

  // The echo redrew; the anatomy did not move at all.
  expect(await echoFrames()).toBeGreaterThan(framesBefore);
  expect(await anatomy()).toBe(before);
  await expect(viewer).toHaveAttribute('data-horizon-lock', 'off');

  // Pressing it again is the pack's authored orientation back, exactly.
  await page.getByTestId('apex-flip').click();
  await expect(page.getByTestId('apex-flip')).toHaveAttribute('aria-pressed', 'false');
});

/* -------------------------------------------------------------------------- */
/* the pair is measured, not eyeballed                                         */
/* -------------------------------------------------------------------------- */

/**
 * The two panels are one pair, and this is where that claim is checked.
 *
 * Last round the alignment was measured by hand and written down; a number in a
 * document is not a gate, and the first thing that moved it was a header chip
 * that cost 0.9 px. So the measurements are here now:
 *
 * 1. the two headers are the same height and the two canvases start at the same
 *    y and are the same size — a header that grows moves its image, which is
 *    exactly what the pair exists to prevent;
 * 2. every row under either canvas starts at the same inset from its own card,
 *    which before this round it did not: the anatomy's controls sat at 16 px,
 *    the echo's flip row at 0, its sweep label at 16 and the range input inside
 *    that label at 18;
 * 3. every button and toggle in those rows is the same height, so a row of
 *    mixed controls has one baseline instead of three.
 */
test('the two panels are one pair, to the pixel', async ({ page }, testInfo) => {
  const width = testInfo.project.use.viewport?.width ?? 0;
  test.skip(width < 800, 'the panels stack below 800 px, where there is no pair to align');

  const measured = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };

    /* Every row under a canvas, on both sides, with the card it belongs to. */
    const rowInsets: { name: string; inset: number }[] = [];
    const pairs: [string, string][] = [
      ['.anatomy-panel', '.anatomy-panel .cutter-mode, .anatomy-panel .cutter'],
      ['.echo', '.echo__display, .echo__scrub, .echo__provenance'],
    ];
    for (const [cardSelector, rowSelector] of pairs) {
      const card = document.querySelector(cardSelector)!.getBoundingClientRect();
      for (const row of document.querySelectorAll(rowSelector)) {
        /*
         * The inset of the row's CONTENT, not of the row box. Several of these
         * rows are full-bleed elements whose padding is the inset, and it is
         * the content edge a reader sees.
         */
        for (const child of row.children) {
          const rect = child.getBoundingClientRect();
          if (rect.width === 0) continue;
          rowInsets.push({
            name: `${cardSelector} ${child.className || child.tagName}`,
            inset: Math.round((rect.x - card.x) * 10) / 10,
          });
          break;
        }
      }
    }

    const controlHeights = [...document.querySelectorAll<HTMLElement>(
      '.cutter button, .cutter-mode__button, .cutter__toggle, .echo__flip',
    )].map((element) => ({
      name: element.className || element.tagName,
      height: Math.round(element.getBoundingClientRect().height * 10) / 10,
    }));

    return {
      anatomyHead: box('.anatomy__header'),
      echoHead: box('.echo__header'),
      anatomyCanvas: box('.anatomy canvas'),
      echoCanvas: box('[data-testid=echo-canvas]'),
      rowInsets,
      controlHeights,
    };
  });

  // 1. The headers are the same height, so the canvases start at the same y.
  expect(measured.anatomyHead!.height).toBe(measured.echoHead!.height);
  expect(measured.anatomyCanvas!.y).toBeCloseTo(measured.echoCanvas!.y, 1);
  expect(measured.anatomyCanvas!.width).toBeCloseTo(measured.echoCanvas!.width, 1);
  expect(measured.anatomyCanvas!.height).toBeCloseTo(measured.echoCanvas!.height, 1);

  // 2. One inset for every row under either canvas.
  expect(measured.rowInsets.length).toBeGreaterThanOrEqual(5);
  const insets = new Set(measured.rowInsets.map((row) => row.inset));
  expect(
    insets.size,
    `rows sit at ${[...insets].join(', ')} px: ${JSON.stringify(measured.rowInsets)}`,
  ).toBe(1);

  // 3. One height for every control in those rows.
  expect(measured.controlHeights.length).toBeGreaterThanOrEqual(6);
  const heights = new Set(measured.controlHeights.map((control) => control.height));
  expect(
    heights.size,
    `controls are ${[...heights].join(', ')} px tall: ${JSON.stringify(measured.controlHeights)}`,
  ).toBe(1);
});

/* -------------------------------------------------------------------------- */
/* the hover hint                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every control the learner can operate has a hint, and every hint is short.
 *
 * Two failures this makes impossible. A control with nothing to say gets no
 * card at all, which is the one place a hover hint is worse than useless — the
 * learner waited and got nothing. And a control whose `title` is a paragraph
 * would put the paragraph on screen, which is what the native tooltip already
 * did badly.
 *
 * The rule itself is unit-tested in `tests/unit/hintText.test.ts`; this applies
 * it to what is actually rendered, which is the half that drifts when a control
 * is added.
 */
test('every control has a hint, and every hint is short', async ({ page }) => {
  for (const url of ['?freeze=1', '?freeze=1&mode=explore']) {
    await page.goto(url);
    await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-status', 'ready', {
      timeout: 30_000,
    });

    const missing = await page.evaluate(() => {
      const MAX = 84;
      const concise = (authored: string | undefined, title: string) => {
        const short = (authored ?? '').trim();
        if (short) return short;
        const full = title.trim();
        if (full === '') return '';
        if (full.length <= MAX) return full;
        const stop = full.search(/[.!?](\s|$)/);
        const first = stop === -1 ? full : full.slice(0, stop + 1);
        return first.length <= MAX ? first : '';
      };

      /* The same walk the hint layer does: up from the pointer's target. */
      const source = (start: HTMLElement) => {
        let element: HTMLElement | null = start;
        while (element) {
          if (element.dataset.hintSkip !== undefined) return null;
          if (element.dataset.hint !== undefined || element.title.trim() !== '') return element;
          element = element.parentElement;
        }
        return null;
      };

      const bare: string[] = [];
      const selector = 'button, select, label, input:not([type=hidden]), [role=radio]';
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (element.dataset.hintSkip !== undefined) continue;
        const found = source(element);
        const text = found ? concise(found.dataset.hint, found.title) : '';
        if (text === '') {
          bare.push(
            element.dataset.testid
            ?? element.getAttribute('aria-label')
            ?? (element.textContent ?? '').trim().slice(0, 40)
            ?? element.tagName,
          );
        }
      }
      return bare;
    });

    expect(missing, `controls with no usable hint at ${url}`).toEqual([]);
  }
});

test('a hint appears only after a pause, and never under the pointer', async ({ page }) => {
  const control = page.getByTestId('cut-reset');
  await control.hover();

  // Nothing yet: a card that appeared immediately would appear while the
  // pointer was on its way somewhere else.
  await page.waitForTimeout(400);
  await expect(page.getByTestId('hint-card')).toHaveCount(0);

  await expect(page.getByTestId('hint-card')).toHaveCount(1, { timeout: 4000 });
  await expect(page.getByTestId('hint-card')).toHaveText(/cut plane back to their defaults/);

  // It must never be the thing under the pointer: a card that intercepted a
  // click would break the control at the moment the learner understood it.
  const events = await page.getByTestId('hint-card')
    .evaluate((element) => window.getComputedStyle(element).pointerEvents);
  expect(events).toBe('none');

  // And the control keeps its own description once the pointer leaves: the
  // layer BORROWS the title while it is hovered, and a control whose title was
  // never given back would lose its accessible description.
  await page.getByTestId('anatomy-title').hover();
  await expect(page.getByTestId('hint-card')).toHaveCount(0);
  await expect(control).toHaveAttribute('data-hint', /cut plane back to their defaults/);
  await expect(control).not.toHaveAttribute('data-hint-stash', /./);

  // A control whose description lives in `title` gets it back verbatim.
  const titled = page.getByTestId('match-echo');
  const before = await titled.getAttribute('title');
  await titled.hover();
  await expect(page.getByTestId('hint-card')).toHaveCount(1, { timeout: 4000 });
  await page.getByTestId('anatomy-title').hover();
  await expect(titled).toHaveAttribute('title', before ?? '');
});

/**
 * Explore has no probe, and no build flag changes that.
 *
 * Reported from the app: the authoring build briefly drew the transducer and
 * its wedge in Explore, so that a pose placed on a pack with no `views[]` would
 * be visible somewhere. It is a mode that says "the heart on its own"; a
 * transducer floating beside it says two things at once.
 *
 * Asserted against the SCENE rather than against a screenshot: the viewer
 * publishes what it has drawn, and reading pixels out of a WebGL canvas
 * measures the readback as much as the scene.
 */
test('Explore draws no probe, on a pack that has views and on one that has none', async ({ page }) => {
  for (const pack of ['normal-rodero', 'stub']) {
    await page.goto(`?freeze=1&pack=${pack}&mode=explore`);
    const viewer = page.getByTestId('anatomy-viewer');
    await expect(viewer).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });

    await expect(viewer).toHaveAttribute('data-probe', 'absent');
    await expect(page.getByTestId('probe-pad')).toHaveCount(0);
  }

  // And it comes back in Echo, so the assertion above is about the mode rather
  // than about a probe that was never built.
  await page.goto('?freeze=1&pack=normal-rodero');
  const viewer = page.getByTestId('anatomy-viewer');
  await expect(viewer).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(viewer).toHaveAttribute('data-probe', 'present');
});

/**
 * The locked pad has a centre, and it is the way back from a scrub.
 *
 * It used to be a dead `<span>` — the middle of the cross existed only to make
 * four arms read as one control — so the learner's only way back from a scrub
 * was pressing the opposite arrow the same number of times. Reported from the
 * app as "at least have the centre d-pad button".
 */
test('the locked pad’s centre returns the sweep to the view’s reference', async ({ page }) => {
  const home = page.getByTestId('probe-home');
  const scrub = page.getByTestId('echo-scrub');

  /*
   * HOME IS THE MIDDLE, not the start. A sweep runs from one extreme to the
   * other THROUGH the view it is named for, which is why the app opens at 0.5;
   * a centre button that went to 0 would be a "home" control going somewhere
   * that is not home. `SWEEP_HOME_T` is the one place that number lives now.
   */
  await expect(home).toBeVisible();
  await expect(home).toBeDisabled();
  await expect(scrub).toHaveValue('0.5');

  await page.getByTestId('probe-fan-up').click();
  await page.getByTestId('probe-fan-up').click();
  await expect(home).toBeEnabled();
  expect(Number(await scrub.inputValue())).toBeGreaterThan(0.5);

  await home.click();
  await expect(scrub).toHaveValue('0.5');
  await expect(home).toBeDisabled();

  // And it works from the other side too, so it is a reference rather than a
  // ceiling the sweep happens to start at.
  await page.getByTestId('probe-fan-down').click();
  expect(Number(await scrub.inputValue())).toBeLessThan(0.5);
  await home.click();
  await expect(scrub).toHaveValue('0.5');
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

/* -------------------------------------------------------------------------- */
/* the authoring gate, against the running production build                    */
/* -------------------------------------------------------------------------- */

/**
 * `contracts/authoring-mode.md` — "Gating": off by default, not reachable from
 * the learner UI, and nothing in the learner path becomes editable because
 * authoring mode exists.
 *
 * This is the third of three checks on the same rule, and it is the one that
 * runs the app. The unit suite asserts the flag and the guards; `npm run
 * check:authoring-absent` asserts the strings are not in the bundle; this
 * asserts that the built, served, rendered page has no authoring control on it
 * and has opened no database. The three fail for different reasons, which is
 * the point of having three.
 */
test('the learner build has no authoring surface, in either mode', async ({ page }) => {
  for (const url of ['?freeze=1', '?freeze=1&mode=explore', '?freeze=1&pack=stub']) {
    await page.goto(url);
    await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-status', 'ready', {
      timeout: 30_000,
    });

    await expect(page.getByTestId('authoring-controls')).toHaveCount(0);
    await expect(page.getByTestId('authoring-anchor')).toHaveCount(0);
    await expect(page.getByTestId('authoring-save-centre')).toHaveCount(0);
    await expect(page.getByTestId('authoring-prevent-auto-rotation')).toHaveCount(0);
    expect(await page.getByTestId('anatomy-viewer')
      .getAttribute('data-authoring-camera-orientation')).toBeNull();
    await expect(page.getByTestId('authoring-export')).toHaveCount(0);
    await expect(page.getByTestId('probe-restore-slot')).toHaveCount(0);
    await expect(page.getByText('Place from camera')).toHaveCount(0);
  }
});

test('the learner build opens no IndexedDB database at all', async ({ page }) => {
  await page.goto('?freeze=1');
  await expect(page.getByTestId('anatomy-viewer')).toHaveAttribute('data-status', 'ready', {
    timeout: 30_000,
  });
  // Exercise the controls a learner has, so this is not merely "nothing has
  // happened yet": unlock the probe, step it, cut, and switch modes.
  await page.getByTestId('probe-free').check();
  await page.getByTestId('probe-fan-up').click();
  await page.getByTestId('cut-enabled').uncheck();
  await page.getByTestId('mode-explore').click();

  const databases = await page.evaluate(async () => {
    if (typeof indexedDB?.databases !== 'function') return null;
    return (await indexedDB.databases()).map((entry) => entry.name ?? '');
  });

  // `databases()` is unavailable on some engines; there the assertion below on
  // the absence of our own name is the one that can still be made.
  if (databases === null) return;
  expect(databases).not.toContain('cardiology-authoring');
  expect(databases).toEqual([]);
});

/* -------------------------------------------------------------------------- */
/* body context: the registered reference chest                               */
/* -------------------------------------------------------------------------- */

/**
 * The chest is SCENERY, and these check the ways it must not become anatomy.
 *
 * The heart's framing, its structure list and its probe clearance are all
 * measured from heart geometry. A rib cage that leaked into any of them would
 * move the camera, put ribs in a cardiac structure list, or decide how close a
 * transducer may stand to tissue — so each is asserted rather than assumed.
 */
test('the reference chest is scene context and never anatomy', async ({ page }) => {
  await page.goto('?freeze=1');
  const viewer = page.getByTestId('anatomy-viewer');
  await expect(viewer).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(viewer).toHaveAttribute('data-chest', 'loaded', { timeout: 30_000 });

  const show = page.getByTestId('chest-show');
  await expect(show).not.toBeChecked(); // off by default: the chest is opt-in

  const before = {
    structures: await viewer.getAttribute('data-structure-count'),
    drawn: await viewer.getAttribute('data-drawn-structures'),
  };

  await show.check();
  await expect(page.getByTestId('chest-skin')).toBeVisible();
  await expect(page.getByTestId('chest-skeleton')).toBeVisible();
  await expect(page.getByTestId('chest-lungs')).toBeVisible();
  await expect(page.getByTestId('chest-fit')).toBeVisible();

  // Showing a chest adds no structures: the list is the pack's, and the pack
  // has no ribs in it.
  await expect(viewer).toHaveAttribute('data-structure-count', before.structures ?? '');
  await expect(viewer).toHaveAttribute('data-drawn-structures', before.drawn ?? '');

  // Each group toggles without disturbing the heart.
  for (const control of ['chest-skin', 'chest-skeleton', 'chest-lungs']) {
    await page.getByTestId(control).uncheck();
    await expect(viewer).toHaveAttribute('data-drawn-structures', before.drawn ?? '');
    await page.getByTestId(control).check();
  }

  // Transparency is a live control, not a fixed style.
  const opacity = page.getByTestId('chest-skin-opacity');
  await opacity.fill('0.4');
  await expect(opacity).toHaveValue('0.4');

  // Hiding it again leaves no trace on the heart.
  await show.uncheck();
  await expect(page.getByTestId('chest-skin')).toHaveCount(0);
  await expect(viewer).toHaveAttribute('data-drawn-structures', before.drawn ?? '');
});

test('an explicit Fit frames the chest, and Reset gives the heart back', async ({ page }) => {
  await page.goto('?freeze=1');
  const viewer = page.getByTestId('anatomy-viewer');
  await expect(viewer).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(viewer).toHaveAttribute('data-chest', 'loaded', { timeout: 30_000 });

  // Showing the chest must NOT reframe on its own. That is the whole reason
  // Fit is a button: the heart is the subject and stays framed as one.
  const framedOnHeart = await viewer.screenshot();
  await page.getByTestId('chest-show').check();
  await page.getByTestId('chest-fit').click();
  await page.waitForTimeout(1200);
  const framedOnChest = await viewer.screenshot();
  expect(Buffer.compare(framedOnHeart, framedOnChest)).not.toBe(0);

  await page.getByTestId('cut-reset').click();
  await page.waitForTimeout(1200);
  const afterReset = await viewer.screenshot();
  expect(Buffer.compare(afterReset, framedOnChest)).not.toBe(0);
});

test('a chest that fails to load leaves the heart and the echo working', async ({ page }) => {
  // The context asset is the only thing that fails. Everything the learner came
  // for has to survive it, and the app has to say so rather than silently
  // showing a heart with no context and no explanation.
  await page.route('**/body-context/**/chest.gltf', (route) => route.abort());

  await page.goto('?freeze=1');
  const viewer = page.getByTestId('anatomy-viewer');
  await expect(viewer).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(viewer).toHaveAttribute('data-chest', 'failed', { timeout: 30_000 });

  // The honest warning, and no controls for a chest that is not there.
  await expect(page.getByTestId('chest-failed')).toBeVisible();
  await expect(page.getByTestId('chest-show')).toHaveCount(0);

  // The heart is untouched.
  await expect(viewer).toHaveAttribute('data-structure-count', '24');
  await expect(viewer).toHaveAttribute('data-drawn-structures', '24');

  // And the echo still renders.
  await expect(page.getByTestId('echo-canvas')).toBeVisible();
});
