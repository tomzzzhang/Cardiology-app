<!--
WORKFLOW.md: one branch per session per work item; everything lands on `main` via PR, merged
serially. Do not merge your own PR — open it and stop.
-->

Closes #

## What this delivers

<!-- The goal from the work item, and what actually landed. -->

## Files owned by this session

<!-- The paths from the work item. Anything changed outside them needs a sentence saying why. -->

## Checks

- [ ] `npm run verify` passes locally (typecheck, lint, unit tests, pack schema, provenance)
- [ ] `npm run test:visual` passes
- [ ] No files outside my owned area changed
- [ ] No changes to `docs/` — those are one-way, privacy-scrubbed copies
- [ ] No changes to `contracts/` or `src/schema/` (or: a contract-change issue is linked and approved)
- [ ] No personal names, program names, availability details, or local absolute paths added
- [ ] Any new or changed pack carries complete provenance and licence fields

## Interaction boundaries (tick what applies)

- [ ] The free anatomical cutter stayed runtime state — no free-cut data written into `views[]`
- [ ] Clinical planes and wedges are still derived from the saved probe pose, one source of truth
- [ ] Any "Align free cut to echo view" path is still copy-only and never edits a vetted view

## Notes for review

<!-- Anything the reviewer should look at first, or anything deliberately left for a later wave. -->
