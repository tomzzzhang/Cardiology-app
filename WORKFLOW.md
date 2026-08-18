# Project workflow

**Updated:** 2026-08-18 13:50 EDT

How work happens in this repository. Product intent, clinical context, decisions, and the
progress log live in the owner's planning folder; this file is the code-side operating rule
and matches the planning folder's `WORKFLOW.md`.

## Sources of truth

| Material | Authority |
|---|---|
| Product intent, clinical context, decisions, research, progress | The planning folder |
| Code, tests, schemas, technical contracts, build configuration | This repository and its pushed history |
| Published app | `main`, after an intentional stable release |
| Active development | The persistent `dev` branch |

The Git checkout stays outside any file-sync tree.

## One work cycle

1. **Plan.** Define one bounded task: goal, relevant files, constraints, acceptance checks,
   and what is deferred.
2. **Inspect.** Check `git status` and read the relevant code and tests before editing.
3. **Build.** Work directly on `dev`. Keep the change coherent. Do not manufacture issues,
   branches, review artifacts, or handoff documents unless they genuinely help.
4. **Verify.** Run the checks the change deserves. `npm run verify` is the normal gate; run
   `npm run test:visual` and look at the app in a browser when rendering or UI changed.
5. **Record.** Commit and push the checkpoint, then add one concise newest-first entry to the
   planning folder's `progress_log.md`: outcome, commit SHA, verification, next step.

A good checkpoint is small enough to understand, complete enough to revert, and pushed before
the session ends.

## Git rules

- One persistent `dev` branch for ongoing work.
- Push useful checkpoints straight to `origin/dev`. GitHub is the backup and audit trail.
- Pull requests and issues are optional, never mandatory.
- Do not force-push shared history. Prefer `git revert <sha>` to roll back.
- Advance `main` only for a stable publication checkpoint — normally a local fast-forward
  merge from `dev`, then a direct push.
- CI runs on pushes to both `dev` and `main`. GitHub Pages deploys only from `main`.

## Checks

| Command | What it covers |
|---|---|
| `npm run verify` | typecheck, lint, unit tests, pack schema, provenance |
| `npm run test:visual` | Playwright suite against a production build |
| `npm run build` | production build |
| `npm run check:base-path` | the deployed sub-path the Pages build uses |

## Safeguards that do not lapse

- The engine stays anatomy-agnostic; lesions are versioned content packs.
- The free anatomical cutter and the vetted echo wedge remain separate data and interaction
  paths. See `contracts/README.md`.
- Every model and view keeps source, licence, modification, and review provenance.
- Review states mean what they say: `draft` → `fellow_reviewed` → `vetted`. `vetted` requires
  both a pediatric-cardiology fellow and an imaging attending.
- Simulated echo is labelled simulated, and is judged by whether a trainee can learn from it.
- No PHI, and no interpretation of arbitrary patient images.
- Never publish collaborator identities or private context without consent.
