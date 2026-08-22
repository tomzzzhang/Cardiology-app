# Contract: view rail + sweep scrubber

**Last Updated:** 2026-08-22 10:33 EDT

**Owns:** `src/views/**`
**Status:** NOT BEING BUILT AS SPECIFIED. The rail and canonical scrubber were **superseded by
owner decision on 2026-08-21**, after this contract had been queued as the next platform unit. The
existing model dropdown and the existing synchronised sweep slider stay; the probe's tilt arrow
stands in for the scrubber; views are reachable by `?view=` in the learner build and by the
authoring selector.

**The problem it was written for is still open.** A learner has no way to pick a view without
typing a URL, and this document remains the fullest statement of what a solution has to respect —
in particular that nothing learner-facing may write `views[]`, and that the scrubber is the only
learner-facing driver of the saved echo wedge. Read it as requirements for whatever replaces it,
not as a queued implementation. Two further clauses were superseded by the 2026-08-19 interaction
pass and are marked below.
**Spec:** `docs/build_plan.md` v1.2 — "Architecture" (4); `docs/view_canon.md` (DRAFT).

## Responsibility

The view family rail, per-view presets, and the scrub control that animates the plane wedge and the
echo image **together**. This module is the **only** learner-facing driver of the saved echo wedge.

## Interface shape

```
selectView(view_id)        -> applies views[i] : wedge pose, show_hide_preset, echo_tuning, display flags
scrub(t: number)           -> t in [0, 1] along views[i].sweep; drives wedge + echo from one clock
currentView(): PackView | null
currentSweepPosition(): number | null
```

The rail is built from `pack.views[]` grouped by `family`. Families are **not enumerated in the
engine**: `docs/view_canon.md` is a DRAFT pending clinical vetting, and hardcoding its taxonomy would
freeze draft clinical content into code. Group by whatever `family` values the pack declares, and
order by pack order.

## Rules

1. **One clock.** The wedge on the model and the echo image advance from the same `t`. They cannot be
   scrubbed independently, and they cannot lag each other by a frame.
2. **Pose is derived, never re-authored.** A sweep position is `views[i].probe` transformed by
   `views[i].sweep` — `{mode, axis, range, interpolation}` over `t ∈ [0, 1]`, `slerp` or `lerp` as the
   pack declares. `mode: 'translate'` uses `mm`; `tilt` and `rotate` use `deg`. The axis passes
   through `probe.origin` unless `sweep.axis.origin` says otherwise.
3. **The sweep has a probe-side affordance, and it is an input rather than a second owner.**
   *(Supersedes "there is no 'nudge the wedge' affordance", 2026-08-19.)* A **probe control pad**
   steps the sweep by calling the same `scrub(t)` the slider calls — one clock, hard-clamped to
   [0, 1] — so every pose it reaches is one the slider already reached, and one press is a known
   amount (2 degrees, or 2 mm) rather than a gesture whose gain depends on the camera. Locked it
   offers only that one pair of buttons; a view with no sweep gets no pad.

   Learner mode still cannot reposition a saved wedge **except** through the explicit **Free
   probe** unlock, which is an owner decision of the same date and is paid for by the echo panel
   withdrawing the view's name. Arbitrary probe-pose AUTHORING still belongs to authoring mode:
   nothing a learner can do writes to `views[]`.
4. **The free anatomical cutter is not this module's business.** Selecting a view does not move the
   free cutter, and the cutter never writes back. *(Supersedes the copy-only align bridge,
   2026-08-19.)* The cutter now has an **Echo plane** mode of its own in which it follows the
   selected view's imaging plane continuously; that relationship is owned by viewer-core and reads
   the same imaging frame this module drives. Data flows probe → cutter and never the reverse.
5. **`structures_in_order` is teaching content.** Surface the ordered structures a sweep crosses;
   do not reorder, dedupe, or infer them.
6. **Display conventions come from the pack.** `probe.display.vertex`, `flip_lr`, `marker_side`, and
   `pack.display_flags` decide orientation — including the pediatric vertex-down default, the PLAX
   apex-left exception, and the stored-but-off dextrocardia profile. Apex-up/apex-down is a user
   toggle layered on top of the authored default, not a replacement for it.

   *(Implemented 2026-08-19, owner decision.)* The toggle flips **the echo panel only and never the
   3D camera**: flipping the scene is more disorienting than helpful, and "Match echo" already
   exists to reconcile the two panels. `withApexFlip` inverts `display.vertex` for the rendered
   image and changes nothing else about the frame; applying it twice is the authored value back
   exactly, which is what makes it a layer rather than a replacement. It reaches the camera through
   exactly one door — "Match echo", whose job is to make the panels agree and which therefore has to
   orient to the image on screen rather than to the one the pack authored. Settled together with the
   horizon lock (`contracts/viewer-core.md`), because they are the same question about what "up"
   means and answering them apart produces two controls that disagree.
7. **MVP release target:** every shipped view family has at least one scrubbable sweep
   (`docs/mvp_scope.md`). A view without a sweep is valid in the schema; during platform work, a
   family with no sweep is a visible content gap, not a blocker on the rail or scrubber mechanics.
8. **Draft content is visibly draft-flagged** in the rail, from `views[i].provenance.vetted.status`.

## Definition of done

Rail lists every view in the pack grouped by family; selecting a view drives wedge, echo, show/hide
preset, and display flags together; scrubbing animates wedge and echo from one clock; draft views are
flagged. Works against the stub pack — this module does not depend on the wave 1 slice.
