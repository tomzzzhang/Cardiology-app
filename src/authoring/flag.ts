/**
 * The authoring flag: one build-time boolean, and the reason it is not a
 * runtime setting.
 *
 * `contracts/authoring-mode.md` — "Gating": authoring mode is off by default,
 * not reachable from the learner UI, and nothing in the learner path may become
 * editable because it exists. A runtime toggle — a query parameter, a
 * localStorage key, a hidden keystroke — satisfies none of that: the code is
 * still in the bundle a learner downloads, the handlers still exist, and the
 * only thing standing between a learner and an editable pack is a string they
 * have not guessed yet.
 *
 * So it is a `define`. `__AUTHORING__` is replaced with a literal `true` or
 * `false` by `vite.config.ts` (and by `vitest.config.ts` for the unit suite)
 * before Rollup runs, so with the flag off every `if (AUTHORING_ENABLED)` folds
 * to `if (false)`, every `AUTHORING_ENABLED && <Panel/>` folds away, and the
 * modules those branches referenced become unreachable and are dropped. The
 * production bundle does not contain a disabled authoring surface; it does not
 * contain one at all, which is what `scripts/check-authoring-absent.ts`
 * asserts against the built output rather than against this comment.
 *
 * Turn it on for a placing session with:
 *
 *     npm run dev:authoring
 */
declare const __AUTHORING__: boolean;

export const AUTHORING_ENABLED: boolean = __AUTHORING__;

/**
 * The guard every side-effecting authoring entry point starts with.
 *
 * Throwing rather than returning quietly: reaching one of these with the flag
 * off is a gating defect, and a defect that returns `undefined` is one that
 * gets noticed a long way from where it happened. Nothing in the learner path
 * calls these, and the unit suite asserts that calling them with the flag off
 * throws — which is the test that fails the moment a guard is deleted.
 */
export function assertAuthoring(what: string): void {
  if (!AUTHORING_ENABLED) {
    throw new Error(
      `${what} is authoring-mode only, and authoring mode is off. `
      + 'This call should not exist in a learner build.',
    );
  }
}
