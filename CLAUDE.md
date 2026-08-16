# Claude Code — start here

This file is a pointer, not a spec. The canonical documents are linked below; read them rather than
relying on this summary.

## Before doing anything

1. **[`WORKFLOW.md`](WORKFLOW.md)** — how work is dispatched, branched, and landed.
2. **[`handoffs/README.md`](handoffs/README.md)** — the handoff protocol.
3. **The handoff for the active work item**: `handoffs/<work-item-id>-<slug>.md`. The issue names it; the id is dispatcher-assigned, not the GitHub issue number.
4. **The contracts your issue lists**, under [`contracts/`](contracts/).

## While working

- Work **only** within the files and directories your issue says it owns. Anything else is out of
  bounds, including other work items' handoffs.
- **Never edit `docs/`.** Those are one-way, privacy-scrubbed copies of the product truth, synced by
  the planning session. CI fails a pull request that changes them.
- **Never read from or write to the private planning workspace**, and never reference its paths or
  contents. `docs/` is the only sanctioned copy of the specification.
- **Never change the schema or a contract.** Interface changes route back through the planning
  session — open a contract-change issue and keep coding against the current contract.
- No personal names, no institution or program affiliations **of collaborators**, no availability
  details, no secrets, and no machine-specific absolute paths anywhere in the repository. Clinical
  collaborators are referred to by role label. This bans *identifying a collaborator*; it does not
  ban crediting a third party whose model a licence requires you to credit — pack provenance and the
  credits screen must still carry the source creator, source institution, and licence.

## Before stopping

1. Reconcile actual repository, branch, test, CI, and pull request state — from `git` and GitHub, not
   from memory.
2. Update **only your issue's handoff file** and push it to the same branch and pull request.
3. Report the handoff path and the resulting commit SHA.
4. **Do not merge your own pull request.** Open it and stop.

Never claim a test, CI job, push, or deployment succeeded without having verified it.

## Repository conventions

- `npm run verify` is the local gate: typecheck, lint, unit tests, pack schema, provenance.
  `npm run test:visual` runs the Playwright suite.
- Handoff files are the only Markdown in this repository that carry a `**Last Updated:**` timestamp.
  Do not add one to `docs/`, to `WORKFLOW.md`, or to the contracts — `WORKFLOW.md` in particular must
  stay byte-identical to its source section in `docs/build_plan.md`.
