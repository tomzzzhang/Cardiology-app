# Contract: viewer-core

**Owns:** `src/viewer/**`
**Status:** implemented for the wave 1c slice. Superseded clauses are marked below; where this
page and the code disagree, the code is what shipped and this page is what was fixed.
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
- **The mathematical cutter is infinite.** The rendered rectangle is a helper sized from model
  bounds and never limits clipping. It is drawn deliberately LARGER than any cross-section it can
  take — a sheet of glass passed through the heart, not a window cut in one — because a rectangle
  smaller than the cut reads as if the cut stopped at its edge.
- The rectangle carries an **in-plane orientation** the mathematics does not: a cross-section reads
  as a rectangle rather than a disk, and in echo-synced mode its long edge is the sector's lateral
  axis, so it reads as the same slice the echo panel shows rather than an arbitrarily rolled one.
- Reversing the oriented plane changes which side remains visible.
- Cut faces render **solid**, via stencil-buffer caps. A hollow cut is a bug, not a style.
- The cutter is runtime inspection state. It is never written into `views[]`, and it makes no claim
  to be a reachable or clinically useful echo view.

## Interaction requirements

**Navigation.** Drag orbits around `C`. Pan is a separate gesture. Wheel/pinch zooms the camera.
Reset restores the pack's standard orientation.

*(Supersedes "familiar globe-viewer orbit feel is the reference", 2026-08-19.)* A globe has a fixed
axis and is never turned over; a heart read from underneath is neither, and reading that clause as a
turntable made some orientations unreachable — there was no drag that rolled the model, and near the
poles horizontal drag spun the picture in place instead of turning the object. **Drag now rotates
about the CAMERA's own axes**, so the model follows the hand at every orientation and local X and Y
between them reach the whole rotation group; roll comes out of a curved drag. What that gives up is
the guaranteed level horizon, and `Reset` is the way back to it. See `src/viewer/orbit.ts`.

**Direct manipulation, not modal selection.** *(Supersedes "explicit target selection", 2026-08-19.
The owner used the build and replaced the mechanism; the requirement it served is unchanged.)*

The requirement is that **a drag must never silently manipulate a different object**. That is met
positionally rather than by a mode: what a drag moves is decided by what is under the pointer, and
every movable object is drawn. A cut handle tips the plane, the probe's arrow scrubs the sweep,
anywhere else orbits the camera. There is no target selector, and no state a learner has to have
set before a drag does what they meant.

**Depth along the plane normal.** With the free cutter active, a visible slider and a modifier-wheel
translate it along plane-local `N`. **Wheel without the modifier always zooms** — no exceptions. The
slider, the wheel, the depth/offset readout, and reset stay synchronized: they are views of one `s`.
Sensitivity and direction inversion are user preferences if inexpensive.

**Rotation.** Four handles at the edge midpoints of the rendered rectangle, one per edge direction.
Rotation holds `s` constant while rotating `N` around the heart, and a gesture **freezes its start
normal and its pivot for the duration**, applying the drag's total offset, so the result does not
depend on the pointer's sampling rate and dragging back returns the plane.

The **grabbed handle follows the pointer**: a handle can only move perpendicular to its plane, so
the drag is measured along the screen projection of `N`, not along the handle's own direction. An
edge pair therefore gives two opposite controls rather than one doubled. Where the plane is nearly
face-on the handle has no screen direction to move in, and the gesture falls back to tipping the
edge the way a picture frame tips.

**Cutter modes.** *(Supersedes the one-shot align bridge, 2026-08-19.)* The cutter is always in one
of two named modes, and the name is on screen at all times:

- **Echo plane** — the cutter continuously follows the selected view's imaging plane as the sweep
  scrubs. The rectangle is not drawn and the handles are neither rendered nor hittable: the plane is
  not the learner's to move, and the wedge already shows where it is. The depth slider is disabled,
  because in this mode there is no depth to choose.
- **Free** — the cutter is the learner's, handles active, no relationship to the view claimed.

Switching to Free **adopts the current plane**, so the transition is continuous rather than a jump;
switching back re-acquires the echo plane. The echo panel does **not** blank in Free mode: the mode
name carries the distinction, which beats teaching it by an absence, and blanking on every stray
drag would be hostile now that the plane is directly draggable.

**Ghost cutaway.** The half the cutter removes is drawn back as a faint translucent shell, ON by
default and behind a toggle. It shares geometry with the anatomy and carries the reversed clipping
plane, so the two halves are complementary by construction. The kept half stays near-opaque, or the
ghost shows through it and blurs the one distinction it exists to draw.

**Touch.** Phone controls use visible handles and the depth slider, not hidden modifier gestures.
The fine/coarse rule lives in ONE module (`src/viewer/pointerClass.ts`) rather than per control: a
fine pointer reveals a handle on approach, a coarse pointer shows every handle permanently at a
thumb-sized target, because a touch screen has no hover and a proximity-revealed handle there is
simply an invisible control. Pinch-zoom and two-finger pan remain outstanding.

## The vetted echo wedge

A separate object with a separate data path. Built from `views[].probe`: anchor = `probe.origin`,
basis = `beam_axis`/`lateral_axis`, extent from `probe.fan`. One source of truth, so the wedge on the
model and the echo fan match **one-to-one**.

In learner mode the wedge is driven by the sweep — through the scrubber slider or through the
**probe control pad**, which is an input rather than a second owner: its fan buttons write the same
`t` the slider writes, hard-clamped to [0, 1], so every pose they can reach is
`frameAt(probe, sweep, t)` by construction.

**Buttons, not a drag.** A revision of this slice had a curved arrow under the probe that scrubbed
the sweep, and it is gone. Positioning a transducer is not a drag: the probe turns about three of its
OWN axes, a drag has two degrees of freedom and no way to say which it meant, and even the one motion
a drag can express unambiguously is better served by a button that steps a known amount than by a
gesture whose gain depends on where the camera is. The pad is a game-controller cross — fan up and
down, aim left and right — with roll in the top corners and stand-off in the bottom ones. Locked it
shows only the fan pair, because the other five have no on-track meaning.

**The one exception, and it is explicit.** *(Owner decision, 2026-08-19; supersedes "viewer-core
exposes no learner-facing control that repositions a vetted wedge".)* A **Free probe** toggle
unlocks the probe. It then turns about its own axes and slides along its own beam:

| Control | Axis | What is preserved |
| --- | --- | --- |
| fan (up/down) | the probe's lateral axis | the lateral axis; the plane sweeps through the heart |
| aim (left/right) | the elevation normal | **the imaging plane itself** — same plane, different part of it |
| roll (the two arcs) | the beam axis | the beam; the plane turns about it |
| stand-off (the two chevrons) | translation along the beam | the orientation entirely |

Each rotation preserves exactly one axis of the frame, and those three invariants are what the tests
pin — "left and right maintain the same plane" is a claim about geometry, not about the code.

**Stand-off is the only translation, and it is bounded by tissue.** Sliding the probe ACROSS the
chest would claim a different acoustic window, which is authored content; sliding it along the beam
only changes how far the transducer stands off. It stops before the aperture reaches the model
surface — this substrate has no chest wall, so nothing else prevents imaging from inside a ventricle
— and before the sector is pulled clear of the heart. Both stops are measured as a clearance from
the surface, so they mean the same thing on every view.

**Recentre** — the middle of the cross — returns the probe to the saved track at the current sweep
position without locking it.

The unlock is paid for by labelling rather than by hiding: see `contracts/README.md` for what is
withdrawn and what is restored. Nothing about it can write to `views[]`, and locking again returns
the probe to `frameAt(probe, sweep, t)` exactly.

## The structure palette has THREE states

*(Owner decision, 2026-08-19. `docs/observations.md` entry 24 is the reasoning.)*
`structureColour` is the single place a surface, its stencil cap and the beam dim read colour from,
so this is one function with three branches:

1. **Named, and in `PALETTE`** — the palette's colour, unchanged. These carry meaning: left heart
   red, right heart blue.
2. **Identified, but not in `PALETTE`** — a DERIVED muted colour, deterministic from the structure
   id and therefore the same in every session on every machine. All 86 BodyParts3D parts are here:
   every one of them is identified, from the source's own concept map, and they simply do not share
   slugs with a palette keyed to the Rodero substrate. One grey for all 86 said something false
   about them.
3. **Not identified at all** — the neutral grey, and nothing else may use it. Rodero's tags 11 to 24
   are here. Grey means one thing — "we declined to identify this" — and it only means that while
   nothing else can say it.

The state comes from `Structure.identified` in the pack, never from whether the palette happens to
know the slug: those are different questions and conflating them is what produced state 2's problem.

**The derived band cannot claim a side.** Chroma 14–26 against the palette's 44–62, lightness held
mid-range, and the hue arcs within 28° of the palette's left-red and right-blue excluded outright —
desaturating alone is not enough, because a muted slate blue is still blue to a learner who has been
taught what blue means. Within what is left, sibling structures have to be tellable apart, and that
is MEASURED in dE2000 over the packs in the repository (`tests/unit/palette.test.ts`), not judged by
eye. The derivation is a pure function of the id and cannot see that two structures are siblings, so
it cannot guarantee separation; the salt is chosen to maximise the worst pair, which as shipped is
8.2 dE2000 against a just-noticeable difference of 2.3.

**None of the three states is translucent**, and that is deliberate rather than an omission — see
the rule below. The brief that asked for three states described state 3 as "grey and translucent,
exactly as now, it must not change"; as of `b3bce93` it is grey and OPAQUE, because near-opaque
translucency is a depth-ordering hazard that made structures pop in and out under orbit
(`docs/observations.md` entry 34). "It must not change" is the instruction that was followed.

## Blood pool is drawn, and is not capped

`Structure.blood_pool` marks a cast of the lumen rather than tissue. Two rules follow, and the second
one is not cosmetic.

- **It renders translucent and cool**, so a cast-shaped pack cannot be mistaken for a wall-shaped one.
- **It gets NO stencil cap at the cut plane.** A cast source models a chamber as a solid — BodyParts3D's
  left ventricular cavity is 98 mL of geometry — so capping it paints a solid disc across the opening
  and the chamber reads as filled. It is filled in the file and it is not filled in a heart. Leaving
  the cut face open is the honest rendering: the clip removes the near half of the cast and the
  learner looks into the chamber at the wall behind it. Tissue still caps, because tissue cut across
  really does present a face.

Nothing else about a blood-pool structure changes: it draws, it ghosts, it clips. The cap is the only
thing withheld.

**Blood pool is the ONLY thing drawn translucent.** A `transparent` material goes into three.js's
transparent pass, which sorts per object and never per triangle; with `DoubleSide` geometry that
makes a mesh's own far surface blend over its near one in an order that flips as the camera turns.
Unnamed structures were once drawn at 0.95 opacity as an "unidentified" hint, and on a pack where
every structure is unnamed that read as structures popping in and out of existence under orbit
(`docs/observations.md` entry 34). Near-opaque translucency buys nothing a viewer can see and costs
correct depth ordering: if a structure needs marking as unidentified, mark it in a hue or a hatch.

## The cine axis — keyframed geometry in Explore

A pack may carry `meshes.keyframes`: N whole meshes plus a phase axis or a frame rate. The viewer
plays them in **Explore only**, with a play/pause and a frame scrub.

- **It is not the sweep, and it does not share the sweep's control.** The sweep moves one probe over
  one static heart. The cine moves the heart and has no probe in it. One slider meaning both would
  change meaning under the learner as they switched modes.
- **Playback bounces unless the pack says its frames meet end to end.** `keyframes.loop` is a pack
  field, not an assumption: half a cycle played on a loop shows the heart snapping from end-systole
  back to end-diastole, a motion no heart makes, presented as though it had been recorded.
- **Frames swap geometry and nothing else.** Materials, ghosts, stencil caps and the camera framing
  all stay frame 0's, so the heart does not re-frame in the viewport for reasons that have nothing to
  do with the heart. Swapping a frame reaches three places for each structure — the mesh, its ghost,
  and its cap — because all three hold their own reference to the geometry they share.
- **Frames load behind a standing scene.** Frame 0 is `meshes.gltf` and is built, framed and
  interactive first; the cine control comes alive only when the rest have arrived. A frame that
  fails to load leaves a static model rather than a broken one.
- **The rate is not a physiological claim.** Where the pack states no `fps`, playback runs at a
  legibility default and the control says the source stated no rate.

Motion in the ECHO renderer is deliberately not this. `src/echo/shaders/scanPass.ts` is O(depth²)
per scanline and says a restructure comes first; a moving echo is a separate task with a real
performance design in front of it.

## The direction data flows

**Probe → cutter, never the reverse.** The Echo plane mode reads the imaging frame the wedge and the
echo are built from and writes the cutter; there is no path back. Moving the free cutter does not
synthesize or relabel an echo image — there is no code path from `{N, s}` into the echo renderer.

The one-shot **Align free cut to echo view** bridge this contract used to specify no longer exists;
the Echo plane mode replaces it, and is a live relationship rather than a copy that decays.

## Definition of done

Orbit/zoom around `C` with no polar clamp; positional drag dispatch with every movable object drawn;
infinite clipping with solid caps and an optional ghost of the removed half; two named cutter modes;
depth control synchronized across slider, wheel and readout; pointer-class handling in one place.
Works against the stub pack — viewer-core does not depend on the wave 1 model-pipeline slice.
Outstanding: pinch-zoom and two-finger pan, per-structure show/hide, labels, measurement.
