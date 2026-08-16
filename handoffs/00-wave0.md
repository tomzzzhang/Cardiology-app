# Handoff — Wave 0

**Last Updated:** 2026-08-16 17:51 ET
**Work Item:** Wave 0 — scaffold, CI, Pages, schema v0 + validator + stub pack, module contracts, `WORKFLOW.md`, issue templates. Dispatched directly, before the issue templates existed; no GitHub issue number.
**Branch:** `feat/00-wave0`
**Pull Request:** https://github.com/tomzzzhang/Cardiology-app/pull/1
**Implementation / Review Target SHA:** `61767ea306f2c9baa5770c87d67bd4d78572c46a`
**Status:** repaired; awaiting two independent verification reviews of the new target

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
- The new target `61767ea306f2c9baa5770c87d67bd4d78572c46a` supersedes `8705186` for review purposes.

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

30 files between the previous target `8705186` and the new target `61767ea`
(+1839 / −130), across three commits: the Claude review record, the reconciliation,
and the repair.

New this round:

```
scripts/check-base-path.ts
scripts/lib/packAssets.ts
scripts/lib/placeholders.ts
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

Run locally on 2026-08-16 against the tree committed as `61767ea`.

| Check | Result |
|---|---|
| Typecheck | `npm run typecheck` — pass |
| Lint | `npm run lint` — pass, 0 problems |
| Unit tests | `npm run test` — **90 passed**, 4 files, 0 failed (was 20 in 1 file) |
| Build | `npm run build` — succeeded, `✓ built in 1.28s` |
| Relevant CI | Run 31974633604 on `61767ea` — **success**, all four jobs. Earlier runs this round: 31973776415 on `c5b380c` (review record) — success. |

Additional checks at the same tree:

| Check | Result |
|---|---|
| Full local gate | `npm run verify` — pass (typecheck, lint, 90 tests, pack schema, provenance) |
| Pack schema | `npm run validate:packs` — `1 pack(s) valid against schema v0` |
| Provenance | `npm run check:provenance` — `Provenance and attribution complete for 1 pack(s)` |
| Production base | `npm run check:base-path` — `ok production base "/base-path-check/" reaches index.html, the bundle, and pack URLs`; the same step passed in CI |
| Visual suite | `npm run test:visual` — **8 passed, 2 skipped** locally and in CI (10 tests; the 2 skips are the screenshot comparison, no baseline yet) |
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
- **No code `LICENSE` chosen.** Deliberately left to the owner.

## Decisions needed from owner

None is answered here, and none blocked the repair round.

1. **Merging this pull request enables and publishes GitHub Pages.** `actions/configure-pages` runs
   with `enablement: true`, so the first run on `main` turns Pages on with no second confirmation.
   The repository is already public. Keep automatic, or drop `enablement` and enable by hand first?
   *(The Codex review recommends keeping it only once branch protection and full-CI deploy gating
   exist.)*
2. **The repository has no code `LICENSE` file.** Until one is added the code is under default
   copyright. Which licence, or is default copyright intended for now? *(Codex recommends MIT; not
   adopted, because licensing is an owner decision.)*
3. **Repository-name capitalization differs from the planned name.** `docs/build_plan.md` specifies
   `cardiology-app`; the repository is `Cardiology-app`, so the published URL will be
   `https://tomzzzhang.github.io/Cardiology-app/`. **Correction to an earlier version of this
   handoff:** it is not true that nothing hardcodes the spelling. The base path is derived, but the
   name is hardcoded in five places — three `source_url` values in `public/packs/stub/pack.json` and
   two `contact_links` URLs in `.github/ISSUE_TEMPLATE/config.yml`, where GitHub requires absolute
   URLs. A rename needs those updated. Rename, or update the plan? `docs/` was not edited.
4. **`docs/` sync route after merge.** Once `docs/` exists on `main` the guard blocks every change to
   it, including the planning session's own schema-v1 sync that `WORKFLOW.md` requires. What route
   should that sync take — a maintainer label, an actor allowlist, a commit trailer, or a separate
   protected path?
5. **Two-role vetting.** Should schema v1 require both a fellow and an attending before
   `status: vetted`? `docs/mvp_scope.md` and `docs/view_canon.md` imply both; `docs/build_plan.md`
   qualifies the attending with "if available" and records that attendings are still being scouted.
   Deferred rather than encoded, because a hard gate could make it impossible to mark anything vetted.
6. **Deploy gating and branch protection.** The deploy now runs typecheck, lint, and unit tests; the
   visual suite and the pull-request-only `docs/` guard are deliberately not duplicated there. Should
   the deploy additionally wait on the full CI workflow, and should `main` get required checks,
   required pull requests, and force-push/deletion blocks?

## Maintainer actions outside this pull request

- The labels `work-item`, `contract-change`, and `needs-planning-decision` referenced by the issue
  forms **do not exist** on the repository (only `bug` does), so GitHub silently drops them. Exact
  `gh label create` commands are in the reconciliation. Not done here: it is repository state outside
  this pull request.
- Branch protection for `main` (owner decision 6).

## Known limitations and deferred work

- **Two schema areas remain deliberately minimal**, reserved for the v1 revision: `views[].family`
  and `view_id` are free-form strings (`docs/view_canon.md` is DRAFT, so enumerating its A1–F2
  taxonomy would freeze draft clinical content into code), and `echo_tuning` is an open bag of
  scalars with `emphasis` a nullable string (the renderer's knob names come from wave 1b; emphasis
  vocabulary is assigned at vetting).
- `real_clip_slot` is required and must be `null` in v0.
- **Deferred review findings**, with reasons, in the reconciliation: two-role vetting (D1), the
  post-merge `docs/` sync route (D2), `.glb`/KTX2 semantic inspection (D3), full glTF resource-graph
  walking (D4), committed visual baselines (D5), `webglcontextlost` and render-on-demand (D6),
  `npm run verify` not running the build (D7), loader cancellation/race tests and pack-directory-name
  agreement (D8), label creation (D9), branch protection (D10).
- **No committed screenshot baselines.** The comparison is skipped, not enforced, until Linux
  baselines land in wave 1.
- The hello-world viewer is a build-and-deploy smoke test. viewer-core, the echo renderer, the view
  rail, provenance UI, authoring mode, and the real app shell are all later waves.
- This work item predates the issue templates, so it has no GitHub issue number and is named
  `00-wave0.md`. Later work items take `<work-item-id>-<slug>` with a dispatcher-assigned id.

## Blockers

None blocking further work. The branch is pushed, the pull request is open and mergeable, and CI is
green on the new target `61767ea`.

The pull request is **not ready to merge**: the repaired target has not yet been independently
verified, and owner decisions 1–3 remain merge gates.

## Exact next action

1. **A fresh Claude review session and a fresh Codex review session** each independently review exact
   target `61767ea306f2c9baa5770c87d67bd4d78572c46a` — not the latest branch head — without reading
   the other's record first, and publish only
   `handoffs/reviews/00-wave0/61767ea-claude.md` and `handoffs/reviews/00-wave0/61767ea-codex.md`.
   Each should confirm the 20 repairs and re-check whether any deferred finding has become urgent.
2. If either verification raises new accepted findings, reconcile again as
   `handoffs/reviews/00-wave0/61767ea-reconciliation.md` and repair; otherwise the work item is ready
   to land.
3. **Owner:** resolve decisions 1–3, and create the three missing labels.
4. Merge only after both verification verdicts are clear, required CI is green, and those decisions
   are resolved. Merging publishes the site — confirm the Pages deployment succeeded before
   dispatching wave 1.

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
