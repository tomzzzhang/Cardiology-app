# Build plan — Cardiology app

> **Build specification.** Clinical collaborators are referred to by role, not name. Referenced `research/DR*.md` reports live in the owner's planning folder.

Status: **v1.3** (2026-08-18). The viewer now has an explicit coordinate/control contract: the independent free anatomical cutter is separate from the vetted echo wedge, with radial plane state and touch/mouse behavior pinned. v1.3 adds the optional `meshes.anatomical_frame` evidence block to the schema and records what a heart-only substrate can and cannot say about orientation. Anatomy set, echo investment, release ladder, and definition of done are unchanged. Scope authority is `docs/mvp_scope.md` (LOCKED); nothing here changes scope. View/sweep content spec: `docs/view_canon.md` (DRAFT, pending clinical vetting).

## Goal

Ship the `mvp_scope.md` definition of done: a shareable URL where the clinical vetter, on a phone, picks Normal / ASD (secundum or sinus venosus) / d-TGA, rotates and cuts the labeled model, picks any standard view, sees the plane wedge on the model with the simulated echo alongside, scrubs at least one sweep per view family, and sees provenance on every view.

## Release ladder

The locked MVP is the destination; intermediate releases de-risk it in order:

1. **Technical slice** (wave 1, first) — one real Normal asset, one hard sweep, real labeling + voxelization, synced wedge + simulated echo, laptop + phone performance, interpretation read from the clinical vetter (+ attending if available). Gates schema v1.
2. **Normal-heart demo** — milestone 1: viewer + view-to-plane + sweeps + simulated echo on the Normal pack, a handful of views.
3. **Full Normal canon** — all views + sweeps per `view_canon.md`, vetting pass.
4. **Multi-anatomy MVP** — ASD module + d-TGA packs through the same pipeline; definition of done above.

## Anatomical substrate risk

The echo renderer consumes labeled TISSUE (myocardium, pericardium, valve leaflets, interfaces), but several candidate sources are blood-pool casts or fused surfaces. Splitting an STL cannot create tissue that is not there; a bloodpool-only mesh yields chamber lumens and an uninterpretable "echo." Plan:

- **First slice task:** confirm per model whether the Alberta library provides myocardial (not just bloodpool) versions of the Normal heart and d-TGA.
- **Fallback, in order:** (a) synthetic myocardium by shelling/offsetting the bloodpool surface (Blender solidify), honestly labeled as stylized geometry in provenance; (b) pericardium rendered as a bright interface at the outer myocardial boundary (a renderer trick, not geometry); (c) valve leaflets sculpted as artist geometry where sources lack them — flagged stylized, vetted like everything else.
- The slice review (with the clinical vetter) decides whether the substrate + fallbacks clear the "learnable-from" bar BEFORE schema v1 freezes and content production starts.

## Repo and hosting

- Repo: **github.com/tomzzzhang/cardiology-app** — public.
- Hosting: **GitHub Pages** at `https://tomzzzhang.github.io/cardiology-app/`, deployed from `main` via GitHub Actions. Deep links use URL query params (`?a=<anatomy>&v=<view>&s=<sweep-pos>`); no SPA-routing hacks needed.
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
- The active target is always visible: **heart/camera**, **free cut**, or **echo view**. A drag must never silently manipulate a different object.
- With the free cutter active, a visible slider and modifier-wheel translate it along plane-local `N`. Wheel without the modifier always zooms. The slider, wheel, depth/offset readout, and reset action stay synchronized. Sensitivity and direction inversion are user preferences if inexpensive.
- Plane rotation uses visible handles/gizmos. Default free rotation holds `s` constant while rotating `N` around the heart; a gesture freezes its pivot for the duration so the plane cannot drift from continuously recomputing the pivot. Fixed-anatomical-point and probe-origin rotation modes remain authoring/later refinements, not MVP requirements.
- Phone controls use visible handles and the depth slider rather than hidden modifier gestures; pinch zooms and two-finger drag pans.

### Separation and bridge actions

- Learner mode can freely move the anatomical cutter but cannot freely reposition a vetted echo wedge. Named views and sweeps drive the wedge through the view rail/scrubber; arbitrary probe-pose work remains in authoring mode.
- **Align free cut to echo view** copies the selected echo plane into the free cutter. Subsequent free movement breaks the association and never modifies the vetted view.
- Moving the free cutter alone does not synthesize or relabel an echo image. The echo panel continues to display only the selected vetted view/sweep output.

## Content pack schema — v0 PROVISIONAL

**Provisional until the technical slice review; expect one revision (v1) after the slice.** Versioned via `schema_version`.

- `meta`: id, display name, anatomy, canonical-variant label, pack version, `schema_version`.
- `provenance` (per anatomy AND per view): `{creator, source, source_url, license, license_url, modified: {flag, note}, derivation_chain, vetted: {status: draft|vetted, vetters: [{name (optional, consent-gated), role: fellow|attending, date}], last_reviewed}}`.
- `meshes`: glTF reference; named sub-mesh per structure; structure hierarchy + display labels; canonical pose; units/orientation convention.
  - `anatomical_frame` (optional): the EVIDENCE behind `orientation` — derivation method, the tags and landmarks measured, the basis carrying source coordinates into pack coordinates, and the named anatomical checks with their outcomes. Optional because a fused surface with no chamber labels genuinely cannot derive a frame and must say so by omission rather than by inventing one. The schema refuses a non-orthogonal or left-handed basis, and refuses a `checks_passed`/`checks_total` summary that disagrees with the `checks` it summarises; a FAILING check is representable on purpose, since hiding it is the outcome the block exists to prevent. Added after wave 1c — see `pipeline/anatomy.py`.
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

**Wave 0 — done.** Scaffold (Vite + TS + React + three.js), CI, Pages deploy, pack schema v0 + validator + stub pack, module contract files, `WORKFLOW.md`. The stub pack loads and validates; the viewer is a hello-world scene.

**Wave 1 — slice first, then fan out:**
- **(1a) Model pipeline slice** — one real Alberta Normal asset: myocardial-variant check, label split, substrate completion as needed, decimation, glTF + `echo_volume` voxelization. Touches `pipeline/`, `packs/normal/`.
- **(1b) Echo slice** — Stage 0 then the full scanline pass against 1a's real volume; one hard sweep end-to-end with the synced wedge (primary: subcostal coronal posterior→anterior sweep; alternate: PLAX TV↔PV); laptop + phone perf numbers. Touches `src/echo/`.
- **Slice review gate:** interpretation read by the clinical vetter (+ attending if available); decides substrate verdict and freezes schema v1.
- **(1c) viewer-core** implements the interaction contract above (orbit/pan/zoom, explicit selection, radial free cutter, solid caps, slider/modifier-wheel depth, touch controls, align-to-echo bridge), while **(1d) view rail + scrubber** drives only vetted probe poses/sweeps. They proceed in parallel against the stub pack; their contracts do not depend on the slice.

**Wave 2 — integration.** Real packs through viewer + echo + rail; deep links; provenance UI + credits; phone layout pass.

**Then:** authoring mode; ASD sculpt authored + vetted through it; d-TGA pack; DORV pack next.
