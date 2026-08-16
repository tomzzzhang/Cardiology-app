# Cardiology app

A free, browser-based teaching tool where a pediatric cardiology trainee picks a heart, rotates and
cuts a labelled 3D model, and for any standard echo view sees exactly where that cut plane sits on
the model — with a simulated echo image alongside and scrubbable sweeps.

Education only. Not diagnostic. Every echo image in this app is **simulated**, never a recording of a
patient, and the app never accepts user-uploaded or arbitrary patient images.

**Status: wave 0.** Scaffold, CI, Pages deploy, content-pack schema v0 + validator + stub pack, and
the module contracts. The viewer is a hello-world scene; the real viewer, echo renderer, and view
rail come in wave 1.

## Read first

| Document | What it is |
| --- | --- |
| [`docs/mvp_scope.md`](docs/mvp_scope.md) | Product scope. **LOCKED.** |
| [`docs/build_plan.md`](docs/build_plan.md) | Build specification, v1.2. Authoritative. |
| [`docs/view_canon.md`](docs/view_canon.md) | Clinical view/sweep canon. **DRAFT**, pending vetting. |
| [`WORKFLOW.md`](WORKFLOW.md) | How work is dispatched, branched, and landed. |
| [`handoffs/README.md`](handoffs/README.md) | The handoff protocol — one file per work item. |
| [`contracts/`](contracts/) | One page per engine module. Code against these. |

`docs/` holds one-way, privacy-scrubbed copies synced from the planning session. **Workers never edit
them**, and CI fails a pull request that does.

## Getting started

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run verify` | Typecheck, lint, unit tests, pack schema, provenance — the CI gate |
| `npm run test:visual` | Playwright suite (builds and previews the site) |
| `npm run test:visual:update` | Write screenshot baselines for the current platform |
| `npm run validate:packs` | Validate every pack against schema v0 |
| `npm run check:provenance` | Licence and attribution completeness |
| `npm run gen:stub-assets` | Regenerate the synthetic stub pack assets |

## Architecture

An **anatomy-agnostic engine** plus **self-contained versioned content packs**. Nothing in the engine
hardcodes lesion names or counts; adding a lesion means authoring a pack.

```
src/schema/     content-pack schema v0 (PROVISIONAL) and its validator
src/packs/      pack-loader — the only place JSON becomes a typed pack
src/viewer/     wave 0 hello-world scene; viewer-core lands in wave 1c
public/packs/   shipped packs, one directory each
scripts/        pack validation, provenance check, stub asset generation
contracts/      one-page module contracts
tests/unit/     schema and validator tests
tests/visual/   Playwright visual-regression harness
```

### The one boundary that matters

`docs/build_plan.md` v1.2 separates two things that look similar on screen and are not the same:

- The **free anatomical cutter** is an infinite oriented plane `{N, s}` relative to the interaction
  pivot `C`. It is runtime inspection state, the learner moves it freely, it makes no clinical claim,
  and it is **never stored in `views[]`**. A pack may seed it once, via optional `interaction.free_cut`.
- The **vetted echo wedge** is a finite sector derived from a saved probe pose in `views[]`. In
  learner mode only the view rail and sweep scrubber move it. The plane and the wedge are derived
  from that one pose, so the wedge on the model and the echo fan cannot disagree.

The only link is one-way and copy-only: **Align free cut to echo view** copies the echo plane into
the cutter, and later free movement never writes back. See [`contracts/README.md`](contracts/README.md).

## Deployment

`main` deploys to GitHub Pages through `.github/workflows/pages.yml`. A project site is served from
`/<repository-name>/`, so the workflow passes `BASE_PATH` to the build and runtime code resolves URLs
through `import.meta.env.BASE_URL`. Neither value is hardcoded — local dev, `vite preview`, and the
Playwright harness all run at `/`.

Deep links use query params (`?a=<anatomy>&v=<view>&s=<sweep-pos>`); the site is fully static, with
no backend and no accounts.

## Contributing

Read [`WORKFLOW.md`](WORKFLOW.md) and [`handoffs/README.md`](handoffs/README.md). One branch per
session per work item (`feat/NN-slug`), branched from `main`; open a pull request and stop — workers
do not merge their own. Each work item owns exactly one handoff file, `handoffs/<issue>-<slug>.md`,
updated and pushed before handback. Workers never change the schema or the contracts; interface
changes route through the planning session via the
[contract-change issue template](.github/ISSUE_TEMPLATE/contract-or-schema-change.yml).

No personal names, program names, availability details, or machine-specific absolute paths belong in
this repository. Vetter names are consent-gated; role labels are used until consent is recorded. CI
enforces the path and privacy guardrails.

## Licensing

Model provenance and licence terms are carried per pack and rendered in-app; CI fails the build on
incomplete attribution. Third-party models arrive under their own licences (the Alberta 3D Heart
Library is CC BY-NC 4.0), and the non-commercial red lines in `docs/build_plan.md` bind the product.

> **Open item for the repository owner:** this repository has no code `LICENSE` file yet. Wave 0
> deliberately did not choose one — it is a decision for the owner, not the build worker. Until one
> is added, the code is under default copyright.
