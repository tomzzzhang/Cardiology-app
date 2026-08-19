# Build plan — Cardiology app

> **Build specification.** Clinical collaborators are referred to by role, not name. Referenced `research/DR*.md` reports live in the owner's planning folder.

Status: **v1.5** (2026-08-19). v1.5 records the interaction pass the owner ordered after using the build: explicit target selection and the one-shot align bridge are replaced by direct manipulation and two named cutter modes, Explore becomes a first-class top-level mode, and the probe gains an explicit, labelled unlock. The substrate risk below is RESOLVED and the section says how. Earlier: **v1.4** (2026-08-18). The viewer now has an explicit coordinate/control contract: the independent free anatomical cutter is separate from the vetted echo wedge, with radial plane state and touch/mouse behavior pinned. v1.3 added the optional `meshes.anatomical_frame` evidence block to the schema and recorded what a heart-only substrate can and cannot say about orientation. v1.4 adds `anatomical_frame.valve_identification`: which structure carries which valve plane, derived from face adjacency rather than from position, with the shared-face counts that prove it. Anatomy set, echo investment, release ladder, and definition of done are unchanged. Scope authority is `docs/mvp_scope.md` (LOCKED); nothing here changes scope. View/sweep content spec: `docs/view_canon.md` (DRAFT, pending clinical vetting).

## Goal

Ship the `mvp_scope.md` definition of done: a shareable URL where the clinical vetter, on a phone, picks Normal / ASD (secundum or sinus venosus) / d-TGA, rotates and cuts the labeled model, picks any standard view, sees the plane wedge on the model with the simulated echo alongside, scrubs at least one sweep per view family, and sees provenance on every view.

## Release ladder

The locked MVP is the destination; intermediate releases de-risk it in order:

1. **Technical slice** (wave 1, first) — one real Normal asset, one hard sweep, real labeling + voxelization, synced wedge + simulated echo, laptop + phone performance, interpretation read from the clinical vetter (+ attending if available). Gates schema v1.
2. **Normal-heart demo** — milestone 1: viewer + view-to-plane + sweeps + simulated echo on the Normal pack, a handful of views.
3. **Full Normal canon** — all views + sweeps per `view_canon.md`, vetting pass.
4. **Multi-anatomy MVP** — ASD module + d-TGA packs through the same pipeline; definition of done above.

## Anatomical substrate risk — RESOLVED

The risk was that candidate sources are blood-pool casts or fused surfaces: splitting an STL cannot create tissue that is not there, and a bloodpool-only mesh yields chamber lumens and an uninterpretable "echo".

**It did not materialise, because the source changed.** The shipped Normal pack is built from the Rodero/CEMRG average four-chamber **tetrahedral** mesh (CC BY 4.0), which carries real myocardial volume with tagged element groups — four chamber myocardia, the great-vessel walls, the four valve annuli, and fourteen vein and caval stubs. Rendered LV wall thickness measures 10.5 mm against the substrate's own 10.7 mm median chord, so no shelling fallback was needed. The Alberta 3D Heart Library is **licence-rejected** (CC BY-NC 4.0 against a product with commercial red lines) and its files are pruned from the build; `npm run test:visual` asserts they are not served.

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

TypeScript + three.js, thin React shell, Vite. Fully static site: no backend, no accounts. Content packs are static JSON + binary assets (glTF with Draco/meshopt + echo volume), budget ~15-20 MB per pack. Targets: laptop and hospital desktop first-class, phone portrait usable (stacked layout).

## Architecture: engine + content packs

Anatomy-agnostic engine, versioned self-contained packs, zero lesion-specific engine logic. Engine modules — each has a one-page contract file under `contracts/`; change a contract or the schema deliberately, with evidence, updating tests and documentation in the same commit:

1. **pack-loader** — fetch, schema-validate, parse packs; exposes typed pack model.
2. **viewer-core** — scene + orbit; per-structure show/hide, labels, blood-pool coloring; an independent free anatomical cut plane; clipping with stencil-buffer caps so cut faces render solid; a separate translucent sector-wedge probe indicator driven by the same vetted probe pose + fan params as the echo panel (one-to-one match). Implements the interaction contract below.
3. **echo-renderer** — simulated echo (work item spec below).
4. **view-rail + sweep scrubber** — view family rail, per-view presets, scrub control animating plane wedge + echo together.
5. **provenance UI** — one-line strip (source, vetter role, date), tap to expand; draft-flag badges; consolidated credits screen (license compliance surface).
6. **authoring mode** (flag-gated) — place/tune probe poses, planes, and sweeps interactively against a loaded pack, tune per-view echo params, export pack JSON; vetting sign-off stamps the vetters list and clears the draft flag.
7. **app shell** — URL-param deep links, responsive layout, normal-vs-lesion synced-camera toggle only if nearly free.

## Viewer interaction contract (UI/UX refinement; scope unchanged)

### Coordinate frames and plane state

- Keep three frames explicit: **model/anatomical** (fixed canonical pack coordinates), **camera/screen** (X right, Y up, Z toward the viewer), and **plane-local** (`U`, `V`, unit normal `N`). Labels use anatomical directions; interaction help may use plain-language screen directions.
- Let `C` be the pack's interaction pivot (explicit if supplied; otherwise the model-bounds centroid). Store the free anatomical cutter as the oriented radial plane `{N, s}`, where `N` is normalized and `s` is signed distance from `C`:
  - `dot(N, X - C) = s`
  - closest point `Q = C + sN`
- The mathematical cutter is infinite. Any rendered rectangle is only a helper sized from model bounds; it never limits clipping. Reversing the oriented plane changes which side remains visible.
- The free cutter is runtime inspection state, not a clinical `views[]` entry. A clinical echo plane/wedge remains derived from its saved full probe pose. They may coincide visually but remain separate objects and data paths.

### Mouse, trackpad, and touch behavior

- Default navigation: drag orbits around `C`; pan is a separate gesture; wheel/pinch zooms the camera; reset restores the pack's standard orientation. Familiar globe-viewer orbit behavior is the reference feel.
- A drag must never silently manipulate a different object. **Met positionally rather than by a mode** (2026-08-19, superseding the "heart/camera / free cut / echo view" target selector): every movable object is drawn, and what is under the pointer decides what a drag moves.
- With the free cutter active, a visible slider and modifier-wheel translate it along plane-local `N`. Wheel without the modifier always zooms. The slider, wheel, depth/offset readout, and reset action stay synchronized. Sensitivity and direction inversion are user preferences if inexpensive.
- Plane rotation uses four handles at the edge midpoints of the rendered rectangle. Rotation holds `s` constant while rotating `N` around the heart; a gesture freezes its start normal and its pivot for the duration and applies the drag's total offset, so the plane cannot drift and dragging back returns it. The grabbed handle follows the pointer. Fixed-anatomical-point and probe-origin rotation modes remain authoring/later refinements, not MVP requirements.
- Phone controls use visible handles and the depth slider rather than hidden modifier gestures; pinch zooms and two-finger drag pans.

### Separation and bridge actions

- Learner mode can freely move the anatomical cutter. The wedge is driven by named views and sweeps, through the scrubber or the probe's tilt arrow, which writes the same `t`. **One explicit exception** (2026-08-19): a **Free probe** toggle unlocks the probe and lets the learner turn it off the saved track, paid for by the echo panel withdrawing the view's name and draft flag the moment it has actually moved. Arbitrary probe-pose AUTHORING remains in authoring mode, and nothing a learner can do writes to `views[]`.
- **The cutter has two named modes** (2026-08-19, superseding the one-shot **Align free cut to echo view** bridge): **Echo plane**, in which it continuously follows the selected view's imaging plane as the sweep scrubs, and **Free**, in which it claims no relationship to the view. The name is on screen at all times. Data flows probe → cutter and never the reverse, and neither mode modifies the vetted view.
- Moving the free cutter alone does not synthesize or relabel an echo image. The echo panel continues to display only the selected vetted view/sweep output.

## Content pack schema — v0 PROVISIONAL

**Provisional until the technical slice review; expect one revision (v1) after the slice.** Versioned via `schema_version`.

- `meta`: id, display name, anatomy, canonical-variant label, pack version, `schema_version`.
- `provenance` (per anatomy AND per view): `{creator, source, source_url, license, license_url, modified: {flag, note}, derivation_chain, vetted: {status: draft|vetted, vetters: [{name (optional, consent-gated), role: fellow|attending, date}], last_reviewed}}`.
- `meshes`: glTF reference; named sub-mesh per structure; structure hierarchy + display labels; canonical pose; units/orientation convention.
  - `anatomical_frame` (optional): the EVIDENCE behind `orientation` — derivation method, the tags and landmarks measured, the basis carrying source coordinates into pack coordinates, and the named anatomical checks with their outcomes. Optional because a fused surface with no chamber labels genuinely cannot derive a frame and must say so by omission rather than by inventing one. The schema refuses a non-orthogonal or left-handed basis, and refuses a `checks_passed`/`checks_total` summary that disagrees with the `checks` it summarises; a FAILING check is representable on purpose, since hiding it is the outcome the block exists to prevent. Added after wave 1c — see `pipeline/anatomy.py`.
  - `anatomical_frame.valve_identification` (optional): which structure carries which valve plane, and the shared-face counts that establish it. Identifying a valve by WHERE IT SITS is circular — position is what the frame is being derived to interpret — so it is identified by WHAT IT SEPARATES: a valve plane borders exactly two labelled chambers, and the pair names it uniquely (LV+LA mitral, RV+RA tricuspid, LV+aorta aortic, RV+PA pulmonary). The schema enforces the "exactly two" invariant and refuses an `agrees_with_published` flag that disagrees with the two mappings recorded beside it. The pipeline RAISES on disagreement rather than warning: a mesh whose valve tags do not match the published convention is tagged to some other convention, and every number derived from the rings would then be wrong while still looking plausible.
  - **The axes a heart-only mesh can carry are CARDIAC, not the patient's.** Measured on the Rodero substrate, three defensible proxies for body superior-inferior disagree by up to 46 degrees, and the original ventricular-centroid-to-aortic-wall proxy puts the IVC superior to the valve plane. The cardiac frame, by contrast, is tight: the apex from the source's universal ventricular coordinates, the base from four valve-ring centroids fitting a plane to within 5.8 mm, and the two agreeing on the basal direction to 6 degrees. Every plane in `view_canon.md` is defined against cardiac landmarks anyway; the chest placements are prose for the learner, not geometry.
- `interaction`: optional model-space pivot `C` (defaults to bounds centroid), initial camera/orientation, and initial free-cut `{normal, offset}`. This governs viewer defaults only; it is not medical view metadata.
- `echo_volume`: labeled voxel volume for the echo renderer — asset reference (e.g. KTX2/raw), resolution, mesh-to-volume transform, per-label echogenicity + attenuation LUT. Scatterer field is NOT shipped: generated at runtime from a stored `scatterer_seed` (deterministic); baking a scatterer channel stays a fallback if runtime generation costs too much on phones — slice decides.
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

Stage 0 (inside the technical slice): fixture slice → grey-level LUT + speckle + fan + TGC. Benchmark: if the clinical vetter reads it as echo, path confirmed; if "looks like CT," speckle/PSF first. Bar: per-view "learnable-from" verdict, not indistinguishability.

Upgrade path (no rearchitecture): keyframed motion = deformation-warped scatterers (Storve & Torp); secondary rays only if vetting flags missing artifacts; WebGPU compute if budgets bottleneck; diffusion offline for reference stills only.

Implementation references, in order: Gao 2009 (COLE); Bürger 2013 (scatterer params, artifacts); Amadou 2024 (labeled-volume cardiac blueprint); ImFusion patent US10565900B2 (hybrid architecture); SlicerIGT/PLUS (mesh→scanline pattern); MUST/Field II offline tuning only.

## Model prep pipeline (Blender + Python)

Steps per anatomy: acquire → pose-normalize → split/label structures → substrate completion where needed (shelled myocardium, sculpted leaflets — labeled stylized) → decimate (~150-300k triangles) → glTF export + labeled voxelization (`echo_volume`). STL retained as interchange master.

v1 sources: Normal + d-TGA from the University of Alberta 3D Heart Library (CC BY-NC 4.0) — myocardial-variant check is the first slice task; ASD module custom sculpt from the Normal model, sinus venosus half may start from the Alberta "Sinus Venosus Defect" model AB2 (CC BY 4.0, downloadable, ~261k tris).

## Licensing plan

- Every pack carries the full provenance block; the credits screen renders creator, source URL, license + URL, modified note per model (CC-compliant "reasonable manner").
- Attribution template (Alberta site-wide CC BY-NC 4.0):
  > "Heart model '<model name>' by the 3D Heart Project (University of Alberta / Stollery Children's Hospital), source: sketchfab.com/3DHeartProject. Licensed under CC BY-NC 4.0 (creativecommons.org/licenses/by-nc/4.0/). Modified: segmented, relabeled, and re-meshed for interactive display by <app name>."
  Variants: AB2 cites CC BY 4.0; any UMCG asset cites CC BY-NC-SA 4.0 and notes the derivative pack is itself CC BY-NC-SA 4.0.
- **NC red lines** (each independently violates): ads, paid sponsorship tied to content, paid tiers including NC content, selling institutional access. Free educational app with zero revenue is squarely permitted.
- Keep CC BY-NC-SA assets logically separable. Verify each Sketchfab license badge in a browser before download.
- CI enforces attribution completeness; build fails on missing provenance/license fields.

## Workflow

Development happens on a persistent `dev` branch in a local checkout outside any file-sync tree;
see `WORKFLOW.md`. Product intent, clinical context, decisions, and the progress log live in the
owner's planning folder. Code, tests, schemas, and contracts live in this repository. CI runs on
pushes to `dev` and `main`; GitHub Pages deploys only from `main`.

## CI

Typecheck + lint; pack schema validation; per-view visual regression (headless screenshot diff, tolerance-based); license/attribution completeness check; Pages deploy on merge to `main`.

## Milestones and waves

**Wave 0 — done.** Scaffold (Vite + TS + React + three.js), CI, Pages deploy, pack schema v0 + validator + stub pack, module contract files, `WORKFLOW.md`. The stub pack loads and validates.

**Wave 1 — slice first, then fan out:**
- **(1a) Model pipeline slice — done.** Built against the Rodero/CEMRG tet mesh rather than the licence-rejected Alberta library: tag split, valve identification by face adjacency, decimation, glTF + `echo_volume` voxelization, and a measured cardiac frame. Touches `pipeline/`, `public/packs/normal-rodero/`.
- **(1b) Echo slice — done.** Scan, separable PSF and display passes against 1a's real volume, with `npm run measure:echo` reporting grey levels and wall fill rather than asserting them. Touches `src/echo/`.
- **Slice review gate — DEFERRED by owner decision (2026-08-19).** Clinical review waits until the build is substantially complete. Schema v0 stays provisional; do not add review gates or solicit vetting before then.
- **(1c) viewer-core — done for this slice.** Orbit with no polar clamp, camera framing, the radial free cutter with solid stencil caps and an optional ghost of the removed half, direct-manipulation cut handles, two named cutter modes, the probe indicator and its tilt arrow, the beam-dim highlight, the animated match-echo camera, and Explore mode. Outstanding: pinch-zoom and two-finger pan, per-structure show/hide, labels, measurement.
- **(1d) view rail + scrubber — next.** Drives only vetted probe poses and sweeps. Its annotated ticks come from `sweep.structures_in_order`, which is now measured per view and deliberately EMPTY where the ordering was produced by the size tie-break rather than by the sweep.

**Wave 2 — integration.** Real packs through viewer + echo + rail; deep links; provenance UI + credits; phone layout pass.

**Then:** authoring mode; ASD sculpt authored + vetted through it; d-TGA pack; DORV pack next.
