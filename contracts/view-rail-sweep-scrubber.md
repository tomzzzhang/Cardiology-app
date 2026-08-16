# Contract: view rail + sweep scrubber

**Owns:** `src/views/**`
**Status:** contract only. Implementation is wave 1d, in parallel with viewer-core.
**Spec:** `docs/build_plan.md` v1.2 — "Architecture" (4); `docs/view_canon.md` (DRAFT).

## Responsibility

The view family rail, per-view presets, and the scrub control that animates the plane wedge and the
echo image **together**. This module is the **only** learner-facing driver of the vetted echo wedge.

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
3. **Learner mode cannot reposition a vetted wedge.** Named views and sweeps are the only controls.
   Arbitrary probe-pose work belongs to authoring mode. There is no "nudge the wedge" affordance.
4. **The free anatomical cutter is not this module's business.** Selecting a view does not move the
   free cutter. The single permitted interaction is the user-invoked **Align free cut to echo view**
   bridge, which *copies* the current echo plane into the cutter and never writes back.
5. **`structures_in_order` is teaching content.** Surface the ordered structures a sweep crosses;
   do not reorder, dedupe, or infer them.
6. **Display conventions come from the pack.** `probe.display.vertex`, `flip_lr`, `marker_side`, and
   `pack.display_flags` decide orientation — including the pediatric vertex-down default, the PLAX
   apex-left exception, and the stored-but-off dextrocardia profile. Apex-up/apex-down is a user
   toggle layered on top of the authored default, not a replacement for it.
7. **Every view family ships at least one scrubbable sweep** (`docs/mvp_scope.md`, non-negotiable).
   A view without a sweep is valid in the schema; a *family* with no sweep anywhere is a content gap
   and should be visible as one.
8. **Draft content is visibly draft-flagged** in the rail, from `views[i].provenance.vetted.status`.

## Definition of done

Rail lists every view in the pack grouped by family; selecting a view drives wedge, echo, show/hide
preset, and display flags together; scrubbing animates wedge and echo from one clock; draft views are
flagged. Works against the stub pack — this module does not depend on the wave 1 slice.
