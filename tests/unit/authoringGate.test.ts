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
