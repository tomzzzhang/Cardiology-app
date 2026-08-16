# Contract: viewer-core

**Owns:** `src/viewer/**`
**Status:** contract only. Implementation is wave 1c. Wave 0 ships a hello-world scene, not this.
**Spec:** `docs/build_plan.md` v1.2 — "Architecture" (2) and the whole "Viewer interaction contract".

## Responsibility

Scene, camera, and orbit. Per-structure show/hide, labels, blood-pool colouring. The independent free
anatomical cut plane with solid caps. A separate translucent sector-wedge probe indicator driven by
the same vetted probe pose and fan params as the echo panel.

## Coordinate frames — keep all three explicit

| Frame | Definition |
| --- | --- |
| model / anatomical | fixed canonical pack coordinates (`meshes.canonical_pose`, `meshes.orientation`) |
| camera / screen | X right, Y up, Z toward the viewer |
| plane-local | `U`, `V`, unit normal `N` |

Labels use anatomical directions. Interaction help may use plain-language screen directions.

## The free anatomical cutter

`C` is the pack's interaction pivot: `interaction.pivot` if supplied, otherwise the model-bounds
centroid. The cutter is the oriented radial plane `{N, s}`:

```
dot(N, X - C) = s          closest point   Q = C + sN
```

- `N` is normalized; `s` is signed distance from `C`, in pack `units`.
- **The mathematical cutter is infinite.** Any rendered rectangle is a helper sized from model bounds
  and never limits clipping.
- Reversing the oriented plane changes which side remains visible.
- Cut faces render **solid**, via stencil-buffer caps. A hollow cut is a bug, not a style.
- The cutter is runtime inspection state. It is never written into `views[]`, and it makes no claim
  to be a reachable or clinically useful echo view.

## Interaction requirements

**Navigation.** Drag orbits around `C`. Pan is a separate gesture. Wheel/pinch zooms the camera.
Reset restores the pack's standard orientation. Familiar globe-viewer orbit feel is the reference.

**Explicit target selection.** The active target is always visible and is exactly one of
**heart/camera**, **free cut**, or **echo view**. A drag must never silently manipulate a different
object.

**Depth along the plane normal.** With the free cutter active, a visible slider and a modifier-wheel
translate it along plane-local `N`. **Wheel without the modifier always zooms** — no exceptions. The
slider, the wheel, the depth/offset readout, and reset stay synchronized: they are views of one `s`.
Sensitivity and direction inversion are user preferences if inexpensive.

**Rotation.** Visible handles/gizmos. Default free rotation holds `s` constant while rotating `N`
around the heart. A gesture **freezes its pivot for the duration** so the plane cannot drift from a
continuously recomputed pivot. Fixed-anatomical-point and probe-origin rotation modes are
authoring/later refinements, not MVP requirements.

**Touch.** Phone controls use visible handles and the depth slider, not hidden modifier gestures.
Pinch zooms; two-finger drag pans.

## The vetted echo wedge

A separate object with a separate data path. Built from `views[].probe`: anchor = `probe.origin`,
basis = `beam_axis`/`lateral_axis`, extent from `probe.fan`. One source of truth, so the wedge on the
model and the echo fan match **one-to-one**.

In learner mode the wedge is driven **only** by the view rail and sweep scrubber. viewer-core exposes
no learner-facing control that repositions a vetted wedge; arbitrary probe-pose work lives in
authoring mode.

## The one permitted bridge

**Align free cut to echo view** — copies the selected echo plane into the free cutter. One-way and
copy-only. Subsequent free movement breaks the association and never modifies the vetted view.
Moving the free cutter alone does not synthesize or relabel an echo image; the echo panel keeps
showing only the selected vetted view/sweep output.

## Definition of done

Orbit/pan/zoom around `C`; explicit target selection; infinite clipping with solid caps;
plane-normal depth control synchronized across slider, wheel, and readout; touch controls; the
copy-only align bridge. Works against the stub pack — viewer-core does not depend on the wave 1
model-pipeline slice.
