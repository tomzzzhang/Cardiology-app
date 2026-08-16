# Handoff — Wave 0

**Last Updated:** 2026-08-16 18:18 ET
**Work Item:** Wave 0 — scaffold, CI, Pages, schema v0 + validator + stub pack, module contracts, `WORKFLOW.md`, issue templates. Dispatched directly, before the issue templates existed; no GitHub issue number.
**Branch:** `feat/00-wave0`
**Pull Request:** https://github.com/tomzzzhang/Cardiology-app/pull/1
**Implementation / Review Target SHA:** `fdf6158e45c3ba0f1368935f3f61358f24eb7440`
**Status:** repaired, owner decisions resolved; awaiting two independent verification reviews of the new target

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

The review gate for target `8705186` completed and its accepted repairs landed.

- **Both independent reviews published.** `handoffs/reviews/00-wave0/8705186-codex.md` and
  `8705186-claude.md`. Each was written against the frozen target before its author read the other.
- **Reconciliation published** at `handoffs/reviews/00-wave0/8705186-reconciliation.md`: 20 repairs
  accepted, 10 deferred with reasons, 2 rejected with reasons, 6 owner decisions kept as questions,
  one implementation owner named. Every finding was re-checked against the frozen tree before being
  classified; nothing was accepted merely because a reviewer raised it.
- **All 20 accepted repairs implemented** in `61767ea`, with 70 new unit tests and one new Playwright
  spec. Detail under **Repairs landed** below.
- **The owner resolved decisions 1–4**, and the two that needed code landed in `fdf6158`:
  AGPL-3.0-only as the code licence, and the sanctioned `docs/` sync route. Detail under **Owner
  decisions resolved** below.
- The new target `fdf6158e45c3ba0f1368935f3f61358f24eb7440` supersedes `8705186` and the intermediate
  `61767ea` for review purposes. No review was ever dispatched against `61767ea`, so nothing is
  orphaned by superseding it.

## Repairs landed

### Deployed behaviour

A browser that refuses a WebGL context previously rendered a **completely blank page** — the
renderer constructor threw inside the effect, React had no boundary, and the whole tree unmounted,
taking the pack status and the "simulated, not diagnostic" disclaimer with it. Hospital desktops with
GPU acceleration disabled are a first-class target and are exactly where the context is refused; the
CI runner has software WebGL, so nothing in the suite could catch it. The failure is now caught, the
viewer region explains itself, and the rest of the shell stays mounted. `tests/visual/no-webgl.spec.ts`
launches with WebGL disabled and asserts it.

### Schema — enforcing the specification, not extending it

Each of these was accepted only under the reading recorded in the reconciliation, that it makes an
already-stated invariant true. Every case listed was **accepted by the schema before this round**.

- **Asset paths can no longer escape the pack directory.** The old refinement rejected a literal
  `..` only, while the URL parser that actually resolves assets also treats `..\`, `%2e%2e/`, and
  friends as traversal. Schemes, drive prefixes, queries, fragments, and empty segments are refused
  too, and the check runs on the percent-decoded string.
- **`meshes.orientation` must be a coherent frame** — a signed permutation of three distinct axes
  whose declared handedness matches. `{up:+y, anterior:+y, patient_left:+y}` used to validate. The
  handedness ordering is pinned by the shipped pack rather than chosen here, and documented in code.
- **Provenance dates must exist on the calendar.** `2026-02-30` used to validate.
- **Camera states must be buildable** — position equal to target, or `up` parallel to the view
  direction, now fail instead of producing NaNs downstream.

### Contract

`contracts/echo-renderer.md` transcribed the specular term as an **addition**; `docs/build_plan.md`
**multiplies** it. Corrected to the specification's operator, with a note, before Wave 1b is
dispatched against the wrong model. Found by the Codex review.

### Validator

- Every `mesh_node` must resolve to a named node inside the referenced glTF, and the glTF's own
  external resources must be embedded or present on disk. Binary containers (`.glb`, KTX2) are
  reported as **skipped** rather than silently passed.
- A `raw-u8` volume must declare every voxel value it contains; value `0` is reserved for background
  and cannot be claimed by a label; a declared label that appears nowhere fails.
- A pack directory that is missing `pack.json`, or whose `pack.json` is malformed, becomes a
  collected failure line instead of an uncaught throw.
- Placeholder attribution is caught at a token boundary, so `TBD - ask the vetter` trips the gate
  while ordinary attribution text does not.
- `readSchemaVersion` recognises an unquoted numeric version, so the friendly version refusal fires
  instead of a shape-error wall.

### CI and deployment

- **Production base path is now exercised.** `npm run check:base-path` builds with a sentinel
  `BASE_PATH` and asserts the emitted HTML, bundle, and pack URLs are prefixed. Every other check
  builds at `/`, so a hardcoded root-absolute URL would previously have surfaced only on the deployed
  site, after a merge.
- **The `docs/` guard arms inside the initial-sync pull request.** The stand-down now admits
  additions only, so a later commit on the same branch cannot edit the freshly synced copies while
  the guard stays green.
- **Pages deploys only from the default branch**, checked in code rather than relying on the
  `github-pages` environment setting, and runs typecheck, lint, and unit tests before upload
  alongside the pack and provenance checks.
- Baseline seeding no longer swallows failure with `|| true`.

### Documentation

- The privacy rule is narrowed to **collaborators'** affiliations. Banning institution names outright
  would have forbidden the licence-required source attribution the build plan mandates.
- Handoff filenames use a **dispatcher-assigned work-item id**; the issue form cannot require a
  GitHub issue number that does not exist while the form is being filled in.
- The stub fixture's documented claim now matches its actual label extents.

## Owner decisions resolved

All four were answered by the owner in session; decisions 5 and 6 remain open below.

1. **Pages auto-publish — keep `enablement: true`.** No code change: merging turns Pages on and
   publishes the site at `https://tomzzzhang.github.io/Cardiology-app/` with no second confirmation.
2. **Code licence — AGPL-3.0-only.** Verbatim text in `LICENSE`, declared in `package.json`,
   summarised in the README. Copyright is attributed to "the Cardiology app project contributors"
   rather than a personal name, consistent with the repository's privacy rule; a named holder is
   stronger for enforcement and is a one-line change if the owner wants it. **The code licence does
   not touch content licensing** — packs stay under their own terms, the Alberta models stay
   CC BY-NC 4.0, and the non-commercial red lines still bind the product.
3. **Repository name — keep `Cardiology-app`.** No repository change needed: the five committed
   strings already use that spelling and the base path is derived. The consequence is that
   `docs/build_plan.md`, which specifies the lowercase name and URL, is now wrong. The owner chose
   **option B**: the planning session corrects it in its own pull request after this one merges,
   which is why decision 4 had to be answered first.
4. **`docs/` sync route — `docs/sync-*` branch, docs-only pull request.** The guard stands down only
   when the branch matches `docs/sync-*` **and** the pull request changes nothing outside `docs/`.
   Both halves are required: the branch name states the intent, the docs-only check is what actually
   stops a code change riding along under it. Everything else stays a blanket ban, and the
   initial-sync stand-down still admits additions only.

   The guard moved out of inline workflow YAML into `scripts/check-docs-guard.sh` so it could be
   tested; `tests/unit/docsGuard.test.ts` drives it against real git history across ten cases,
   including a `docs/sync-*` branch attempting to smuggle a source change and branch names that
   merely resemble the sanctioned prefix. Workflow values now reach the script through `env` rather
   than being interpolated into the shell.

## Current implementation state

### Scaffold and deployment

Vite 7 + TypeScript 5.9 + React 19 + three.js 0.180. `src/viewer/HelloViewer.tsx` renders a
hello-world scene — explicitly not viewer-core — and degrades to a readable message when WebGL is
unavailable. `.github/workflows/pages.yml` deploys from the default branch only;
`actions/configure-pages` runs with `enablement: true`, so the first run on `main` turns Pages on and
sets its source to GitHub Actions.

The base path is never hardcoded: the Pages workflow passes `BASE_PATH=/<repository-name>/` from the
event, `vite.config.ts` reads it, and runtime code resolves URLs through `import.meta.env.BASE_URL`.
Local dev, `vite preview`, and the Playwright harness all run at `/`, and CI now proves the non-root
case as well.

### Content pack schema v0 (PROVISIONAL)

`src/schema/` — `primitives.ts`, `packV0.ts`, `validate.ts`, `index.ts` — transcribes the schema from
`docs/build_plan.md` v1.2 plus the per-view field list from `docs/view_canon.md`.
`src/packs/loadPack.ts` is the only place untyped JSON becomes a typed pack.

Validation is total and never repairs a pack: unknown keys rejected, unit vectors must be unit,
`beam_axis ⟂ lateral_axis`, `focus_cm` within `depth_cm`, sweep range unit matches sweep mode,
orientation frames coherent, dates real, cameras buildable, asset paths non-escaping, and every
cross-reference resolves — structure ids unique, parents present and acyclic, glTF node references
unique **and resolvable in the file**, echo labels, view structure lists, show/hide presets, sweep
structure order, view ids unique.

`meta.schema_version` is exact-match `"0"`.

### Interaction boundaries (build_plan v1.2)

Unchanged by the repair round, and re-verified by both reviews.

- The free cutter is runtime inspection state — the infinite oriented radial plane `{N, s}` relative
  to the interaction pivot `C`, `dot(N, X - C) = s`. A pack may seed it exactly once through optional
  `interaction.free_cut`, alongside pivot and initial camera/orientation. That block governs viewer
  defaults only and carries no provenance, because nothing in it is a clinical claim.
- **The free cutter is never stored in `views[]`.** No code path exists from `{N, s}` into a view, and
  `tests/unit/packSchema.test.ts` asserts a pack that tries it is rejected.
- `views[]` entries carry the full vetted probe pose. The clinical plane and wedge are derived from
  that pose — one source of truth, so the wedge on the model and the echo fan cannot disagree.

`contracts/viewer-core.md` pins the rest for wave 1c. None of it is implemented or stubbed in wave 0.

### Stub pack

`public/packs/stub/` — two nested boxes generated deterministically by `scripts/make-stub-assets.mjs`:
a glTF with an embedded buffer and a 32³ `raw-u8` label volume. Both "views" are explicitly synthetic,
non-clinical, and draft-flagged. The label volume deliberately keeps a rim of background voxels so the
reserved-background rule has something to check. No medical models, no invented clinical content.

### Contracts

Seven one-page contracts plus an index in `contracts/`.

### CI

`.github/workflows/ci.yml`, four jobs: **Typecheck, lint, tests** (now including the production
base-path check); **Pack schema and provenance** (schema, asset semantics, provenance completeness,
stub-asset reproducibility); **Visual regression**; **Repository guardrails** (`docs/` read-only,
no committed local absolute paths, no references to a synced planning tree).

### Visual regression — what is and is not gated

- Deterministic assertions gate from day one, on desktop and phone-portrait profiles: the WebGL
  canvas renders non-blank, the stub pack reaches `data-status="ok"`, the page loads with zero
  console errors, and — new this round — the shell survives a browser with WebGL disabled.
- The `toHaveScreenshot` comparison **skips itself** when no baseline exists and activates
  automatically once one is committed. `updateSnapshots: 'none'`, so it never silently writes a
  baseline and reports green.
- Running the CI workflow manually (`workflow_dispatch`) seeds Linux baselines and uploads them as an
  artifact. That step no longer masks failure.

## Files changed

33 files between the previous target `8705186` and the current target `fdf6158`
(+2959 / −267), across four commits: the Claude review record (`c5b380c`), the reconciliation
(`98209cd`), the repair (`61767ea`), and the owner-decision changes (`fdf6158`). One handoff-only
commit (`2036ab8`) sits between the last two and changes no implementation file.

New this round:

```
LICENSE
scripts/check-base-path.ts
scripts/check-docs-guard.sh
scripts/lib/packAssets.ts
scripts/lib/placeholders.ts
tests/unit/docsGuard.test.ts
tests/unit/loadPack.test.ts
tests/unit/packAssets.test.ts
tests/unit/schemaInvariants.test.ts
tests/visual/no-webgl.spec.ts
handoffs/reviews/00-wave0/8705186-claude.md
handoffs/reviews/00-wave0/8705186-reconciliation.md
```

Modified this round: `src/schema/{primitives,packV0,validate}.ts`, `src/viewer/HelloViewer.tsx`,
`src/styles.css`, `scripts/{validate-packs,check-provenance,make-stub-assets}.*`,
`scripts/lib/discoverPacks.ts`, `.github/workflows/{ci,pages}.yml`,
`.github/ISSUE_TEMPLATE/work-item.yml`, `contracts/echo-renderer.md`, `package.json`,
`README.md`, `CLAUDE.md`, `AGENTS.md`, `handoffs/README.md`, `public/packs/README.md`.

## Verification

Run locally on 2026-08-16 against the tree committed as `fdf6158`, the current target.

| Check | Result |
|---|---|
| Typecheck | `npm run typecheck` — pass |
| Lint | `npm run lint` — pass, 0 problems |
| Unit tests | `npm run test` — **100 passed**, 5 files, 0 failed (was 20 in 1 file before the repair round) |
| Build | `npm run build` — succeeded, `✓ built in 1.25s` |
| Relevant CI | Run 31975408586 on `fdf6158` — **success**, all four jobs. Earlier runs this round, all success: 31973776415 on `c5b380c` (review record), 31974633604 on `61767ea` (repair), 31974797428 on `2036ab8` (handoff). |

Additional checks at the same tree:

| Check | Result |
|---|---|
| Full local gate | `npm run verify` — pass (typecheck, lint, 100 tests, pack schema, provenance) |
| Pack schema | `npm run validate:packs` — `1 pack(s) valid against schema v0` |
| Provenance | `npm run check:provenance` — `Provenance and attribution complete for 1 pack(s)` |
| Production base | `npm run check:base-path` — `ok production base "/base-path-check/" reaches index.html, the bundle, and pack URLs`; the same step passed in CI |
| Visual suite | `npm run test:visual` — **8 passed, 2 skipped** locally and in CI (10 tests; the 2 skips are the screenshot comparison, no baseline yet) |
| `docs/` guard | `tests/unit/docsGuard.test.ts` — 10 cases against real git history: initial-sync additions pass, a same-PR edit or deletion fails, a worker edit fails, a docs-only `docs/sync-*` PR passes, a `docs/sync-*` PR carrying a source change fails, near-miss branch names fail |
| Stub determinism | `npm run gen:stub-assets` then `git diff` — assets and `pack.json` byte-identical |
| `WORKFLOW.md` byte-identity | still a verbatim substring of its source section in `docs/build_plan.md` — checked programmatically |
| `docs/` untouched | no change to `docs/` in any commit this round |
| Review records untouched | no change to either published review; both remain immutable |
| Guardrail greps | committed-path and planning-tree patterns both clean locally, and the Repository guardrails CI job is green |

## Decisions made

- **Schema v0 implemented as written** — not frozen, simplified, or extended. One controlled revision
  to v1 is expected after the wave 1 technical slice review.
- **Validation refuses rather than repairs**, and this round closed the gaps where it silently
  accepted incoherent data instead.
- **Base path derived, never hardcoded** — and now proven by a check rather than asserted.
- **`main` was created as an empty root commit** so the branch had a base and `docs/` could arrive
  inside the pull request.
- **Handoffs are per work item, never global.** Review records are immutable and target-keyed.
- **Five schema/contract edits were authorized by the reconciliation**, each only as enforcement of
  an already-stated invariant. Anything requiring a design choice was deferred instead.
- **AGPL-3.0-only for the code**, chosen by the owner. Content licensing is a separate, unaffected
  layer.
- **`docs/` gets exactly one sync route**, `docs/sync-*` plus docs-only, and the guard that enforces
  it lives in a tested script rather than untested workflow YAML.

## Decisions needed from owner

Decisions 1–4 are resolved above. Two remain, and neither blocks the verification reviews.

5. **Two-role vetting.** Should schema v1 require both a fellow and an attending before
   `status: vetted`? `docs/mvp_scope.md` and `docs/view_canon.md` imply both; `docs/build_plan.md`
   qualifies the attending with "if available" and records that attendings are still being scouted.
   Deferred rather than encoded, because a hard gate could make it impossible to mark anything vetted.
6. **Deploy gating and branch protection.** The deploy now runs typecheck, lint, and unit tests; the
   visual suite and the pull-request-only `docs/` guard are deliberately not duplicated there. Should
   the deploy additionally wait on the full CI workflow, and should `main` get required checks,
   required pull requests, and force-push/deletion blocks?

## Maintainer actions outside this pull request

- ~~Create the labels the issue forms reference.~~ **Done** at owner request:
  `work-item`, `contract-change`, and `needs-planning-decision` now exist alongside `bug`, so the
  forms apply them instead of silently dropping them. This was repository state outside the pull
  request, so it is recorded here rather than in a commit.
- Branch protection for `main` — still outstanding (owner decision 6).

## Known limitations and deferred work

- **Two schema areas remain deliberately minimal**, reserved for the v1 revision: `views[].family`
  and `view_id` are free-form strings (`docs/view_canon.md` is DRAFT, so enumerating its A1–F2
  taxonomy would freeze draft clinical content into code), and `echo_tuning` is an open bag of
  scalars with `emphasis` a nullable string (the renderer's knob names come from wave 1b; emphasis
  vocabulary is assigned at vetting).
- `real_clip_slot` is required and must be `null` in v0.
- **Deferred review findings**, with reasons, in the reconciliation: two-role vetting (D1),
  `.glb`/KTX2 semantic inspection (D3), full glTF resource-graph walking (D4), committed visual
  baselines (D5), `webglcontextlost` and render-on-demand (D6), `npm run verify` not running the
  build (D7), loader cancellation/race tests and pack-directory-name agreement (D8), branch
  protection (D10). **D2 — the post-merge `docs/` sync route — is no longer deferred**; the owner
  decided it and it landed in `fdf6158`. **D9 — label creation — is done.**
- **No committed screenshot baselines.** The comparison is skipped, not enforced, until Linux
  baselines land in wave 1.
- The hello-world viewer is a build-and-deploy smoke test. viewer-core, the echo renderer, the view
  rail, provenance UI, authoring mode, and the real app shell are all later waves.
- This work item predates the issue templates, so it has no GitHub issue number and is named
  `00-wave0.md`. Later work items take `<work-item-id>-<slug>` with a dispatcher-assigned id.

## Blockers

None blocking further work. The branch is pushed, the pull request is open and mergeable, and CI is
green on the new target `fdf6158`.

The pull request is **not ready to merge**: the repaired target has not yet been independently
verified. The three decisions that were merge gates are now resolved, so verification is the only
remaining gate.

## Exact next action

1. **A fresh Claude review session and a fresh Codex review session** each independently review exact
   target `fdf6158e45c3ba0f1368935f3f61358f24eb7440` — not the latest branch head — without reading
   the other's record first, and publish only
   `handoffs/reviews/00-wave0/fdf6158-claude.md` and `handoffs/reviews/00-wave0/fdf6158-codex.md`.
   Each should confirm the 20 repairs plus the two owner-decision changes, and re-check whether any
   deferred finding has become urgent. Neither reviewer may be the session that implemented them.
2. If either verification raises new accepted findings, reconcile again as
   `handoffs/reviews/00-wave0/fdf6158-reconciliation.md` and repair; otherwise the work item is ready
   to land.
3. **Owner:** answer decisions 5 and 6 when convenient — neither blocks the merge.
4. Merge only after both verification verdicts are clear and required CI is green. Merging publishes
   the site; confirm the Pages deployment succeeded before dispatching wave 1.
5. **After merge:** the planning session corrects the repository-name spelling in
   `docs/build_plan.md` via a `docs/sync-*` branch whose pull request changes nothing outside
   `docs/` — the route decision 4 opened. This is the only sanctioned way to change `docs/`.
6. **Before wave 1 fans out:** design the core screen. It has never been drawn — `docs/mvp_scope.md`
   "Design direction (core screen)" and the v1.2 interaction contract specify behaviour and layout
   intent in prose, but no visual design exists. Waves 1c and 1d are both UI and run in parallel, so
   without a design each will invent its own visual language and wave 2 integration becomes rework.
   Layout and interaction shell can be settled now; the echo panel's treatment should wait for a real
   frame from the 1b slice. Worth its own work item and handoff.

**Do not merge this pull request**, and do not start wave 1 work on this branch.

## Scope and privacy check

- No files under `docs/` were modified in any commit this round. They appear in this pull request
  only as the initial one-way sync, unchanged from source.
- The private planning workspace was not read from or written to during this round.
- Neither published review record was edited; both remain immutable evidence about target `8705186`.
- `WORKFLOW.md` remains byte-identical to its source section in `docs/build_plan.md`.
- No personal names, no collaborator institution or program affiliations, and no availability details
  anywhere in the repository. Clinical collaborators appear by role label only. The privacy rule was
  narrowed this round so that licence-required attribution of a third-party model's source stays
  possible — that is a different thing from identifying a collaborator.
- No secrets or tokens committed.
- No machine-specific absolute paths, and no references to a synced planning tree — both enforced
  mechanically by the Repository guardrails CI job, which is green.
