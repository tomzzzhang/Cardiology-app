# Handoff — Wave 0

**Last Updated:** 2026-08-16 15:05 ET
**Work Item:** Wave 0 — scaffold, CI, Pages, schema v0 + validator + stub pack, module contracts, `WORKFLOW.md`, issue templates. Dispatched directly, before the issue templates existed; no GitHub issue number.
**Branch:** `feat/00-wave0`
**Pull Request:** https://github.com/tomzzzhang/Cardiology-app/pull/1
**Implementation / Review Target SHA:** `8705186abc1a0c533758dfde139a35acb8f716ca`
**Status:** awaiting second independent review, reconciliation, and repair

## Objective

Deliver wave 0 per `docs/build_plan.md` v1.2 ("Milestones and waves"): a repository scaffold that
builds and deploys, content-pack schema v0 expressed in code and validated, a stub pack, one-page
module contracts, `WORKFLOW.md`, issue templates, and CI covering typecheck, lint, pack-schema
validation, visual-regression infrastructure, licence/provenance completeness, and Pages deployment.

Definition of done: `main` can auto-deploy the hello-world viewer to Pages; the stub pack loads and
validates; contracts preserve the v1.2 interfaces and interaction boundaries; `WORKFLOW.md` and issue
templates present; nothing under `docs/` or in the private planning workspace modified; no private
information or local absolute paths in the repository; work pushed on a branch and presented as a
pull request, not merged.

## Completed this round

- **Handoff protocol** added: one mutable builder handoff per work item plus immutable, target-SHA-
  keyed reviewer records and a reconciliation record under `handoffs/reviews/`.
- **Review, repair, and landing loop** documented in `handoffs/README.md`: freeze, two independent
  reviews, reconciliation, one repair owner, two verification reviews, then owner-controlled merge.
  `AGENTS.md` routes future reviewers into that loop and prevents them from editing the builder's
  handoff or reading each other's conclusions before fixing their own.
- **Wave 0 review gate entered:** Codex's independent review is published; Claude's independent
  review, reconciliation, and repair remain pending. No implementation files changed.
- Verified all wave 0 behaviour is unchanged by the process additions (see **Verification**).

Earlier rounds on this branch delivered the wave 0 scaffold itself; the state of that work is
described under **Current implementation state** rather than replayed here. `git log` has the
history.

## Current implementation state

### Scaffold and deployment

Vite 7 + TypeScript 5.9 + React 19 + three.js 0.180. `src/viewer/HelloViewer.tsx` renders a
hello-world scene — explicitly not viewer-core. `.github/workflows/pages.yml` deploys from `main`;
`actions/configure-pages` runs with `enablement: true`, so the first run on `main` turns Pages on and
sets its source to GitHub Actions.

The base path is never hardcoded: the Pages workflow passes `BASE_PATH=/<repository-name>/` from the
event, `vite.config.ts` reads it, and runtime code resolves URLs through `import.meta.env.BASE_URL`.
Local dev, `vite preview`, and the Playwright harness all run at `/`.

### Content pack schema v0 (PROVISIONAL)

`src/schema/` — `primitives.ts`, `packV0.ts`, `validate.ts`, `index.ts` — transcribes the schema from
`docs/build_plan.md` v1.2 plus the per-view field list from `docs/view_canon.md`. `src/packs/loadPack.ts`
is the only place untyped JSON becomes a typed pack.

Validation is total and never repairs a pack: unknown keys rejected (`strictObject`), unit vectors
must be unit rather than being silently normalized, `beam_axis ⟂ lateral_axis`, `focus_cm` within
`depth_cm`, sweep range unit must match sweep mode, and every cross-reference resolves — structure
ids unique, structure parents present and acyclic, glTF node references unique, echo labels, view
structure lists, show/hide presets (no structure both shown and hidden), sweep structure order, view
ids unique.

`meta.schema_version` is exact-match `"0"`; a pack declaring anything else fails with a version
message rather than a wall of shape errors.

### Interaction boundaries (build_plan v1.2)

The free anatomical cutter and the vetted echo wedge are separate objects on separate data paths:

- The free cutter is runtime inspection state — the infinite oriented radial plane `{N, s}` relative
  to the interaction pivot `C`, `dot(N, X - C) = s`. A pack may seed it exactly once through optional
  `interaction.free_cut`, alongside pivot and initial camera/orientation. That block governs viewer
  defaults only and carries no provenance, because nothing in it is a clinical claim.
- **The free cutter is never stored in `views[]`.** No code path exists from `{N, s}` into a view, and
  `tests/unit/packSchema.test.ts` asserts a pack that tries it is rejected.
- `views[]` entries carry the full vetted probe pose. The clinical plane and wedge are derived from
  that pose — one source of truth, so the wedge on the model and the echo fan cannot disagree.

`contracts/viewer-core.md` pins the rest for wave 1c: orbit/pan/zoom around `C`, explicit target
selection (heart/camera, free cut, or echo view — a drag never silently moves a different object),
infinite clipping with solid stencil caps, plane-normal depth control synchronized across slider,
modifier-wheel, and readout with wheel-without-modifier always zooming, touch controls, and the
copy-only "Align free cut to echo view" bridge. None of it is implemented or stubbed in wave 0.

### Stub pack

`public/packs/stub/` — two nested boxes (`stub_shell`, `stub_core`) generated deterministically by
`scripts/make-stub-assets.mjs`: a glTF with an embedded buffer and a 32³ `raw-u8` label volume. Both
"views" are explicitly synthetic, non-clinical, and draft-flagged. No medical models were downloaded
and no clinical or anatomical content was invented.

It loads and validates in the running app: the page reports pack name, schema version, structure and
view counts, licence, and vetting status read from the loaded pack.

### Contracts

Seven one-page contracts plus an index in `contracts/`: pack-loader, viewer-core, echo-renderer,
view rail + sweep scrubber, provenance UI, authoring mode, app shell.

### CI

`.github/workflows/ci.yml`, four jobs:

- **Typecheck, lint, tests** — `tsc --noEmit`, `eslint .`, vitest, production build.
- **Pack schema and provenance** — `validate:packs` (schema, cross-references, asset existence, and
  that a `raw-u8` volume's byte length matches its declared resolution), `check:provenance` (licence
  and attribution completeness per anatomy *and* per view, placeholder detection, consent-gated vetter
  names), plus a check that regenerating the stub assets produces no diff.
- **Visual regression** — Playwright on desktop and phone-portrait profiles.
- **Repository guardrails** — `docs/` read-only on pull requests, no committed local absolute paths,
  no references to a synced planning tree.

The Pages workflow re-runs pack and provenance validation before publishing, so a bad pack cannot
reach the site.

### Visual regression — what is and is not gated

Baseline PNGs are platform-specific and the trustworthy ones come from the Linux CI runner, which
this host cannot produce (no Docker available). So:

- Deterministic assertions gate from day one: the WebGL canvas renders non-blank, the stub pack
  reaches `data-status="ok"`, and the page loads with zero console errors — on both profiles.
- The `toHaveScreenshot` comparison **skips itself** when no baseline exists for the project and
  activates automatically once one is committed. `updateSnapshots: 'none'`, so it never silently
  writes a baseline and reports green.
- Running the CI workflow manually (`workflow_dispatch`) seeds Linux baselines and uploads them as an
  artifact, so a later wave can commit a set produced by the same runner image that will check it.

## Files changed

49 files on the wave 0 implementation commit, plus the handoff and review-protocol additions.

Protocol and review records now added:

```
handoffs/README.md
handoffs/00-wave0.md
handoffs/reviews/00-wave0/8705186-codex.md
CLAUDE.md
AGENTS.md
```

Related files modified during the protocol rounds:

```
.github/ISSUE_TEMPLATE/work-item.yml   required handoff field + checklist items
.github/pull_request_template.md       handoff checklist item
README.md                              links the handoff protocol
```

Wave 0 areas from earlier rounds: `src/schema/`, `src/packs/`, `src/viewer/`, `public/packs/stub/`,
`scripts/`, `contracts/`, `tests/`, `.github/`, `docs/` (initial sync, unmodified), and the root
build configuration.

## Verification

Run locally on 2026-08-16, at the tree committed as `b9cce61`.

| Check | Result |
|---|---|
| Typecheck | `npm run typecheck` — pass |
| Lint | `npm run lint` — pass, 0 problems |
| Unit tests | `npm run test` — 20 passed, 1 file, 0 failed |
| Build | `npm run build` — succeeded, `✓ built in 1.24s` |
| Relevant CI | Run 31964281012 on `b9cce61` — **success**, all four jobs: Typecheck/lint/tests, Pack schema and provenance, Visual regression, Repository guardrails. Previous run 31963610996 on `2662339` also green. |

Additional checks this round:

| Check | Result |
|---|---|
| Pack schema | `npm run validate:packs` — `1 pack(s) valid against schema v0` |
| Provenance | `npm run check:provenance` — `Provenance and attribution complete for 1 pack(s)` |
| Visual suite | `npm run test:visual` — 6 passed, 2 skipped (screenshot comparison, no baseline yet) |
| `WORKFLOW.md` byte-identity | Its full text is still a verbatim substring of the source section in `docs/build_plan.md` — checked programmatically |
| `docs/` untouched | Clean in the working tree; the only diff against `main` is the initial sync, which the guard now permits |
| Review-loop documentation | `git diff --check` — pass; `npm run verify` — pass, including 20 unit tests, pack validation, and provenance validation |

Later review and process commits do not alter the frozen implementation target. Their CI results
must still be read from the pull request rather than inferred from the earlier implementation run.

## Decisions made

- **Schema v0 implemented as written** — not frozen, simplified, or extended. One controlled revision
  to v1 is expected after the wave 1 technical slice review.
- **Validation refuses rather than repairs.** A non-unit vector or a missing required field fails at
  the pack boundary instead of being normalized into viewer maths.
- **Base path derived, never hardcoded**, so the repository carries no deployment-specific string.
- **`main` was created as an empty root commit** so the branch had a base and `docs/` could arrive
  inside the pull request, as instructed.
- **The `docs/` guard stands down on the initial sync.** It blocked the very commit introducing
  `docs/`; it now exits clean when `docs/` does not exist on the base commit and fails every change
  once it does.
- **Handoffs are per work item, never global** — a single shared status file would put parallel
  branches in conflict over the same lines.
- **No code `LICENSE` chosen.** Deliberately left to the owner rather than picked by a build worker.

## Decisions needed from owner

1. **Merging this pull request enables and publishes GitHub Pages.** `actions/configure-pages` runs
   with `enablement: true`, so the first run on `main` turns Pages on and sets its source to GitHub
   Actions — no manual settings step, and no second confirmation. The repository is already public.
   Should this stay automatic, or should `enablement` be dropped so Pages is enabled by hand first?
2. **The repository has no code `LICENSE` file.** Until one is added the code is under default
   copyright. Which licence, or is default copyright intended for now? (Model and content licensing
   is separate and already carried per pack.)
3. **Repository-name capitalization differs from the planned name.** `docs/build_plan.md` specifies
   `github.com/tomzzzhang/cardiology-app` and `https://tomzzzhang.github.io/cardiology-app/`; the
   repository is actually `Cardiology-app`, so the published URL will be
   `https://tomzzzhang.github.io/Cardiology-app/`. Nothing in the repository hardcodes either
   spelling — the workflow derives the base path from the repository name — but the document and the
   live URL will not match. Rename the repository, or update the plan? `docs/` was not edited.

## Known limitations and deferred work

- **Two schema areas were left deliberately minimal**, both reserved for the v1 revision:
  - `views[].family` and `views[].view_id` are free-form strings. `docs/view_canon.md` is DRAFT
    pending clinical vetting, so enumerating its A1–F2 taxonomy in the engine would freeze draft
    clinical content into code.
  - `echo_tuning` is an open bag of scalars and `emphasis` is a nullable string. The renderer's knob
    names come out of the echo slice (wave 1b), and emphasis vocabulary is assigned at vetting.
- `real_clip_slot` is required and must be `null` in v0. The slot is reserved so real clips are
  additive later, never a rearchitecture.
- **No committed screenshot baselines.** The comparison is skipped, not enforced, until Linux
  baselines land — see the visual-regression note above.
- The hello-world viewer is a build-and-deploy smoke test. viewer-core, the echo renderer, the view
  rail, provenance UI, authoring mode, and the real app shell are all later waves.
- The wave 0 work item predates the issue templates, so this handoff has no GitHub issue number and
  is named `00-wave0.md` by wave rather than by issue. Later work items take `<issue-number>-<slug>`.

## Blockers

The pull request is intentionally **not ready to merge**. Codex completed an independent review of
target `8705186abc1a0c533758dfde139a35acb8f716ca`; the second independent review, reconciliation,
and approved repair pass are still pending. The three items under **Decisions needed from owner**
also remain merge gates.

## Exact next action

1. A fresh Claude review session independently reviews exact target
   `8705186abc1a0c533758dfde139a35acb8f716ca` without first reading the Codex review, then publishes
   only `handoffs/reviews/00-wave0/8705186-claude.md`.
2. After Claude's conclusions are fixed, reconcile both reviews in
   `handoffs/reviews/00-wave0/8705186-reconciliation.md`, recording accepted, deferred, and rejected
   findings, unresolved owner decisions, and one implementation owner.
3. That one owner implements only the accepted repair list, runs the full gate, and updates this
   handoff with the repaired implementation/review target SHA.
4. Claude and Codex independently verify the repaired target. Merge only after both verdicts and
   required CI are clear and the owner decisions above are resolved.

Do **not** merge this pull request or start wave 1 work yet.

## Scope and privacy check

- No files under `docs/` were modified. They appear in this pull request only as the initial one-way
  sync, unchanged from source; verified byte-identical to the privacy-scrubbed handoff copies.
- The private planning workspace was not modified — read-only access, directory listings and the
  three scrubbed specification files only, with file timestamps unchanged.
- `WORKFLOW.md` remains byte-identical to its source section in `docs/build_plan.md`.
- No personal names, program or institution names, or availability details anywhere in the
  repository. Clinical collaborators appear by role label only.
- No secrets or tokens committed.
- No machine-specific absolute paths, and no references to a synced planning tree — both enforced
  mechanically by the Repository guardrails CI job.
- No product features were added this round; the changes are workflow documentation and issue/PR
  template text only.
