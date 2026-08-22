# MVP scope — Cardiology app

**Last Updated:** 2026-08-22 07:13 EDT

> **Product scope.** Clinical collaborators are referred to by role, not name; interview documents stay in the owner's planning folder.

**MVP RELEASE TARGET LOCKED 2026-08-15.** This describes the eventual product destination, not
the acceptance criteria for ordinary platform checkpoints. It was informed by a clinical discovery
interview, feasibility work, and model availability; those inputs guide later productization but do
not silently become platform restrictions. Scope changes still belong in the planning record.

## Product in one sentence

A free, browser-based teaching tool where a pediatric cardiology trainee picks a heart (normal or lesion), rotates and cuts a labeled 3D model, and for any standard echo view sees exactly where that cut plane sits on the model, with a simulated echo image alongside and scrubbable sweeps.

## Decisions locked 2026-08-15

1. **Anatomy set, the "foundation slice":** Normal heart + ASD module (secundum and sinus venosus) + d-TGA. DORV with subpulmonary VSD is the first post-MVP anatomy, then DILV (S,L,L).
2. **Echo image posture: simulated, and invested in.** Echo-styled rendering from the labeled model;
   honest "simulated" labeling everywhere; per-view slot reserved for real clips later. v1 has no
   patient-image workstream. Third-party asset rights still apply to every source used now.
3. **Sequencing: scope locked on the clinical vetter's signal.** Co-fellow interviews stay open and can re-weight content priorities; they do not gate the build.
4. **Platform: web-first confirmed.** One shareable URL, no install. The active platform and first
   release target are hospital desktop and laptop. Phone/touch UX is paused for a separate later
   design pass; Native/visionOS stays a later showcase.
5. **Variant policy:** one canonical variant per lesion, named and disclosed in-app; further variants are later content rows through the same pipeline.
6. **Trust architecture direction:** visible provenance per anatomy and per view mapping (model source and license, who vetted, last-reviewed date); unvetted content is visibly draft-flagged. Vetter names appear only with recorded consent; role labels otherwise.
7. **Modular content direction:** the release should make new lesions self-contained content rather
   than one-off engine code. The current engine-plus-pack split is the starting hypothesis and may
   evolve during platform construction. See "Modularity and expansion" below.
8. **Build toolchain:** planning happens in ChatGPT or Claude Cowork; implementation happens in one local checkout. *[Update 2026-08-16: repo + hosting resolved — public GitHub repo `tomzzzhang/Cardiology-app`, GitHub Pages; see `docs/build_plan.md`.]*

## Why this anatomy set

The clinical vetter's three hardest lesions (DORV with subpulmonary VSD; DILV S,L,L; sinus venosus ASD) collide with model availability: the Alberta 3D Heart Library (best open source, CC BY-NC) has normal hearts, TGA, TOF/PA, TAPVR, HLHS, arch anomalies, and truncus, but no DORV and no DILV (checked 2026-08-15). *[Update 2026-08-16: a deeper sourcing sweep FOUND a sinus venosus model in the library's Sketchfab account — "Sinus Venosus Defect" (AB2), bloodpool, CC BY 4.0, downloadable. DORV and DILV remain absent, so the anatomy-set logic stands; the sculpt's sinus venosus half may start from AB2 instead of scratch. Scope unchanged.]* Her own framing resolves the tension: foundation first; with a foundation, new variants get much easier.

The slice is chosen so each piece pays for itself:

- **Normal heart** (library model). The foundation. Full standard-view coverage with sweeps is THE deliverable here; it also matches the "mastering normal hearts first" usage forecast and is the substrate for the ASD sculpt.
- **ASD module** (custom sculpt from the normal model): secundum ASD and sinus venosus ASD with typical RUPV PAPVR. Sinus venosus is on the hardest list; the module carries the "simple lesion intricacy" teaching the vetter called out (retro-aortic rim in PSAX with the aortic valve en face; septal anatomy from the RA side); and it is the cheapest credible custom-lesion sculpt, so it proves the custom pipeline before the expensive DORV build.
- **d-TGA** (library model). The great-artery-relationship lesion with a model already in hand: a stated hard theme (segmental designations, great-artery relationships) plus a board classic. Foundation for the DORV/DILV family later.

Queued after the MVP: DORV with subpulmonary VSD (the vetter's #1 hardest), then DILV (S,L,L).
Source outreach remains deferred until the integrated prototype is substantially complete.

## MVP release coverage floor

Every anatomy ships with ALL standard TTE views, not a curated subset: parasternal long-axis (including RV inflow/outflow) and short-axis sweep levels, apical 4C/5C and variants, subcostal long and short, suprasternal long and short, and high left parasternal/ductal as appropriate. Plus lesion-specific non-standard views where the lesion demands them (for the queued DORV: subcostal RAO and the TET view). Sweeps are first-class: each view family has at least one canonical sweep, scrubbable, with the plane animating on the model.

Per-lesion view emphasis (which views matter most for this lesion) is content metadata decided in vetting sessions, not hardcoded now. *[Update 2026-08-16: the encodable canon exists as `docs/view_canon.md`, DRAFT, pending vetting.]*

## Feature set

**MVP release feature set:**

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

The realism bar is functional, not cosmetic: during integration/release, clinical reviewers should
judge each candidate shipped view "good enough to learn reading from." That review is not a gate on
platform construction. The content schema reserves a per-view slot for a real de-identified clip,
so real clips remain an additive upgrade later, never a rearchitecture.

## Design direction (core screen)

One screen is the product: 3D viewport + echo panel + view rail.

- Desktop puts the echo panel and viewport side by side with the view rail persistent. The existing
  stacked narrow layout is not a supported phone design until the phone/touch workstream resumes.
- The didactics path is sacred: open link, pick anatomy, pick view, scrub. Target under 15 seconds to "oh, THAT is where that plane sits."
- Two different plane tools coexist and must never be conflated:
  - **Free anatomical cut:** an independent, infinite clipping plane for inspecting the model. It can translate and rotate freely, renders solid caps at cut surfaces, and makes no claim to be a reachable or clinically useful echo view.
  - **Saved echo wedge:** a finite sector from an authored probe pose for the selected named view or
    sweep. It may still be `draft`; review state is metadata. The wedge and echo-side fan match
    one-to-one.
- Free or unlocked poses may be explored, but they do not overwrite the saved pose and must not
  inherit its view name or review badge.
- Interaction should feel familiar: dragging the model orbits, dragging the visible cutter geometry
  manipulates the cutter, wheel/pinch zooms, and reset restores the pack's standard orientation.
- Per-view show/hide presets (suprasternal defaults to veins + arch, for example) instead of a raw structure checkbox forest; full manual control remains available.
- Provenance strip: one line at the bottom (source, vetter, date), tap to expand.

## Content pipeline (the real cost center)

Per anatomy: (1) acquire or sculpt the model, normalize to canonical pose; (2) segment and label
substructures; (3) place view planes and author sweeps; (4) tune simulated echo; and, during
integration/release, (5) complete clinical review and publication provenance. Platform work may
exercise any earlier step with draft or synthetic content without waiting for step 5.

MVP content budget: 3 anatomies x (~10-12 view families + sweeps). Review participants and capacity
will be confirmed during integration; discovery work supplied product direction, not a development
staffing commitment.

## Modularity and expansion (release direction)

The intended release architecture keeps engine and content cleanly separated. During platform
construction this is a testable design direction, not a gate: change the seam when implementation
evidence calls for it, then document the settled interface.

- **Engine direction** (the web app): rendering, view rail, plane and sweep playback, simulated echo
  renderer, and provenance display should be broadly anatomy-agnostic.
- **Content-pack direction** (one per anatomy, versioned): labeled mesh set in canonical pose,
  substructure hierarchy, view-plane and sweep definitions, per-view echo tuning, per-view real-clip
  slot, provenance/license metadata, and review status. New lesions should primarily be authored as
  content; a justified engine change during platform work is allowed.
- **Ingest adapters** normalize any source into packs: Alberta library downloads, other open collections (UMCG Sketchfab, embodi3D, published case-report STLs; license checked per item), custom sculpts (the ASD module), and later CT/CMR-derived segmentations. The pack format should tolerate a future volumetric-data reference.
- Intended consequence: the MVP ships the first three packs, and later lesions should require little
  or no engine-specific work. Schema v0 remains provisional throughout platform construction;
  schema v1 freezes only after review of the integrated prototype.

## Build workflow

[`WORKFLOW.md`](../WORKFLOW.md) is the sole authority for platform development and the later
integration, release, and clinical gates.

## Licensing and regulatory

- Third-party licensing is item-specific and must be reverified at use; do not infer one grant from
  a collection or sibling model. The current Alberta Normal pack has contradictory source statements
  and is `unconfirmed`; AB2 remains a later candidate whose recorded per-model grant must be checked
  again before use. Confirmed NC content remains separable and constrains commercialization.
- Education only, not diagnostic; no interpretation of arbitrary patient images. Stays outside FDA SaMD territory; that line holds unless deliberately re-decided.

## Definition of done (MVP)

A shareable desktop/laptop URL where a clinical reviewer can: pick Normal, ASD (secundum or sinus
venosus), or d-TGA; rotate and cut the labeled model; pick any standard view; see the plane wedge on
the model with the simulated echo alongside; scrub at least one sweep per view family; and see
provenance on every view. Phone readiness is a later milestone. Done means every shipped view is
rated "learnable-from" by the clinical reviewer, and at least one co-fellow uses the link unprompted
after it is shared.
