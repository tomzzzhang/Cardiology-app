# Claude Code — start here

**Updated:** 2026-08-19 17:45 EDT

A pointer, not a spec.

1. Read **[`WORKFLOW.md`](WORKFLOW.md)** — the development loop, Git rules, and the safeguards
   that do not lapse.
2. Read the **contracts your task touches**, under [`contracts/`](contracts/), and
   [`contracts/README.md`](contracts/README.md) for the free-cutter / vetted-wedge boundary.
3. Read [`docs/`](docs/) for product scope, build plan, and the clinical view canon.

## Working

- Work directly on `dev`. Keep each checkpoint coherent, verified, and pushed.
- `npm run verify` is the normal gate. Run `npm run test:visual` and look at the app in a
  browser when rendering or UI changed.
- Change the schema or a contract deliberately, with evidence, updating tests and
  documentation in the same commit — never silently.
- No personal collaborator context, no PHI, and no machine-specific absolute paths in
  anything committed.

## Before stopping

Commit and push to `origin/dev`, then add one concise newest-first entry to the planning
folder's `progress_log.md`: outcome, commit SHA, verification results, known limitations, and
the exact next step. Report any decision the owner has to make.

Never claim a test, CI job, push, or deployment succeeded without having verified it.
