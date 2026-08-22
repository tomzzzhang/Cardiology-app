# Coding agents — start here

**Last Updated:** 2026-08-22 15:41 EDT

This is the repository's sole normative agent entrypoint. The current phase is
**platform-first development** on `dev`.

## Read and route

1. Read [`WORKFLOW.md`](WORKFLOW.md).
2. Inspect the current code and tests for the task.
3. Read only the contracts the task touches. Contracts describe current interfaces; they are
   not immutable product requirements during platform construction.
4. Consult `docs/` only when the task changes product scope, clinical content, or a documented
   architecture decision.

Clinical interviews, the view canon, and the MVP definition describe the eventual product. They
are directional inputs during platform work, not acceptance criteria for ordinary checkpoints.
Do not turn an interview finding or provisional clinical choice into a required schema field,
validator, test, UI restriction, or CI gate without an explicit owner decision.

The active interface target is desktop/laptop. Phone and touch UX are explicitly paused as a
separate later design workstream; they do not constrain current components or gate checkpoints.

**The AUTHORING build is the only active surface. The learner build is ARCHIVED.** *(Owner
decision, 2026-08-22.)* Work in the authoring build — `npm run dev:authoring`,
`npm run build:authoring` — and do not develop against the learner build until the owner says the
authoring build is good enough. The two had started to blur, and a pose that is fine as an
authoring draft is not the same thing as a view a learner should be shown; treating them as one
surface is what let a probe sitting 66 mm off the patient reach a learner-facing panel.

Archived means PAUSED, not deleted and not unguarded. The learner bundle still builds, and every
check that protects something other than product quality still runs and still gates:
`check:published-packs` and `check:authoring-absent` are licence and exposure controls, not
development targets, and they do not become optional because the surface they protect is paused.
They run in CI's `quality` job — every push to `dev` and to `main`, and every pull request — after
the two build steps, because both read `dist/`; and again in `npm run verify:release` and before a
`main` deployment. *(Corrected 2026-08-22: this paragraph claimed they "still run and still gate"
while they ran only in `verify:release` and before a `main` deployment, so nothing on `dev`
enforced either one. The CI steps were added rather than the claim being softened.)* What is
suspended is learner-facing UX work, learner polish, and treating the learner bundle as the thing
being iterated on.

## Platform work

- Work directly on `dev` in coherent, reversible units.
- `npm run check:fast` is the normal inner-loop check. Use `npm run verify` for a coherent
  platform milestone (it production-builds learner and authoring surfaces), `npm run check:content` when pack/schema/provenance material changes, `npm run check:body-context` when the registration or the chest assets change (local only: it needs the `cardiology-app` conda env and the gitignored source cache), and
  targeted browser checks only for the UI behavior being changed.
- Schema v0, draft packs, temporary controls, unverified poses, and experimental behavior may
  change freely on `dev`. Do not block platform work on clinical review, content completeness,
  schema v1, final provenance presentation, or learner-facing restrictions.
- Test stable platform mechanics, persistence and exports, data integrity, and observed
  regressions. Do not freeze temporary product choices in tests.
- Update a touched contract after an interface or behavior settles. A short-lived experiment
  does not require synchronous contract and product-document churn.

## Release and clinical gates

- `npm run verify:release` is the full local release gate. A `main` deployment runs the release
  checks again before publishing. Both currently exercise the desktop surface.
- Clinical review applies when content or review status is promoted, not to code-only platform
  checkpoints. The later review policy, not platform code, decides when `vetted` is truthful.
- The authoring-capable build is the primary platform work surface, and since 2026-08-22 it is the
  ONLY active one. Excluding authoring from the learner bundle is a release check, not a
  development restriction.

## Safeguards that always apply

- Treat every pushed commit as public distribution. Do not add an asset or derived binary to Git
  unless its source, redistribution/modification rights, attribution, and derivation are
  documented and compatible with this public repository. Uncertain-rights material stays in an
  ignored local workspace; commit metadata, checksums, or fetch instructions instead.
- No PHI, patient uploads, secrets, private collaborator context, or machine-specific absolute
  paths in committed material.
- **No imaging view may define the patient/body frame.** The frame is `+X` patient-left, `+Y` posterior, `+Z` superior, established by a `body-context/v0` registration and gated by `scripts/check-frame-decoupling.ts`. An acquisition window is not evidence for which way is up.
- **A transducer stands ON the patient.** Ultrasound does not cross an air gap, so a probe pose
  whose origin is off the skin images nothing and is not a view. `scripts/check-probe-on-skin.ts`
  gates every canon-family view of a pack that has a body context bound, by point-to-surface
  distance, with no exception list.
- **Evidence may describe a superseded pack revision.** Adopting a proposal must not require deleting the evidence for it; `check-view-candidates` validates a superseded set against the pack at its bound git revision and says so.
- Shared and user-facing material labels synthetic output `Simulated` and unreviewed content
  `Draft`. A free or working pose must not inherit a saved view's name or review state.
- Keep changes reversible. Do not force-push shared history or discard unknown work.

## Recording work

Commit and push useful completed checkpoints. Update the planning folder's `progress_log.md` only
when a checkpoint changes project state, a blocker, or the exact next step; do not create log
entries for incomplete experiments. Never claim a test, CI job, push, or deployment succeeded
without verifying it.

**Documentation and the log are HANDBACK work, not build-run work.** Sweeping the documents and
writing the `progress_log.md` entry happen at handback, or when the owner asks for them — not
partway through a build run, and not as a reflex at the end of every commit. A build run's
documentation duty is the material its own change makes wrong: the contract it altered, the
observation it recorded, the claim it falsified.

**Never bump a `Last Updated` line on a file whose substance did not change.** The line means "last
known good state" and a repository-wide bump makes it mean "somebody ran a command", which is not a
fact anyone can use. Six commits on 2026-08-22 each restamped 22 to 26 files that they had not
otherwise touched, against a rule the owner's workflow documents already carried and this
repository did not — which is why it is written here now. A diff whose only content is a date is
noise in the history and hides the files that did change.
