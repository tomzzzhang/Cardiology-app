# Project workflow

**Last Updated:** 2026-08-22 12:45 EDT

How work happens in this repository. Product intent, clinical context, decisions, and progress
live in the owner's planning folder. Code and executable checks live here.

## Sources of truth

| Material | Authority |
|---|---|
| Product intent, clinical context, decisions, research, progress | The planning folder |
| Code, tests, schemas, technical contracts, build configuration | This repository and its pushed history |
| Published app | `main`, after an intentional release |
| Active platform development | The persistent `dev` branch |

The Git checkout stays outside file-sync trees.

## Current mode: platform first

Build reusable platform capability before fitting it to final clinical workflow. Clinical
interviews, draft view definitions, and the MVP are future product inputs. They do not silently
become platform constraints.

Prototype work may use schema v0, synthetic fixtures, draft content, provisional metadata,
experimental controls, and unverified poses. Do not wait for clinical review, full content,
schema v1, final echo tuning, learner restrictions, or a finished provenance UI.

Desktop and laptop are the active interface and release target. Phone/touch UX is paused as a
separate later design project; retained responsive code and tests are evidence, not a current gate.

The current engine-plus-content-pack split is a useful platform architecture, not an irreversible
safeguard. Change reversible architecture when build evidence supports it; record the decision once
the replacement settles.

## Platform-build loop (`dev`)

1. Define one coherent capability or fix.
2. Inspect the relevant code and tests. Consult product or clinical documents only when the
   change touches their subject.
3. Build directly on `dev` and keep the change easy to revert.
4. Run the smallest gate that matches the change.
5. Commit and push a useful completed checkpoint. Update the planning log only when project
   state, a blocker, or the next step changed.

## Gates

| Situation | Gate |
|---|---|
| Ordinary platform work | `npm run check:fast` |
| Coherent platform milestone | `npm run verify` |
| Pack, schema, source, licence, or provenance change | Add `npm run check:content` (includes `check:frame-decoupling`) |
| Body-context registration or chest assets change | Add `npm run check:body-context` — a deterministic Python replay; needs the `cardiology-app` conda env and the gitignored BodyParts3D cache, so it is local-only and not in CI |
| Desktop UI or rendering change | Run the relevant targeted browser test and inspect that surface |
| Explicit desktop release candidate | `npm run verify:release` |
| Deferred phone/touch investigation | `npm run test:phone` only when explicitly resumed |
| Clinical content/status promotion | Manual clinical review gate; not a code checkpoint |

Tests protect stable mechanics, persistence and exports, data integrity, and observed
regressions. Temporary product choices should remain easy to change rather than being encoded as
permanent acceptance tests.

## Integration and release (`dev` to `main`)

Before advancing `main`, run the full automated and desktop browser suite, verify the deployable learner
bundle, complete applicable source/licence/provenance records, and inspect the release artifact.
Clinical review and schema freeze happen against an integrated prototype, not against each
engineering slice. Platform releases may contain honestly labelled `Draft` content; the later
review policy, not platform code, decides when `vetted` is truthful.

## Git rules

- Use one persistent `dev` branch for ongoing work and push useful checkpoints directly.
- Pull requests and issues are optional tools, never mandatory ceremony.
- Do not force-push shared history. Prefer `git revert <sha>` for rollback.
- Advance `main` only for an intentional publication checkpoint.
- Lightweight CI runs on `dev`. The full release gate runs before a `main` deployment.

## Safeguards that always apply

- Treat the repository itself as public distribution. Only commit assets whose redistribution and
  modification rights are established and compatible; uncertain-rights material stays local and
  ignored. A Pages allowlist does not make a Git commit private.
- Keep source, licence, attribution, and derivation records for every committed third-party asset.
- No PHI, patient uploads, secrets, or private collaborator context in the repository.
- **No imaging view defines the patient frame.** The frame is `+X` patient-left, `+Y` posterior, `+Z` superior, and it comes from a `body-context/v0` registration. `Level` holds body `+Z`. `scripts/check-frame-decoupling.ts` gates this.
- **The reference chest is scene context, never anatomy.** It is not pickable, not beam-dimmed, not capped by the cutter, and never part of heart bounds, pivot, framing or probe clearance.
- Label synthetic output `Simulated` and unreviewed content `Draft`. A free or arbitrary pose may
  not inherit a saved view's name or review state.
- Saved imaging views and runtime free poses stay distinct data states so experiments cannot
  overwrite authored content or inherit a review claim.
