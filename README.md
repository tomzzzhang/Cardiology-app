# Cardiology app

**Updated:** 2026-08-19 06:27 EDT

A free, browser-based teaching tool where a pediatric cardiology trainee picks a heart, rotates
and cuts a labelled 3D model, and for any standard echo view sees exactly where that cut plane
sits on the model — with a simulated echo image alongside and scrubbable sweeps.

Education only. Not diagnostic. Every echo image in this app is **simulated**, never a recording
of a patient, and the app never accepts user-uploaded or arbitrary patient images.

**Status:** the Normal-heart technical slice is deployed and live. The app loads a real ingested
heart pack, renders it in 3D with per-structure colouring and a solid-capped free cut plane,
draws the probe and its sector, and renders a simulated echo for the selected view from the same
probe pose the wedge is built from. Three clinical views are authored and draft-flagged, reachable
by `?view=`; two were deliberately refused, and the pack says why. There is no view rail yet —
that, and the annotated sweep scrubber, are the next objective (wave 1d).

A **model picker** now offers every pack in the repository, grouped by what a pack is: labelled and
echo-capable, or Explore-only geometry. Explore-only packs are new in schema v0.1, which made
`echo_volume` optional so that unlabelled and moving geometry could be carried at all. The first
such pack **moves** — ten cine-MRI biventricular frames with a play/pause and a frame scrub in
Explore. Motion is not wired into the echo renderer and that is deliberate; see
[`contracts/viewer-core.md`](contracts/viewer-core.md).

Everything is **draft and unvetted**. Schema v0.1 is provisional, clinical review is deferred until
the build is substantially complete, and no view carries a clinical claim. **Nothing new is
published**: every pack added to the shelf is on the unpublished list and absent from the deployed
build, and any pack whose licence state is not `confirmed` is kept off it by CI rather than by
anyone remembering to.

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
| `npm run validate:packs` | Validate every pack against schema v0.1, including asset semantics |
| `npm run check:provenance` | Licence and attribution completeness |
| `npm run check:base-path` | Build with a sentinel base path and assert the output is prefixed |
| `npm run gen:stub-assets` | Regenerate the synthetic stub pack assets |
| `npm run ingest` | Run the model ingest pipeline over a source — see [`pipeline/`](pipeline/) |
| `npm run ingest:fetch` | Fetch and checksum-verify a raw source asset without ingesting it |

## Architecture

An **anatomy-agnostic engine** plus **self-contained versioned content packs**. Nothing in the
engine hardcodes lesion names or counts; adding a lesion means authoring a pack.

```
src/schema/     content-pack schema v0.1 (provisional) and its validator
src/packs/      pack-loader — the only place JSON becomes a typed pack
src/viewer/     viewer-core: orbit, the free cutter and its handles, stencil caps,
                the probe indicator and its control pad, the beam-dim highlight,
                the cine axis for keyframed geometry
src/echo/       echo-renderer: probe frame, the three shader passes, the echo panel
pipeline/       Python model ingest — split, label, decimate, voxelise, author views,
                and a geometry-only path for unlabelled sources
shared/         the few constants the pipeline and the viewer both have to agree on
public/packs/   shipped packs, one directory each
scripts/        pack validation, provenance check, base-path check, stub asset generation
contracts/      one-page module contracts
tests/unit/     schema, loader, asset semantics, plane algebra, orbit, echo acoustics
tests/visual/   Playwright suite against a production build
tests/perf/     measurement harnesses that report numbers rather than asserting them
```

### The one boundary that matters

Two things look similar on screen and are not the same:

- The **free anatomical cutter** is an infinite oriented plane `{N, s}` relative to the
  interaction pivot `C`. It is runtime inspection state, the learner moves it freely, it makes no
  clinical claim, and it is **never stored in `views[]`**. A pack may seed it once, via optional
  `interaction.free_cut`.
- The **vetted echo wedge** is a finite sector derived from a saved probe pose in `views[]`. The
  plane and the wedge derive from that one pose, so the wedge on the model and the echo fan cannot
  disagree.

Data flows **probe → cutter and never the reverse**. The cutter has a mode in which it follows the
selected view's imaging plane as the sweep scrubs, and a free mode in which it claims no
relationship to the view; which one is in force is named on screen at all times. Nothing a learner
can reach writes to `views[]`.

The probe can be **unlocked** and turned by hand, off the view's saved sweep track. That is a
deliberate exception, paid for by labelling rather than by hiding: the echo keeps rendering, and
the moment the probe has actually moved the panel withdraws the view's name and its draft flag and
says the plane is unvetted. Locking again discards the free pose, so the probe returns to the
saved track exactly. See [`contracts/README.md`](contracts/README.md).

## Deployment

`main` deploys to GitHub Pages through `.github/workflows/pages.yml`. A project site is served
from `/<repository-name>/`, so the workflow passes `BASE_PATH` to the build and runtime code
resolves URLs through `import.meta.env.BASE_URL`. Neither value is hardcoded — local dev,
`vite preview`, and the Playwright harness all run at `/`.

Deep links use query params; the site is fully static, with no backend and no accounts. The full
scheme (`?a=`/`?v=`/`?s=`) is wave 2. What is wired today:

| Param | What it does |
| --- | --- |
| `?mode=explore` | Open in Explore — the heart model alone, no probe and no echo panel. Echo is the default. |
| `?view=<view_id>` | Select a view by id or index, until the view rail exists. |
| `?pack=<pack_id>` | Select a pack. Written back as the model picker is used. |
| `?freeze=1` | Stop animation, for reproducible frames. |
| `?polar=<scale>` | Scale the echo renderer's internal polar working resolution. A measurement control. |

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
