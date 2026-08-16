# Coding agents — start here

Applies to any coding agent working in this repository (Codex, Claude Code, or otherwise). This file
is a pointer, not a spec. Read the canonical documents rather than relying on this summary.

## Before doing anything

1. **[`WORKFLOW.md`](WORKFLOW.md)** — how work is dispatched, branched, and landed.
2. **[`handoffs/README.md`](handoffs/README.md)** — the handoff protocol.
3. **The handoff for the active issue**: `handoffs/<issue-number>-<slug>.md`. The issue names it.
4. **The contracts your issue lists**, under [`contracts/`](contracts/).

If the assignment is an independent review, also follow **Review, repair, and landing loop** in
`handoffs/README.md`. Inspect the exact implementation/review target SHA named by the assignment,
not the latest branch head. Do not read the other reviewer’s record until your own conclusions are
fixed.

## While working

- Work **only** within the files and directories your issue says it owns. Anything else is out of
  bounds, including other work items' handoffs.
- **Never edit `docs/`.** Those are one-way, privacy-scrubbed copies of the product truth, synced by
  the planning session. CI fails a pull request that changes them.
- **Never read from or write to the private planning workspace**, and never reference its paths or
  contents. `docs/` is the only sanctioned copy of the specification.
- **Never change the schema or a contract.** Interface changes route back through the planning
  session — open a contract-change issue and keep coding against the current contract.
- No personal names, program or institution names, availability details, secrets, or
  machine-specific absolute paths anywhere in the repository. Clinical collaborators are referred to
  by role label.

## Review-only sessions

- Stay read-only against implementation, contracts, schemas, planning copies, and the builder’s
  handoff.
- Write only your reviewer-owned file under
  `handoffs/reviews/<work-item>/<target-sha>-<reviewer>.md`.
- Review the exact frozen target independently. A review-only commit may advance the branch head but
  never changes the declared target.
- Pull the latest remote state immediately before adding the review file; review-only commits are
  serialized and never pushed concurrently.
- After publishing your review, verify CI, report the review path and commit SHA, and stop without
  implementing or merging.

## Implementation workers — before stopping

1. Reconcile actual repository, branch, test, CI, and pull request state — from `git` and GitHub, not
   from memory.
2. Update **only your issue's handoff file** and push it to the same branch and pull request.
3. Report the handoff path and the resulting commit SHA.
4. **Do not merge your own pull request.** Open it and stop.

Never claim a test, CI job, push, or deployment succeeded without having verified it.

## Repository conventions

- `npm run verify` is the local gate: typecheck, lint, unit tests, pack schema, provenance.
  `npm run test:visual` runs the Playwright suite.
- Handoff-family records — builder handoffs, independent reviews, and reconciliations — are the only
  Markdown in this repository that carry a `**Last Updated:**` timestamp. Do not add one to `docs/`,
  to `WORKFLOW.md`, or to the contracts — `WORKFLOW.md` in particular must stay byte-identical to
  its source section in `docs/build_plan.md`.
