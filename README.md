# Cardiology app

**Last Updated:** 2026-08-22 14:47 EDT

A free, browser-based teaching tool where a pediatric cardiology trainee picks a heart, rotates
and cuts a labelled 3D model, and for any standard echo view sees exactly where that cut plane
sits on the model — with a simulated echo image alongside and scrubbable sweeps.

Education only. Not diagnostic. Every echo image in this app is **simulated**, never a recording
of a patient, and the app never accepts user-uploaded or arbitrary patient images.

**Status:** platform-first development is active on `dev`. The app loads a real ingested heart
pack, renders it in 3D with per-structure colouring and a solid-capped free cut plane, draws the
probe and its sector, and renders a simulated echo for the selected view from the same probe pose
the wedge is built from.

The scene is rendered in a **patient/body frame**: `+X` patient-left, `+Y` posterior, `+Z`
superior, with anterior at `-Y`. Those axes were measured from a whole-body reference rather than
declared, and `Level` holds body `+Z`. **No imaging view defines the frame.** The apical
four-chamber used to — saving it repointed the levelling axis and the authoring surface said "sets
z axis" — and that is removed;
[`scripts/check-frame-decoupling.ts`](scripts/check-frame-decoupling.ts) gates it repository-wide.
Authored views, sweeps, saved slots, free poses and the echo simulation all stay in the pack's own
MODEL space and are converted at the point of use.

A **registered adult reference chest** (BodyParts3D 4.0: skin, ribs, sternum, thoracic spine,
lungs, diaphragm, clavicles) can be drawn around the heart in true millimetres, bound to the pack
by a rigid, unit-scale registration in a separate `body-context/v0` document. It is scene context
and structurally cannot become anatomy: not pickable, never beam-dimmed, never capped by the
cutter, and never part of heart bounds, pivot, default framing or probe clearance. It is off by
default, and a load failure leaves the heart and the echo working.

The composite is measured and its limits are published rather than smoothed: placement is
anatomically right (apex at the midclavicular line, about two thirds of the heart left of midline,
nothing behind the spine or outside the skin), while the **cardiothoracic ratio is 0.543 against
0.491 for the source's own native pair**, above the 0.50 normal threshold, because the
population-average heart is 14 mm wider than the heart that chest was built around. Neither body is
scaled to hide it. This is a **reference composite, not a patient and not clinical ground truth**.

`normal-rodero` is at **v0.1.4 with ten Draft views** — B1, B4, C1, C2, F1 and a non-clinical
ingest reference pose, plus A3, B2, B3 and B5 placed through a MEASURED acoustic window by
`pipeline/acoustic_windows.py`: the transducer stands on the registered chest wall and its whole fan
is cast against the ribs, the costal cartilages, the sternum, the clavicles and the lungs, and a
window counts as open only when the centre of the sector reaches cardiac tissue without crossing
bone or air. A3 is the subcostal view the heart-only substrate could not support at all.
`normal-vhl-heart0102-chambers` is at **v0.1.1 with seven Draft views**, six of them placed the same
way, its valve orifices recovered from where two lumen labels touch because that source has no
valve-ring geometry. Every one of those poses carries the same caveat: the chest is an adult male's,
so the interspace it names is an adult interspace and is not age-correct. The corrected review poses were adopted into the pack, and the apertures of
B1, B4 and C2 were then migrated back along their own beams to the reference chest wall, preserving
each imaging plane exactly while depth and focus grew by the retreat. F1 was deliberately NOT
migrated: reaching the skin needs a 73.7 mm retreat and a 22.19 cm depth, outside adult
transthoracic range, which says that plane needs reauthoring rather than sliding. Nothing here is
clinically reviewed; every view remains `draft`.

The flag-gated authoring build can place and save probe poses, export/import local overrides, and
reach Echo on a volume-less pack. Choosing a populated slot applies it immediately; camera, wedge,
cut plane and simulated echo move on one gently eased clock, and unauthored intermediate frames
cannot be saved. An authoring-only **Prevent auto-rotation** toggle suppresses the automatic camera
turn while probe, cut plane and live echo still move. A depth rocker grows or shortens the current
local fan in 0.5 cm steps. The surface opens at **None — full heart**. On a saved-view landing an
enabled Echo-plane cut opens toward the camera; manual Reverse stays sticky until the next
app-driven change. The echo panel carries a calibrated one-centimetre dot scale driven by the same
live depth.

The **view rail and canonical sweep scrubber were superseded by owner decision (2026-08-21)** and
are not being built. Views remain reachable by `?view=` in the learner build and by the authoring
selector; how a learner picks a view is an open question, not a finished one.

The active product surface is desktop/laptop. Phone and touch UX are paused for a dedicated later
design pass and do not gate platform checkpoints or the current release workflow.

A **model picker** offers a curated working set, grouped by what a pack is: labelled and
echo-capable, or Explore-only geometry. The repository still retains and validates every research
pack. BodyParts3D is the one Explore-only model currently offered; four poorer geometry-only packs
are preserved with their assets and provenance but withdrawn from the picker. Picker visibility is
not deletion, publication approval, or a licence decision. Explore-only packs are supported by
schema v0.1, which makes `echo_volume` optional so unlabelled and moving geometry can be carried.
Motion is not wired into the echo renderer and that is deliberate; see
[`contracts/viewer-core.md`](contracts/viewer-core.md).

Everything is **draft and unvetted**. Schema v0.1 is provisional, and clinical review and schema v1
wait for the integrated prototype. The Pages release currently includes only `normal-rodero` and
the synthetic `stub`. The repository itself is also public distribution: future exploratory assets
without established redistribution rights must stay local and ignored, even when they are excluded
from the Pages build. Two pre-existing research packs (`motion-straus-us-patient01` and
`normal-alberta-neonatal`) are already in public history with unresolved rights; they remain off
Pages, are explicit temporary exceptions in the content check, and need a separate owner decision.

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
| `npm run dev:authoring` | Vite dev server with the flag-gated authoring surface |
| `npm run build` | Production build into `dist/` |
| `npm run build:authoring` | Production-check the primary authoring surface into `dist-authoring/` |
| `npm run check:fast` | Typecheck, lint, and unit tests — the normal platform gate |
| `npm run check:content` | Pack/schema integrity plus provenance, licence metadata and the per-pack geometry budget |
| `npm run check:pack-budget` | Derived assets per pack against the 15 MB budget, with over-budget packs recorded as named exceptions |
| `npm run check:probe-on-skin` | Every canon-family view of a context-bound pack has its transducer against the skin |
| `npm run check:absolute-paths` | Reject machine-specific paths before shared history |
| `npm run verify` | Fast platform gate plus learner and authoring production builds |
| `npm run verify:release` | Full content, non-root bundle, authoring-exclusion, and browser release gate |
| `npm run test:visual` | Desktop Playwright suite (builds and serves the site) |
| `npm run test:visual:update` | Write desktop screenshot baselines for the current platform |
| `npm run test:phone` | Deferred phone-portrait harness; manual only, not a current gate |
| `npm run validate:packs` | Validate every pack against schema v0.1, including asset semantics |
| `npm run check:provenance` | Licence and attribution completeness |
| `npm run check:base-path` | Build with a sentinel base path and assert the output is prefixed |
| `npm run gen:stub-assets` | Regenerate the synthetic stub pack assets |
| `npm run ingest` | Run the model ingest pipeline over a source — see [`pipeline/`](pipeline/) |
| `npm run ingest:fetch` | Fetch and checksum-verify a raw source asset without ingesting it |
| `npm run ingest:authoring` | Preview or explicitly apply one standard `authoring-slots/v1` pose to one existing draft pack view |

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
public/packs/   tracked content packs, one directory each; Pages ships an explicit allowlist
scripts/        pack validation, guarded authoring-export ingest, provenance and build checks
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
- The **saved echo wedge** is a finite sector derived from an authored probe pose in `views[]`. It
  may still be `draft`; review status is metadata rather than a different technical object. The
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
attribution. Both Git history and the deployed site are public distribution surfaces. A third-party
asset may enter Git only when redistribution and modification rights are established and its
attribution and derivation are recorded; uncertain-rights exploration stays outside Git.

Crediting a third party whose model a licence requires you to credit is required and is a
different thing from publishing a collaborator's identity, which needs consent.
