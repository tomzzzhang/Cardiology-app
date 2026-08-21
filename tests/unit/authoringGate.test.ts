/**
 * The gating rules, as tests that can fail.
 *
 * Two of them, and they are different KINDS of claim, so they are asserted
 * differently:
 *
 * 1. **Authoring mode is off in a learner build.** This suite runs with
 *    `__AUTHORING__` defined as `false` — the learner configuration — so the
 *    flag's value and the guard's behaviour are both directly observable here.
 *    The complementary half of this claim is about the emitted BUNDLE and
 *    cannot be made in Node at all; `scripts/check-authoring-absent.ts` makes
 *    it against `dist/`.
 *
 * 2. **Nothing in this unit writes `views[]`.** `freeProbe.ts` guarantees its
 *    version of this structurally — it takes a pose and returns a pose and
 *    cannot see the pack — and the authoring modules have to do the same,
 *    except that they legitimately need a pack ID and the poses out of
 *    `views[]` to seed standard slots. So the structural guarantee is drawn one
 *    step further out: the authoring modules never receive the `Pack`, and the
 *    slot seeds they do receive are frozen. Both are asserted, and the second
 *    is asserted over the SOURCE, because "no module here imports a way to
 *    mutate a pack" is a claim about the module graph rather than about any one
 *    call.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHORING_ENABLED, assertAuthoring } from '../../src/authoring/flag.ts';
import { deleteSlot, loadSlots, openSlotStore, saveSlot } from '../../src/authoring/slotStore.ts';
import {
  AUTHORING_BUNDLE_MARKERS,
  findAuthoringBundleLeaks,
  findAuthoringSourceMapLeaks,
} from '../../scripts/check-authoring-absent.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const authoringDir = join(repoRoot, 'src', 'authoring');

function authoringSources(): { name: string; source: string }[] {
  return readdirSync(authoringDir)
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .map((name) => ({ name, source: readFileSync(join(authoringDir, name), 'utf8') }));
}

describe('the flag is off, and the guard says so out loud', () => {
  it('is false in the configuration a learner gets', () => {
    expect(AUTHORING_ENABLED).toBe(false);
  });

  it('the guard throws rather than returning quietly', () => {
    expect(() => assertAuthoring('opening the slot store')).toThrow(/authoring-mode only/);
    expect(() => assertAuthoring('opening the slot store')).toThrow(/should not exist/);
  });
});

describe('with the flag off, IndexedDB is never opened', () => {
  /*
   * Every entry point, not a sample of them. A store with one unguarded door is
   * an open store, and the door that gets added later is the one nobody thought
   * to test.
   *
   * `openSlotStore` is synchronous up to its guard, so its throw is synchronous
   * too; the three that wrap it in an async function reject instead. Both are
   * asserted, because "it threw" and "it returned a rejected promise" are not
   * the same thing to a caller and only one of them is caught by a `try`.
   */
  it('openSlotStore throws before it can call indexedDB.open', () => {
    expect(() => openSlotStore()).toThrow(/authoring-mode only/);
  });

  it.each([
    ['loadSlots', () => loadSlots('normal-rodero')],
    ['saveSlot', () => saveSlot({
      packId: 'normal-rodero', packVersion: '0.1.0',
      slotId: 'view-0', kind: 'canon', label: 'x',
      pose: {
        origin: [0, 0, 0], beam_axis: [0, 0, -1], lateral_axis: [1, 0, 0],
        fan: { angle_deg: 80, depth_cm: 21, focus_cm: 10 },
        display: { vertex: 'down', flip_lr: false, marker_side: 'right' },
      },
      savedAt: '2026-08-19T20:00:00.000Z',
    })],
    ['deleteSlot', () => deleteSlot('normal-rodero', 'view-0')],
  ] as const)('%s refuses rather than opening the store', async (_name, call) => {
    await expect(call()).rejects.toThrow(/authoring-mode only/);
  });

  it('there is no IndexedDB in this environment, so a missing guard could not pass', () => {
    // Node has no `indexedDB`. If a guard were removed, the call would fail on
    // the missing global instead — with a DIFFERENT message, which is why the
    // assertions above match on the guard's own words rather than on "it threw".
    expect(typeof indexedDB).toBe('undefined');
  });
});

describe('the emitted learner bundle is checked for authoring transition code', () => {
  it('keeps the original surface marker and adds transition-specific markers', () => {
    const markers = new Set(AUTHORING_BUNDLE_MARKERS.map((marker) => marker.needle));
    expect(markers).toContain('Place from camera');
    expect(markers).toContain('None — full heart');
    expect(markers).toContain('Prevent auto-rotation');
    expect(markers).toContain('authoring-prevent-auto-rotation');
    expect(markers).toContain('data-prevent-auto-rotation');
    expect(markers).toContain('data-authoring-camera-orientation');
    expect(markers).toContain('probeTransition');
    expect(markers).toContain('data-transitioning');
    expect(markers).toContain('Transition — not a saved view');
    expect(markers).toContain(
      'Simulated echocardiogram, unauthored transition between saved views',
    );
    expect(markers).toContain(
      'Unvetted intermediate plane — animation between saved views',
    );
  });

  it('reports both an original authoring control and minified transition literals', () => {
    const failures = findAuthoringBundleLeaks(
      'dist/assets/index.js',
      'x Place from camera y Prevent auto-rotation authoring-prevent-auto-rotation probeTransition '
        + 'z Transition — not a saved view',
    ).join('\n');
    expect(failures).toContain('the placement button’s label');
    expect(failures).toContain('the authoring auto-rotation toggle label');
    expect(failures).toContain('the authoring probe-transition dataset state');
    expect(failures).toContain('the authoring transition heading');
  });

  it('allows only the build flag and reports every implementation module in a source map', () => {
    const sourceMap = JSON.stringify({
      version: 3,
      sources: [
        '../../src/authoring/flag.ts',
        '../../src/authoring/poseTransition.ts',
        '..\\..\\src\\authoring\\AuthoringControls.tsx',
        '../../src/viewer/orbit.ts',
      ],
    });
    expect(findAuthoringSourceMapLeaks('dist/assets/index.js.map', sourceMap)).toEqual([
      'dist/assets/index.js.map maps emitted code to src/authoring/AuthoringControls.tsx. '
        + 'An authoring implementation module is in the learner build.',
      'dist/assets/index.js.map maps emitted code to src/authoring/poseTransition.ts. '
        + 'An authoring implementation module is in the learner build.',
    ]);
  });

  it('fails closed when a source map cannot prove its source-module list', () => {
    expect(findAuthoringSourceMapLeaks('dist/assets/index.js.map', '{}').join('\n'))
      .toMatch(/no string sources list.*cannot be proved/);
    expect(findAuthoringSourceMapLeaks('dist/assets/index.js.map', '{').join('\n'))
      .toMatch(/not valid JSON.*cannot be proved/);
  });
});

describe('nothing in this unit can write views[]', () => {
  const sources = authoringSources();

  it('there are authoring modules to check', () => {
    expect(sources.length).toBeGreaterThan(3);
  });

  it.each(sources.map((file) => [file.name, file.source] as const))(
    '%s never imports the Pack type or the pack loader',
    (_name, source) => {
      /*
       * TYPE imports of `ProbePose` are fine and necessary — a pose is the
       * currency here. What must not appear is the whole `Pack`, or the loader
       * that produces one: hold the pack and `views[]` is one property access
       * away, and the guarantee stops being structural and becomes a promise.
       */
      expect(source).not.toMatch(/\bimport\b[^;]*\bPack\b[^;]*from/);
      expect(source).not.toMatch(/from '[^']*packs\/loadPack/);
    },
  );

  it.each(sources.map((file) => [file.name, file.source] as const))(
    '%s contains no assignment into a views array',
    (_name, source) => {
      // Belt as well as braces. The import check above is the real guarantee;
      // this catches a `pack.views[i].probe = …` written against an `any`.
      expect(source).not.toMatch(/\.views\s*(\[|\.|=)/);
      expect(source).not.toMatch(/views\s*\[[^\]]*\]\s*=/);
    },
  );
});
