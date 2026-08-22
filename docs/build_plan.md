# Build plan — Cardiology app

**Last Updated:** 2026-08-22 10:33 EDT

> **Build specification.** Clinical collaborators are referred to by role, not name. Referenced `research/DR*.md` reports live in the owner's planning folder.

Status: **v1.6 — platform-first phase active** (2026-08-20). The MVP destination remains; the
current architecture is a starting point that may evolve with build evidence. Current work completes the reusable platform on `dev`; clinical review,
schema v1 freeze, final learner restrictions, and release qualification occur after an integrated
prototype exists. Earlier revisions and their evidence remain in Git history and `docs/observations.md`.

## Goal

Build a reusable anatomy, authoring, viewing, and simulated-echo platform that can later be shaped
into the `mvp_scope.md` release target. The release definition is the destination, not an acceptance
gate on each platform unit.

## Release ladder

1. **Platform completion** — probe placement through export-to-pack ingestion, the view rail and
   sweep scrubber, and an integrated authoring/learner path.
2. **Integrated Normal prototype** — one end-to-end Normal pack through authoring, viewer, echo,
   sweep, persistence, and learner surfaces.
3. **Desktop integration/release candidate** — clinical review, schema v1 freeze,
   provenance/licensing completion, full desktop browser verification, and a publication decision.
4. **Multi-anatomy MVP** — full Normal coverage, ASD, and d-TGA through the same platform.

## Anatomical substrate risk — RESOLVED

The risk was that candidate sources are blood-pool casts or fused surfaces: splitting an STL cannot create tissue that is not there, and a bloodpool-only mesh yields chamber lumens and an uninterpretable "echo".

**It did not materialise, because the source changed.** The shipped Normal pack is built from the Rodero/CEMRG average four-chamber **tetrahedral** mesh (CC BY 4.0), which carries real myocardial volume with tagged element groups — four chamber myocardia, the great-vessel walls, the four valve annuli, and fourteen vein and caval stubs. Rendered LV wall thickness measures 10.5 mm against the substrate's own 10.7 mm median chord, so no shelling fallback was needed. The Alberta Normal source was rejected technically and carries contradictory licence statements; its existing research pack is absent from Pages and tracked as a legacy public-Git rights exception.

What the substrate still cannot supply, and what is done about it:

- **No leaflets.** The tagged elements are fibrous annuli, so the four valves ship as *rings* and are named as rings everywhere. Calling one a "valve" without "ring" would be a regression in honesty.
- **No pericardium, chest wall, spine or diaphragm.** This is why the subcostal family (A3, A4) is refused rather than guessed: "below the diaphragm" is a BODY axis this mesh cannot supply, and the three defensible proxies disagree by up to 46°.
- **Fourteen of twenty-four tags stay generic.** Each borders exactly one chamber, so adjacency cannot separate a right upper pulmonary vein from a left lower one; that needs a clinical reading.

The remaining fallbacks (pericardium as a rendered interface; sculpted leaflets, flagged stylized) are still available and still unused. Clinical review is deferred until the build is substantially complete, so schema v1 has not frozen and schema v0 stays provisional.

## Repo and hosting

- Repo: **github.com/tomzzzhang/Cardiology-app** — public. The capital `C` is load-bearing: GitHub Pages serves a project site from `/<repository-name>/`, so the path is case-sensitive and the workflow passes the real name through as `BASE_PATH`. `npm run check:base-path` builds with a sentinel and asserts the output is prefixed, so neither the path nor its casing can be hardcoded.
- Hosting: **GitHub Pages** at `https://tomzzzhang.github.io/Cardiology-app/`, deployed from `main` via GitHub Actions. Deep links use URL query params; the full `?a=<anatomy>&v=<view>&s=<sweep-pos>` scheme is wave 2, and `?mode=`, `?view=` and `?pack=` are wired today. No SPA-routing hacks needed.
- The Git checkout lives OUTSIDE any file-sync tree; sync services corrupt git state.
- **Privacy rule:** no personal names, program names, or availability details of clinical collaborators anywhere in this repository. In-app provenance shows vetter ROLE labels until explicit naming consent is recorded. Licence-required attribution of a third-party model's source is a separate obligation and stays required.

## Stack (confirmed)

TypeScript + three.js, thin React shell, Vite. Fully static site: no backend, no accounts. Content
packs are static JSON + binary assets (glTF with Draco/meshopt + echo volume), budget ~15-20 MB per
pack. The active target is laptop and hospital desktop. Phone/touch UX is paused for a separate
later design workstream and is not a platform or release gate.

## Architecture: engine + content packs

The current design uses an anatomy-agnostic engine and versioned self-contained packs. That split is
a useful platform hypothesis, not an irreversible safeguard; evolve it when implementation evidence
requires a better boundary. Each current module has a one-page contract under `contracts/`:

1. **pack-loader** — fetch, schema-validate, parse packs; exposes typed pack model.
2. **viewer-core** — scene + orbit; per-structure show/hide, labels, blood-pool coloring; an independent free anatomical cut plane; clipping with stencil-buffer caps so cut faces render solid; a separate translucent sector-wedge probe indicator driven by the same saved probe pose + fan params as the echo panel (one-to-one match). Implements the interaction contract below.
3. **echo-renderer** — simulated echo (work item spec below).
4. **view-rail + sweep scrubber** — view family rail, per-view presets, scrub control animating plane wedge + echo together.
5. **provenance UI** — one-line strip (source, vetter role, date), tap to expand; draft-flag badges; consolidated credits screen (license compliance surface).
6. **authoring mode** (flag-gated) — place/tune probe poses against a loaded pack and export strict
   draft slot data. Explicit camera placement may expand only the local draft depth to
   `max(source, measured minimum)`; it never shrinks or mutates the loaded pack. The separate ingest
   requires the export's exact source pack revision, maps one standard slot to its existing draft
   view, invalidates the prior placement description, carries the coupled sweep axis, clears stale
   sweep measurements, validates the complete candidate pack, and writes only with `--write`.
   Broader sweep/echo tuning and later review workflow remain; saving and ingestion never claim
   vetting.
7. **app shell** — URL-param deep links, responsive layout, normal-vs-lesion synced-camera toggle only if nearly free.

## Viewer interaction contract (UI/UX refinement; scope unchanged)

### Coordinate frames and plane state

- Keep three frames explicit: **model/anatomical** (fixed canonical pack coordinates), **camera/screen** (X right, Y up, Z toward the viewer), and **plane-local** (`U`, `V`, unit normal `N`). Labels use anatomical directions; interaction help may use plain-language screen directions.
- Let `C` be the pack's interaction pivot (explicit if supplied; otherwise the model-bounds centroid). Store the free anatomical cutter as the oriented radial plane `{N, s}`, where `N` is normalized and `s` is signed distance from `C`:
  - `dot(N, X - C) = s`
  - closest point `Q = C + sN`
- The mathematical cutter is infinite. Any rendered rectangle is only a helper sized from model bounds; it never limits clipping. Reversing the oriented plane changes which side remains visible.
- The free cutter is runtime inspection state, not a clinical `views[]` entry. A clinical echo plane/wedge remains derived from its saved full probe pose. They may coincide visually but remain separate objects and data paths.

### Mouse and trackpad behavior

- Default navigation: drag orbits around `C`; pan is a separate gesture; wheel/pinch zooms the camera; reset restores the pack's standard orientation. Familiar globe-viewer orbit behavior is the reference feel.
- A drag must never silently manipulate a different object. **Met positionally rather than by a mode** (2026-08-19, superseding the "heart/camera / free cut / echo view" target selector): every movable object is drawn, and what is under the pointer decides what a drag moves.
- The free cutter is a visible rectangle with edge rotation handles and a draggable depth arrow.
  Arrow keys move a focused plane; wheel/pinch remain camera zoom. The removed depth slider and
  explicit target selector are historical mockup choices, not current requirements.
- Existing narrow-layout and coarse-pointer behavior is retained as a starting point only. Phone
  interaction, gesture design, and real-device qualification are deferred until the phone/touch
  workstream is explicitly resumed.

### Separation and bridge actions

- Learner mode can freely move the anatomical cutter. The wedge is driven by named views and sweeps, through the scrubber or the probe control pad, whose fan buttons write the same `t`. **One explicit exception** (2026-08-19): a **Free probe** toggle unlocks the probe and lets the learner turn it off the saved track, paid for by the echo panel withdrawing the view's name and draft flag the moment it has actually moved. Arbitrary probe-pose AUTHORING remains in authoring mode, and nothing a learner can do writes to `views[]`.
- **The cutter has two named modes** (2026-08-19, superseding the one-shot **Align free cut to echo view** bridge): **Echo plane**, in which it continuously follows the selected view's imaging plane as the sweep scrubs, and **Free**, in which it claims no relationship to the view. The name is on screen at all times. Data flows probe → cutter and never the reverse, and neither mode modifies the saved view.
- Moving the free cutter alone does not synthesize or relabel an echo image. The echo panel continues to display only the selected saved view/sweep output.

## Content pack schema — v0 PROVISIONAL

Schema v0 remains provisional throughout platform construction. Review of the integrated prototype
supplies any final changes before schema v1 freezes. Versioned via `schema_version`.

- `meta`: id, display name, anatomy, canonical-variant label, pack version, `schema_version`.
- `provenance` (per anatomy AND per view): `{creator, source, source_url, license, license_url, modified: {flag, note}, derivation_chain, vetted: {status: draft|vetted, vetters: [{name (optional, consent-gated), role: fellow|attending, date}], last_reviewed}}`.
- `meshes`: glTF reference; named sub-mesh per structure; structure hierarchy + display labels; canonical pose; units/orientation convention.
  - `anatomical_frame` (optional): the EVIDENCE behind `orientation` — derivation method, the tags and landmarks measured, the basis carrying source coordinates into pack coordinates, and the named anatomical checks with their outcomes. Optional because a fused surface with no chamber labels genuinely cannot derive a frame and must say so by omission rather than by inventing one. The schema refuses a non-orthogonal or left-handed basis, and refuses a `checks_passed`/`checks_total` summary that disagrees with the `checks` it summarises; a FAILING check is representable on purpose, since hiding it is the outcome the block exists to prevent. Added after wave 1c — see `pipeline/anatomy.py`.
  - `anatomical_frame.valve_identification` (optional): which structure carries which valve plane, and the shared-face counts that establish it. Identifying a valve by WHERE IT SITS is circular — position is what the frame is being derived to interpret — so it is identified by WHAT IT SEPARATES: a valve plane borders exactly two labelled chambers, and the pair names it uniquely (LV+LA mitral, RV+RA tricuspid, LV+aorta aortic, RV+PA pulmonary). The schema enforces the "exactly two" invariant and refuses an `agrees_with_published` flag that disagrees with the two mappings recorded beside it. The pipeline RAISES on disagreement rather than warning: a mesh whose valve tags do not match the published convention is tagged to some other convention, and every number derived from the rings would then be wrong while still looking plausible.
  - **The axes a heart-only mesh can carry are CARDIAC, not the patient's.** Measured on the Rodero substrate, three defensible proxies for body superior-inferior disagree by up to 46 degrees, and the original ventricular-centroid-to-aortic-wall proxy puts the IVC superior to the valve plane. The cardiac frame, by contrast, is tight: the apex from the source's universal ventricular coordinates, the base from four valve-ring centroids fitting a plane to within 5.8 mm, and the two agreeing on the basal direction to 6 degrees. Every plane in `view_canon.md` is defined against cardiac landmarks anyway; the chest placements are prose for the learner, not geometry.
- `interaction`: optional model-space pivot `C` (defaults to bounds centroid), initial camera/orientation, and initial free-cut `{normal, offset}`. This governs viewer defaults only; it is not medical view metadata.
- `echo_volume`: labeled voxel volume for the echo renderer — asset reference (e.g. KTX2/raw), resolution, mesh-to-volume transform, per-label echogenicity + attenuation LUT. Scatterer field is NOT shipped: generated at runtime from a stored `scatterer_seed` (deterministic); baking a scatterer channel remains a future performance fallback, not a current phone-driven decision.
- `views[]`: view identity per `view_canon.md` (family, view_id, name, aliases, placement_landmark, indicator_clock) PLUS full probe pose. The independent free cutter never lives in this array:
  - `probe`: `{origin (model space), beam_axis (unit), lateral_axis (unit), fan: {angle_deg, depth_cm, focus_cm}, display: {vertex: up|down, flip_lr, marker_side}}`. The cut plane `{anchor, basis_u, basis_v}` is DERIVED from probe (anchor = origin; basis = beam/lateral axes) — one source of truth, wedge and echo fan share it.
  - `sweep` (optional): `{mode: tilt|rotate|translate, axis (through probe origin unless specified), range (deg or mm), interpolation: slerp|lerp over t in [0,1], structures_in_order[]}`.
  - `show_hide_preset`, `echo_tuning` overrides, empty `real_clip_slot`, `emphasis` (set at vetting).
- Display flags: pediatric vertex conventions, PLAX apex-left exception, dextrocardia indicator profile (stored, default off).
- Schema tolerates a future volumetric-data reference.

## Simulated echo work item (echo-shader spec)

**Approach: convolutional ray-tracing (COLE/CRT family) — scatterer map + separable per-scanline PSF convolution over a ray-cast — in WebGL2, single render pass, static frames in v1.** Wave physics is offline-only; GAN/diffusion is offline-polish-only.

Offline per pack (build step): voxelize the labeled mesh into the `echo_volume` (labels → echogenicity + attenuation). Runtime per frame, per scanline in polar space: ray-march from the probe origin through the volume; accumulate Beer-Lambert attenuation (acoustic shadowing + distal dropout); per sample: `echo = scatterer_amplitude(seeded) × PSF(depth, lateral) × specular(beam·normal at label boundaries) + boundary_reflection`. Post: TGC, log compression + dynamic range, polar→Cartesian scan-conversion LUT, sector mask, subtle near-field clutter.

Perceptual priorities, in order:
1. **Correct grey-level ordering with Rayleigh speckle.** Pericardium brightest (interface render if no geometry); calcified bright + shadowing; leaflets bright but view-dependent (specular); myocardium mid-grey textured; blood near-black. Speckle from PSF-convolved scatterers, never additive Gaussian noise.
2. **Attenuation artifacts** — shadowing and lateral-wall dropout via the beam·normal term.
3. **Sector-fan geometry + TGC + pediatric display conventions** (per `view_canon.md`). Pediatric probe feel: 5-12 MHz, shallow depth, focus ~4-5 cm.

Stage 0: fixture slice → grey-level LUT + speckle + fan + TGC. During platform work, inspect for
coherent geometry, stability, and controllability. The later clinical gate determines whether a
candidate view is learnable from; that verdict does not block renderer construction.

Upgrade path (no rearchitecture): keyframed motion = deformation-warped scatterers (Storve & Torp); secondary rays only if vetting flags missing artifacts; WebGPU compute if budgets bottleneck; diffusion offline for reference stills only.

Implementation references, in order: Gao 2009 (COLE); Bürger 2013 (scatterer params, artifacts); Amadou 2024 (labeled-volume cardiac blueprint); ImFusion patent US10565900B2 (hybrid architecture); SlicerIGT/PLUS (mesh→scanline pattern); MUST/Field II offline tuning only.

## Model prep pipeline (Blender + Python)

Steps per anatomy: acquire → pose-normalize → split/label structures → substrate completion where needed (shelled myocardium, sculpted leaflets — labeled stylized) → decimate (~150-300k triangles) → glTF export + labeled voxelization (`echo_volume`). STL retained as interchange master.

The current Normal substrate is the Rodero/CEMRG average four-chamber tet mesh. Later anatomy and
motion sources remain content decisions and do not block platform construction.

## Licensing plan

- Every pack carries the full provenance block; the credits screen renders creator, source URL, license + URL, modified note per model (CC-compliant "reasonable manner").
- Attribution template (Alberta site-wide CC BY-NC 4.0):
  > "Heart model '<model name>' by the 3D Heart Project (University of Alberta / Stollery Children's Hospital), source: sketchfab.com/3DHeartProject. Licensed under CC BY-NC 4.0 (creativecommons.org/licenses/by-nc/4.0/). Modified: segmented, relabeled, and re-meshed for interactive display by <app name>."
  Variants: AB2 cites CC BY 4.0; any UMCG asset cites CC BY-NC-SA 4.0 and notes the derivative pack is itself CC BY-NC-SA 4.0.
- **NC red lines** (each independently violates): ads, paid sponsorship tied to content, paid tiers including NC content, selling institutional access. Free educational app with zero revenue is squarely permitted.
- Keep CC BY-NC-SA assets logically separable. Verify each Sketchfab license badge in a browser before download.
- Treat Git history as public distribution. Only rights-cleared assets may be committed; material
  with unresolved redistribution or modification rights stays in an ignored local workspace.
- Content and release gates enforce attribution completeness for committed and shipped packs.

## Workflow

See [`WORKFLOW.md`](../WORKFLOW.md). This file defines architecture and milestones, not session
process or universal build gates.

## CI

Ordinary `dev` pushes run the fast platform gate and a production build. Content checks run when
pack/schema/pipeline material changes. The desktop browser, deployable-bundle, base-path, provenance,
and publication checks run at the release boundary before Pages deploys from `main`.

## Milestones and waves

Completed: Wave 0, real-model ingest, the simulated-echo slice, viewer-core interaction,
Echo/Explore modes, the curated model picker over a retained and validated pack inventory,
per-structure inspection, and the authoring placement/export/ingestion round trip through the
Rodero non-clinical reference view.
The authoring review surface can also hold the current anatomy angle while saved-view selection
moves only the probe, echo-synced cutter, and live echo; manual camera controls remain available.
It opens at a neutral `None — full heart` presentation with no probe/echo/cut claim, and an enabled
Echo-plane cut is opened toward the current camera once each app-driven saved-view transition lands.
This is a flag-gated review aid, not the learner rail.

Active, in order:

1. **Decide how a learner picks a view.** The view rail and canonical sweep scrubber were
   superseded by owner decision on 2026-08-21 and are not being built as specified; `?view=` is
   still the only learner route. `contracts/view-rail-sweep-scrubber.md` holds the requirements
   whatever replaces it must respect.
2. Complete the integrated authoring/learner platform path.

Also open, arising from the body-context work:

- **F1 needs reauthoring, not migrating.** Its aperture is 66.5 mm inside the thorax; reaching the
  chest wall would need a 22.19 cm imaging depth, outside adult transthoracic range.
- **The composite's cardiothoracic ratio is 0.543** against 0.491 for the source's own native pair.
  Placement is right; the population-average heart is simply 14 mm wider than the heart that chest
  was built around. Not repaired, because repairing it means scaling one of the two.
- **Two legacy provenance defects**, both blocked from in-place correction by byte-pinned evidence:
  `pipeline/sources.py` and the committed `anatomy-bodyparts3d-heart` pack describe BodyParts3D as a
  cadaver (it is a living adult male MRI reference), and that pack's declared `orientation`
  (`up=+y, anterior=+z`) is measurably wrong — the source's own axes are `+X` left, `+Y` posterior,
  `+Z` superior. Both need an evidence-safe migration.
- **No learner-visible provenance for the body context.** A stale or failed registration falls back
  to model space silently, apart from the chest-load warning.

Deferred to desktop integration/release: clinical review, schema v1 freeze, complete provenance UI,
supported desktop-browser qualification, full Normal/lesion content, and advancement of `main`.
Phone real-device qualification belongs only to the later phone/touch workstream.
