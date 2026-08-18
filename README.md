# Cardiology app

**Updated:** 2026-08-18 13:45 EDT

A free, browser-based teaching tool where a pediatric cardiology trainee picks a heart, rotates
and cuts a labelled 3D model, and for any standard echo view sees exactly where that cut plane
sits on the model — with a simulated echo image alongside and scrubbable sweeps.

Education only. Not diagnostic. Every echo image in this app is **simulated**, never a recording
of a patient, and the app never accepts user-uploaded or arbitrary patient images.

**Status:** the Wave 0 scaffold is in place — build and deploy pipeline, content-pack schema v0
with validators, a synthetic stub pack, the module contracts, CI, and tests. The viewer is still
a hello-world scene. The next objective is one real Normal-heart technical slice.

## Read first

| Document | What it is |
| --- | --- |
| [`WORKFLOW.md`](WORKFLOW.md) | The development loop and Git rules. |
| [`docs/mvp_scope.md`](docs/mvp_scope.md) | Product scope. Locked. |
| [`docs/build_plan.md`](docs/build_plan.md) | Technical architecture and the next slice. |
| [`docs/view_canon.md`](docs/view_canon.md) | Clinical view/sweep canon. Draft, pending review. |
| [`contracts/`](contracts/) | One page per engine module. |

## Getting started

```bash
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run verify` | Typecheck, lint, unit tests, pack schema, provenance — the normal gate |
| `npm run test:visual` | Playwright suite (builds and previews the site) |
| `npm run test:visual:update` | Write screenshot baselines for the current platform |
| `npm run validate:packs` | Validate every pack against schema v0, including asset semantics |
| `npm run check:provenance` | Licence and attribution completeness |
| `npm run check:base-path` | Build with a sentinel base path and assert the output is prefixed |
| `npm run gen:stub-assets` | Regenerate the synthetic stub pack assets |
| `npm run ingest` | Run the model ingest pipeline over a source — see [`pipeline/`](pipeline/) |
| `npm run ingest:fetch` | Fetch and checksum-verify a raw source asset without ingesting it |

## Architecture

An **anatomy-agnostic engine** plus **self-contained versioned content packs**. Nothing in the
engine hardcodes lesion names or counts; adding a lesion means authoring a pack.

```
src/schema/     content-pack schema v0 (provisional) and its validator
src/packs/      pack-loader — the only place JSON becomes a typed pack
src/viewer/     hello-world scene today; viewer-core lands with the slice work
public/packs/   shipped packs, one directory each
scripts/        pack validation, provenance check, base-path check, stub asset generation
contracts/      one-page module contracts
tests/unit/     schema, loader, and asset-semantics tests
tests/visual/   Playwright visual-regression harness
```

### The one boundary that matters

Two things look similar on screen and are not the same:

- The **free anatomical cutter** is an infinite oriented plane `{N, s}` relative to the
  interaction pivot `C`. It is runtime inspection state, the learner moves it freely, it makes no
  clinical claim, and it is **never stored in `views[]`**. A pack may seed it once, via optional
  `interaction.free_cut`.
- The **vetted echo wedge** is a finite sector derived from a saved probe pose in `views[]`. In
  learner mode only the view rail and sweep scrubber move it. The plane and the wedge derive from
  that one pose, so the wedge on the model and the echo fan cannot disagree.

The only link is one-way and copy-only: **Align free cut to echo view** copies the echo plane into
the cutter, and later free movement never writes back. See [`contracts/README.md`](contracts/README.md).

## Deployment

`main` deploys to GitHub Pages through `.github/workflows/pages.yml`. A project site is served
from `/<repository-name>/`, so the workflow passes `BASE_PATH` to the build and runtime code
resolves URLs through `import.meta.env.BASE_URL`. Neither value is hardcoded — local dev,
`vite preview`, and the Playwright harness all run at `/`.

Deep links use query params (`?a=<anatomy>&v=<view>&s=<sweep-pos>`); the site is fully static,
with no backend and no accounts.

## Licensing

**Code:** [GNU AGPL-3.0-only](LICENSE). Copyright (C) 2026 the Cardiology app project
contributors. Anyone who distributes or hosts a modified version must publish their source under
the same terms.

**Content is licensed separately and the code licence does not touch it.** Model provenance and
licence terms are carried per pack and rendered in-app; CI fails the build on incomplete
attribution. Third-party models arrive under their own licences (the Alberta 3D Heart Library is
CC BY-NC 4.0), and the non-commercial red lines in `docs/build_plan.md` bind the product.

Crediting a third party whose model a licence requires you to credit is required and is a
different thing from publishing a collaborator's identity, which needs consent.
