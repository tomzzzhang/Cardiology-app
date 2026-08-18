# MVP scope — Cardiology app

> **Product scope.** Clinical collaborators are referred to by role, not name; interview documents stay in the owner's planning folder.

**LOCKED 2026-08-15** (factual annotations and UI/UX clarifications 2026-08-16; the scope itself is unchanged since lock). Locked by the project owner immediately after reviewing the clinical vetter's discovery interview. Inputs: the clinical vetter's feature force-ranking, hardest-lesion and hardest-view lists, the feasibility evaluation, and a model-availability check against the Alberta 3D Heart Library (2026-08-15). Changing this document is a scope change, and is recorded in the progress log first.

## Product in one sentence

A free, browser-based teaching tool where a pediatric cardiology trainee picks a heart (normal or lesion), rotates and cuts a labeled 3D model, and for any standard echo view sees exactly where that cut plane sits on the model, with a simulated echo image alongside and scrubbable sweeps.

## Decisions locked 2026-08-15

1. **Anatomy set, the "foundation slice":** Normal heart + ASD module (secundum and sinus venosus) + d-TGA. DORV with subpulmonary VSD is the first post-MVP anatomy, then DILV (S,L,L).
2. **Echo image posture: simulated, and invested in.** Echo-styled rendering from the labeled model; honest "simulated" labeling everywhere; per-view slot reserved for real clips later. No PHI/IRB/licensing workstream in v1.
3. **Sequencing: scope locked on the clinical vetter's signal.** Co-fellow interviews stay open and can re-weight content priorities; they do not gate the build.
4. **Platform: web-first confirmed.** One shareable URL, no install, phone-portrait usable; hospital desktop and laptop fully supported. Native/visionOS stays a later showcase.
5. **Variant policy:** one canonical variant per lesion, named and disclosed in-app; further variants are later content rows through the same pipeline.
6. **Trust architecture direction:** visible provenance per anatomy and per view mapping (model source and license, who vetted, last-reviewed date); unvetted content is visibly draft-flagged. Vetter names appear only with recorded consent; role labels otherwise.
7. **Modular content architecture:** the app is an anatomy-agnostic engine plus self-contained content packs. New lesions come from any source, directly or converted, by conforming them to the pack schema; nothing in the engine hardcodes lesion names or counts. See "Modularity and expansion" below.
8. **Build toolchain:** planning happens in ChatGPT or Claude Cowork; implementation happens in one local checkout. *[Update 2026-08-16: repo + hosting resolved — public GitHub repo `tomzzzhang/Cardiology-app`, GitHub Pages; see `docs/build_plan.md`.]*

## Why this anatomy set

The clinical vetter's three hardest lesions (DORV with subpulmonary VSD; DILV S,L,L; sinus venosus ASD) collide with model availability: the Alberta 3D Heart Library (best open source, CC BY-NC) has normal hearts, TGA, TOF/PA, TAPVR, HLHS, arch anomalies, and truncus, but no DORV and no DILV (checked 2026-08-15). *[Update 2026-08-16: a deeper sourcing sweep FOUND a sinus venosus model in the library's Sketchfab account — "Sinus Venosus Defect" (AB2), bloodpool, CC BY 4.0, downloadable. DORV and DILV remain absent, so the anatomy-set logic stands; the sculpt's sinus venosus half may start from AB2 instead of scratch. Scope unchanged.]* Her own framing resolves the tension: foundation first; with a foundation, new variants get much easier.

The slice is chosen so each piece pays for itself:

- **Normal heart** (library model). The foundation. Full standard-view coverage with sweeps is THE deliverable here; it also matches the "mastering normal hearts first" usage forecast and is the substrate for the ASD sculpt.
- **ASD module** (custom sculpt from the normal model): secundum ASD and sinus venosus ASD with typical RUPV PAPVR. Sinus venosus is on the hardest list; the module carries the "simple lesion intricacy" teaching the vetter called out (retro-aortic rim in PSAX with the aortic valve en face; septal anatomy from the RA side); and it is the cheapest credible custom-lesion sculpt, so it proves the custom pipeline before the expensive DORV build.
- **d-TGA** (library model). The great-artery-relationship lesion with a model already in hand: a stated hard theme (segmental designations, great-artery relationships) plus a board classic. Foundation for the DORV/DILV family later.

Queued next, in order: DORV with subpulmonary VSD (the vetter's #1 hardest) once the ASD sculpt clears vetting; then DILV (S,L,L). Model sourcing for these is in progress (shortlist exists; outreach pending).

## View coverage floor (per the clinical vetter, non-negotiable)

Every anatomy ships with ALL standard TTE views, not a curated subset: parasternal long-axis (including RV inflow/outflow) and short-axis sweep levels, apical 4C/5C and variants, subcostal long and short, suprasternal long and short, and high left parasternal/ductal as appropriate. Plus lesion-specific non-standard views where the lesion demands them (for the queued DORV: subcostal RAO and the TET view). Sweeps are first-class: each view family has at least one canonical sweep, scrubbable, with the plane animating on the model.

Per-lesion view emphasis (which views matter most for this lesion) is content metadata decided in vetting sessions, not hardcoded now. *[Update 2026-08-16: the encodable canon exists as `docs/view_canon.md`, DRAFT, pending vetting.]*

## Feature set

**In, build order:**

1. View-to-plane correlation including sweeps (ranked #1 by the vetter; the differentiator nobody ships for CHD).
2. Simulated echo rendering per view (ranked #2; bar defined below).
3. Core 3D interaction: rotate, free cut plane, show/hide structures, labels, blood-pool coloring.
4. Provenance strip (trust architecture above).

**Kept only if nearly free:** normal-vs-lesion comparison as a same-viewer toggle with synced camera (ranked #6). No split-screen investment.

**Out of MVP, deliberately:**

- VR/visionOS (the vetter's first cut: "screen is good enough; echo is a 2D modality").
- Blood-flow visualization (her second cut; the accuracy veto binds: wrong flow is worse than no flow; revisit post-MVP only with an honestly-qualitative design).
- Beating-heart animation (v1 is static). Keyframed motion is the leading post-MVP feature candidate since it also animates the simulated echo.
- Notes/session export (ranked last). Shareable deep links may ship anyway as distribution mechanics (a link encodes anatomy + view + camera state); explicitly not a notes feature.
- Any handling of user-uploaded or arbitrary patient images (regulatory line; curated content only).

## Simulated echo: definition and bar

Raycast/slice through the labeled model, rendered echo-style: sector-fan geometry, speckle, depth-dependent gain feel, per-view orientation conventions (probe marker, standard display orientation). Static in v1. Every simulated frame is labeled as simulated, with provenance one tap away.

The realism bar is functional, not cosmetic: the clinical vetter should judge each shipped view "good enough to learn reading from." Her per-view vetting verdict is the pass/fail. The content schema reserves a per-view slot for a real de-identified clip, so real clips become an additive upgrade later (with their own licensing/IRB decision), never a rearchitecture.

## Design direction (core screen)

One screen is the product: 3D viewport + echo panel + view rail.

- Phone portrait stacks echo panel and viewport; desktop puts them side by side with the view rail persistent.
- The didactics path is sacred: open link, pick anatomy, pick view, scrub. Target under 15 seconds to "oh, THAT is where that plane sits."
- Two different plane tools coexist and must never be conflated:
  - **Free anatomical cut:** an independent, infinite clipping plane for inspecting the model. It can translate and rotate freely, renders solid caps at cut surfaces, and makes no claim to be a reachable or clinically useful echo view.
  - **Vetted echo wedge:** a finite sector from the saved probe pose for the selected named view or sweep. In learner mode it is controlled only by the view rail/scrubber and matches the echo-side fan one-to-one.
- Bridge actions may copy a vetted echo plane into the free cutter (for example, **Align free cut to echo view**) without editing or de-vetting the saved echo pose.
- Interaction should feel familiar: drag to orbit, pan separately, wheel/pinch to zoom, and reset to the pack's standard orientation. The selected object (heart/camera, free cut, or echo view) is always explicit. When the free cutter is selected, a visible slider plus modifier-wheel translates it along its own normal; wheel alone remains camera zoom.
- Per-view show/hide presets (suprasternal defaults to veins + arch, for example) instead of a raw structure checkbox forest; full manual control remains available.
- Provenance strip: one line at the bottom (source, vetter, date), tap to expand.

## Content pipeline (the real cost center)

Per anatomy: (1) acquire or sculpt the model, normalize to canonical pose; (2) segment and label substructures (known bottleneck: library models are fused meshes); (3) place all standard view planes and author sweeps; (4) tune simulated echo per view; (5) vetting pass (fellow + attending), provenance stamped, draft flag cleared. *[Update 2026-08-16: step 2 has a deeper risk than fusion — bloodpool casts lack myocardium/pericardium/leaflets entirely; see `docs/build_plan.md` "Anatomical substrate risk." The pre-content technical slice tests the full pipeline on one real asset first.]*

MVP content budget: 3 anatomies x (~10-12 view families + sweeps). Vetting capacity: the clinical vetter plus imaging attendings being scouted.

## Modularity and expansion (locked)

Engine and content are strictly separated:

- **Engine** (the web app): rendering, view rail, plane and sweep playback, simulated echo renderer, provenance display. Anatomy-agnostic; contains no lesion-specific logic.
- **Content pack** (one per anatomy, versioned): labeled mesh set in canonical pose, substructure hierarchy, view-plane and sweep definitions, per-view echo tuning, per-view real-clip slot, provenance/license metadata, draft/vetted status. Adding a lesion means authoring a pack, never touching the engine.
- **Ingest adapters** normalize any source into packs: Alberta library downloads, other open collections (UMCG Sketchfab, embodi3D, published case-report STLs; license checked per item), custom sculpts (the ASD module), and later CT/CMR-derived segmentations. The pack format should tolerate a future volumetric-data reference.
- Practical consequence: the MVP ships the first three packs; DORV and DILV land as packs four and five with zero engine changes. The pack schema is a milestone-1 deliverable. *[Update 2026-08-16: schema v0 drafted in `docs/build_plan.md`, provisional until the technical slice review.]*

## Build workflow

- **Planning and product docs:** the owner's planning folder is the source of truth for product intent, clinical context, decisions, and progress.
- **Implementation:** Claude Code, working from this doc plus `docs/build_plan.md` and `docs/view_canon.md`; the handoff prompt points at the plan first and requires acknowledging the approach before writing code. GPT Codex assists on code as directed.
- **Code ground truth:** this repository. Scope changes are recorded before implementation follows. Development loop: `WORKFLOW.md`.

## Licensing and regulatory

- Alberta 3D Heart Library models: CC BY-NC; attribution shown in-app on the provenance strip. NC constrains future commercialization; acceptable for a free educational v1. *[Update 2026-08-16: attribution requirements + credit template + NC red lines pinned in `docs/build_plan.md` licensing plan; the AB2 sinus venosus model is CC BY 4.0.]*
- Education only, not diagnostic; no interpretation of arbitrary patient images. Stays outside FDA SaMD territory; that line holds unless deliberately re-decided.

## Definition of done (MVP)

A shareable URL where the clinical vetter, on a phone, can: pick Normal, ASD (secundum or sinus venosus), or d-TGA; rotate and cut the labeled model; pick any standard view; see the plane wedge on the model with the simulated echo alongside; scrub at least one sweep per view family; and see provenance on every view. Done means every shipped view is rated "learnable-from" by the clinical vetter, and at least one co-fellow uses the link unprompted after she shares it.
