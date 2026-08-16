# Reconciliation — Wave 0

**Last Updated:** 2026-08-16 17:36 ET
**Target Pull Request:** https://github.com/tomzzzhang/Cardiology-app/pull/1
**Target Implementation SHA:** `8705186abc1a0c533758dfde139a35acb8f716ca`
**Reviews reconciled:** `8705186-codex.md`, `8705186-claude.md`
**Implementation owner:** Claude Code — exactly one implementer for the accepted list below.

## Owner authorization recorded

The owner instructed, in session: implement the accepted repairs that need no unresolved product,
clinical, licensing, publication, or repository-identity decision; do not silently choose an owner
decision; bound the work to Wave 0; add focused tests for every repaired invariant; do not merge.
Anything touching those reserved categories is deferred below as a question, not answered here.

## Method

Nothing was accepted because a reviewer raised it. Every finding from both reviews was re-checked
against the frozen target before being classified. Implementation files are byte-identical between
`8705186` and the current branch head (`git diff 8705186..HEAD` over `src`, `scripts`, `tests`,
`contracts`, `.github`, `public`, `docs`, and the root configuration is empty), so probes run at the
head describe the target.

Probes run for this reconciliation, all against the frozen schema:

```
ACCEPTS  orientation {up:+y, anterior:+y, patient_left:+y, handedness:right}
ACCEPTS  orientation with handedness flipped to "left" on a right-handed stub frame
ACCEPTS  IsoDate "2026-13-45" / "2026-02-30" / "0000-00-00"
ACCEPTS  AssetPath "..\outside.gltf" / "%2e%2e/outside.gltf" / "C:\x.gltf" / "a.gltf?x=1" / "a.gltf#f" / "a//b.gltf"
ACCEPTS  camera position === target, and up parallel to the view direction
```

Also confirmed by direct inspection: `scripts/validate-packs.ts` checks only that the two referenced
asset files exist — no glTF node-name resolution and no `raw-u8` label-value check; the shipped stub
volume contains values `{0, 1, 2}` with the shell label reaching Chebyshev 0.9 while the shell mesh
reaches 1.0; `.github/workflows/ci.yml:105` seeds baselines with `|| true`; the repository name is
hardcoded in five places (`public/packs/stub/pack.json` ×3 provenance URLs, `.github/ISSUE_TEMPLATE/config.yml`
×2 contact links); and the labels `work-item`, `contract-change`, and `needs-planning-decision`
referenced by the issue forms do not exist on the repository (`bug` does).

Where the two reviews overlap they agree, and both verified the same green local gate. The
substantive difference is scope: Codex requires schema and governance hardening before merge; Claude
ranks a deployed-behaviour defect highest and flags one schema change as needing explicit
authorization. Both readings are reflected below.

## Accepted repairs

Bounded to Wave 0. Every item is mechanical, enforces something the specification or the schema's own
stated intent already asserts, and needs no reserved decision. Each carries a focused test unless the
item is documentation.

| # | Repair | Source | Files |
|---|---|---|---|
| R1 | Render a visible fallback when WebGL context creation fails, keeping the shell, pack status, and non-diagnostic disclaimer mounted | Claude C1 (HIGH), Codex normal | `src/viewer/HelloViewer.tsx`, new Playwright spec |
| R2 | CI step that builds with a sentinel `BASE_PATH` and asserts the emitted HTML, bundle, and pack URL are base-prefixed | Claude C2, Codex normal | `scripts/check-base-path.ts`, `.github/workflows/ci.yml` |
| R3 | Loader failure-path unit tests with a stubbed `fetch` | Claude C7, Codex normal | `tests/unit/loadPack.test.ts` |
| R4 | `docs/` guard arms inside the initial-sync pull request: a *modification* to `docs/` anywhere in the PR range fails even while the stand-down applies | Claude C4, Codex 1 (partial) | `.github/workflows/ci.yml` |
| R5 | Restrict the Pages deploy to the default branch so `workflow_dispatch` cannot publish another branch | Claude C5 | `.github/workflows/pages.yml` |
| R6 | Run typecheck, lint, and unit tests in the Pages build job before upload, alongside the pack and provenance checks already there | Claude C6, Codex 2 (in-workflow half) | `.github/workflows/pages.yml` |
| R7 | `AssetPath` rejects backslashes, encoded dot segments, scheme/drive prefixes, query and fragment text, empty segments, and `.`/`..` in any form | Claude C3, Codex 7 | `src/schema/primitives.ts`, tests |
| R8 | `meshes.orientation` must be a signed permutation of three distinct axes, with `handedness` matching the frame | Codex 5 | `src/schema/packV0.ts`, tests |
| R9 | `IsoDate` must be a real calendar date, not merely digit-shaped | Codex normal | `src/schema/primitives.ts`, tests |
| R10 | Reject degenerate camera states: position equal to target, or `up` parallel to the view direction | Codex normal | `src/schema/packV0.ts`, tests |
| R11 | Validator resolves every `mesh_node` against the referenced `.gltf` node names and enforces the embedded/existing external-resource policy | Codex 4a | `scripts/validate-packs.ts`, tests |
| R12 | Validator rejects `raw-u8` voxel values not declared in `labels[]`; value `0` is reserved as background and documented | Codex 4b | `scripts/validate-packs.ts`, tests |
| R13 | Restore the echo formula in the contract to the operator the build plan specifies | Codex 6 | `contracts/echo-renderer.md` |
| R14 | Remove `\|\| true` from baseline seeding so a partial or failed seed cannot upload as success | Codex | `.github/workflows/ci.yml` |
| R15 | Placeholder detection anchored at a token boundary instead of exact-match only | Codex | `scripts/check-provenance.ts`, tests |
| R16 | Narrow the institution/program prohibition to *private collaborators'* affiliations, so licence-required source attribution stays possible | Codex | `CLAUDE.md`, `AGENTS.md`, `handoffs/README.md`, `README.md` |
| R17 | Handoff filenames use a dispatcher-assigned work-item id, not a GitHub issue number that cannot exist when the form is filled | Codex | `.github/ISSUE_TEMPLATE/work-item.yml`, `handoffs/README.md` |
| R18 | Make the stub fixture's documented claim match its actual label extents | Codex normal | `scripts/make-stub-assets.mjs`, `public/packs/README.md` |
| R19 | A pack directory missing `pack.json` becomes a collected failure line, not an uncaught throw | Claude C8 | `scripts/lib/discoverPacks.ts`, `scripts/validate-packs.ts` |
| R20 | `readSchemaVersion` recognizes a numeric `schema_version` so the version refusal message still fires | Claude C8 | `src/schema/validate.ts`, tests |

### Why the three schema and contract edits are authorized

Workers must not change schema or contracts. R7, R8, R9, R10 (schema) and R13 (contract) are accepted
only under the narrow reading that they **enforce the existing specification rather than extend it**:

- **R7** — `src/schema/primitives.ts` already declares that asset paths "are resolved relative to the
  pack directory" and "must not traverse outside the pack directory", and `contracts/pack-loader.md`
  states the loader "rejects absolute URLs and `..` traversal". The current refinement does not
  achieve that. Closing the escapes adds no new semantics; it makes the stated invariant true.
- **R8** — `docs/build_plan.md` requires an "orientation convention". A frame naming the same axis
  three times, or declaring a handedness its own axes contradict, is not a convention. The convention
  ordering is pinned by the shipped data, not chosen here: the stub declares
  `up:+y, anterior:+z, patient_left:+x, handedness:right`, which is right-handed only under the
  ordering (patient_left, up, anterior) = (x, y, z). The check is implemented against that ordering
  and documented in code; if the planning session intends another ordering, it is a one-line flip.
- **R9** — the field is documented as an ISO calendar date. `2026-02-30` is not one.
- **R10** — a camera whose position equals its target has no view direction, and an `up` parallel to
  that direction yields no basis. The field cannot mean what it says in those states.
- **R13** — this is a transcription defect, not a design choice. `docs/build_plan.md` specifies
  `echo = scatterer_amplitude(seeded) × PSF(depth, lateral) × specular(beam·normal at label boundaries) + boundary_reflection`;
  `contracts/echo-renderer.md` renders the third term as `+ specular(...)`. A contract may not
  contradict the specification it transcribes, and Wave 1b is dispatched against that contract. The
  contract is corrected to the specification's operator. No engineering judgment is applied to which
  form is physically preferable — that would be a planning decision, and the specification already
  states one.

Anything beyond these readings is deferred rather than decided here.

## Deferred findings

| # | Finding | Why deferred |
|---|---|---|
| D1 | Codex 3 — require a fellow **and** an attending before `status: vetted` | A schema semantic change owned by the planning session, and the sources conflict: `docs/mvp_scope.md` says "vetting pass (fellow + attending)" and `docs/view_canon.md` requires both to sign off, but `docs/build_plan.md` says "interpretation read from the clinical vetter (**+ attending if available**)" and records that imaging attendings are still being scouted. Encoding a hard two-role gate now could make it impossible to mark any view vetted. Route through a contract-change issue. |
| D2 | Codex 1 — a sanctioned planning-session route for `docs/` changes after this PR merges | Real and important: once `docs/` exists on `main`, the guard becomes a blanket ban, including on the schema-v1 sync `WORKFLOW.md` requires. But the mechanism (label, actor allowlist, commit trailer, protected path) is a repository-governance choice. Recorded as owner decision 4. R4 fixes only the half that needs no decision. |
| D3 | Codex 4 — KTX2 and `.glb` semantic inspection | No such asset exists in Wave 0. R11 covers `.gltf` JSON, which is what ships. Explicitly a tracked technical-slice gap, as Codex allows. |
| D4 | Claude C8 / Codex 4 — walking the full glTF resource graph (textures, external `.bin`) | R11 enforces the embedded-or-present policy; a full graph walk belongs to the Wave 1a model-pipeline tooling that will produce real assets. |
| D5 | Committed visual baselines | Wave 1, per the seeding plan already documented. Unchanged. |
| D6 | `webglcontextlost` handling, render-on-demand | viewer-core, Wave 1c. R1 covers only the fallback for a context that never exists. |
| D7 | `npm run verify` does not run `npm run build` | Cosmetic; CI runs the build as its own step. Noted, not changed, to keep the local gate fast. |
| D8 | Loader cancellation/race tests; pack-directory-name vs `meta.id` agreement | R3 covers the documented failure modes. Nothing in the specification requires the directory name to equal `meta.id`, so enforcing it would be a new rule. |
| D9 | Create the `work-item`, `contract-change`, `needs-planning-decision` labels | Confirmed missing. Repository state outside this pull request; a maintainer action, not a code change. Commands recorded under **Owner and maintainer actions**. |
| D10 | Branch protection and rulesets for `main` | Repository settings, not repository code. Owner action; recorded as owner decision 6. |

## Rejected findings

| # | Finding | Why rejected |
|---|---|---|
| X1 | Codex's answers to the three standing owner decisions — adopt MIT, rename to lowercase, keep auto-publish conditional on protection | A reviewer may recommend; it cannot decide. Licensing, publication, and repository identity are exactly the reserved categories. They remain questions below, with Codex's recommendation recorded as input. |
| X2 | Codex — "use a non-synced development checkout outside the Documents tree" as a repair | Already satisfied: this work runs in a checkout outside any synced tree. It is an environment condition with nothing to commit. |

## Correction to a claim in the builder handoff

`handoffs/00-wave0.md` states "Nothing in the repository hardcodes either spelling" of the repository
name. That is true of the **base path** only. The name is hardcoded in five places: three provenance
`source_url` values in `public/packs/stub/pack.json` and two `contact_links` URLs in
`.github/ISSUE_TEMPLATE/config.yml` (GitHub requires absolute URLs there). A rename would need those
updated. The handoff is corrected in the repair round; the reviews are immutable and are not edited.

## Unresolved owner decisions

Kept as questions. None is answered by this reconciliation, and none blocks the accepted list.

1. **Pages auto-enablement.** `actions/configure-pages` runs with `enablement: true`, so merging
   turns Pages on and publishes the site with no second confirmation. Keep it automatic, or drop
   `enablement` and enable Pages by hand first? *(Codex recommends keeping it only once branch
   protection and full-CI deploy gating are in place.)*
2. **Code licence.** The repository has no `LICENSE`; the code is under default copyright. Which
   licence, or is default copyright intended for now? *(Codex recommends MIT. Not adopted here.)*
3. **Repository-name capitalization.** The published URL will be
   `https://tomzzzhang.github.io/Cardiology-app/`, not the lowercase form in `docs/build_plan.md`.
   Rename the repository, or update the plan? If renamed, the five hardcoded occurrences above need
   updating. *(Codex recommends renaming to lowercase before the first public URL is relied upon.)*
4. **`docs/` sync route after merge (new, from D2).** Once `docs/` exists on `main` the guard blocks
   every change, including the planning session's own schema-v1 sync. What route should that sync
   take — a maintainer label, an actor allowlist, a commit trailer, or a separate protected path?
5. **Two-role vetting (new, from D1).** Should schema v1 require both a fellow and an attending
   before `status: vetted`, given that `docs/build_plan.md` qualifies the attending with "if
   available" and attendings are still being scouted?
6. **Deploy gating and branch protection (new, from D10 and Codex 2).** R6 puts typecheck, lint, and
   unit tests in the deploy path; the visual suite and the guardrail greps are deliberately not
   duplicated there. Should the deploy additionally wait on the full CI workflow, and should `main`
   get required checks, required pull requests, and force-push/deletion blocks?

## Owner and maintainer actions outside this pull request

- Create the three missing labels, or the issue forms will keep silently dropping them:

  ```
  gh label create work-item --description "Dispatched work item" --color 0e8a16
  gh label create contract-change --description "Requests a contract or schema change" --color d93f0b
  gh label create needs-planning-decision --description "Blocked on a planning-session decision" --color fbca04
  ```

- Configure branch protection for `main` (owner decision 6).

## Required verification for the repair round

The implementer must run and report actual results, not assertions:

- `npm run typecheck`, `npm run lint`, `npm run test` — including the new focused tests for R1, R3,
  R7, R8, R9, R10, R11, R12, R15, R20.
- `npm run verify` — the full local gate.
- `npm run build`.
- `npm run test:visual` — including the new WebGL-disabled spec.
- A production base check: build with a non-root `BASE_PATH` and confirm the emitted HTML, bundle,
  and pack URL are base-prefixed (this is R2's own script, run locally as well as in CI).
- `npm run gen:stub-assets` followed by a clean-tree check, since R18 touches the generator.
- Confirmation that `docs/` is unchanged, `WORKFLOW.md` remains a byte-identical substring of its
  source section, and the path and planning-tree guardrail greps are clean.
- CI green on the repair commit and on the handoff commit, read from GitHub.

## Next action after the repair round

The repair commit's full SHA becomes the new implementation/review target. Claude and Codex then
review that target independently, each writing only its own record keyed to the new SHA. Do not merge
until both verification reviews are clear, required CI is green, and owner decisions 1–3 are
resolved.
