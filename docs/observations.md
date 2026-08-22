# Observations — the visual review list

**Last Updated:** 2026-08-22 14:47 EDT

Not a changelog. This is the list of things worth *looking at*, written for whoever opens the app
next with the intent of judging it. Each entry says what to look at, why there was uncertainty,
how to tell whether it is right, and where in the UI to see it.

Anything guessed at, anything that looked plausible but is unverified, and anything traded off
belongs here. The changelog lives in the planning folder's `progress_log.md`.

---

## 1. What a drag moves is now decided by what is under the pointer

**Where.** Anatomy panel. There is no Heart / Cut / Echo view selector any more — it is gone, not
hidden.

**What to look at.** With the cutter in **Free** mode, move the pointer toward one of the four dots
on the edges of the cut rectangle: it should fade in before you reach it, and brighten when it is
close enough to grab. Drag it and the plane tips while the depth readout does not move a digit.
Drag anywhere else in the panel and the camera orbits instead. On a phone all four dots are visible
all the time, because a touch screen has no hover and a dot that only appears on approach is an
invisible control.

**Why it was uncertain.** The previous session shipped an explicit target selector because the
contract asked for one, on the reasoning that "a drag must never silently manipulate a different
object". That requirement is right and is unchanged. What changed is the mechanism: the requirement
is met by drawing every movable object and letting position decide, rather than by making the
learner set a mode first. A mode you have to set before a gesture does what you meant is a mode you
will forget to set.

**How to judge it.** The test is whether you ever have to think before dragging. If you find
yourself checking a control before moving the pointer, the affordances are not legible enough.

**Judgement calls, all of them worth a second opinion.**

- **Handle size and reveal radius.** A handle is drawn at exactly the size of its own hit target —
  16 px radius on a mouse, 26 px on a finger — so what you aim at is what catches. The fine-pointer
  reveal starts at 90 px and reaches full opacity at the grab radius. If handles feel like they
  appear too late, the 90 px is the number.
- **Which way a handle tips the plane.** A handle can only move perpendicular to its own plane, so
  the drag is measured along the screen projection of the plane's normal and the grabbed dot follows
  your hand. An earlier revision measured it along the handle's own direction, which made the dot
  move *against* the pointer and made opposite handles do the same thing. Watch the dot, not the
  plane: it should go where you go.
- **Face-on is degenerate.** When the plane faces you square-on, a handle genuinely has nowhere to
  move on screen, and no mapping can make it follow the pointer. There it falls back to tipping the
  edge the way a picture frame tips — push an edge inward, it goes away from you. Orbit slightly and
  the normal mapping resumes. Whether the changeover is noticeable is worth checking.
- **Four handles are two axes.** An edge and the edge opposite it drive the same rotation axis, in
  opposite senses. That is what a rectangle can offer; if you expected four independent rotations,
  it is not a bug.

---

## 2. The cut plane is a rectangle, and it has two named modes

**Where.** Anatomy panel, the row reading **Echo plane | Free**.

**What to look at.** In **Echo plane** the cutter follows the view's imaging plane as you scrub —
it is not aligned once and left, it tracks. The rectangle is not drawn at all in that mode and the
depth slider is disabled, because the cut IS the echo's plane and there is no depth to choose. The
**Cut** checkbox stays live either way, so you can turn the cut off and see the whole heart with the
fan still on it. Switch to **Free** and the rectangle and its handles appear, the plane is adopted
exactly where it was, and nothing jumps.

**Why a rectangle.** A cross-section reads as a rectangle; a disk has no in-plane orientation. In
echo-synced mode the long edge is the sector's lateral axis, so the rectangle reads as the same
slice the echo panel is showing rather than an arbitrarily rolled window on the same plane.

**How to judge it.** Scrub in Echo plane mode and watch the cut faces move with the fan. Then switch
to Free and confirm the picture does not move at the instant you switch — only the rectangle
appears. Then check the echo panel did NOT blank: the mode name carries the distinction, which beats
teaching it by an absence, and blanking on every stray drag would be hostile now the plane is
directly draggable.

**Traded off.** The rectangle is deliberately LARGER than any cross-section it can take — a sheet of
glass passed through the heart, not a window cut in one — because a rectangle smaller than the cut
reads as if the cut stopped at its edge. The cost is that a steeply tilted plane can carry a handle
off the edge of the panel. **Reset** brings it back. Whether the 3:2 proportion reads as a section
through a body, and whether the size is right, are both taste calls.

---

## 3. The probe is driven by a control pad, and it can be unlocked

**Where.** Anatomy panel, bottom right, headed **PROBE CONTROL**.

**What to look at.** Locked, it is a two-button rocker: up and down step the view's saved sweep by
two degrees a press, and holding one repeats. Unlocked, it becomes a game-controller cross with four
more controls in the corners.

**Why buttons and not a drag.** An earlier revision of this slice had a curved arrow under the probe
that you dragged to scrub. It is gone, deliberately. Positioning a transducer is not a drag: the
probe turns about three of its *own* axes, a drag has two degrees of freedom and no way to say which
of the three it meant, and even the one motion a drag can express unambiguously — sliding along a
one-dimensional track — is better served by a button that steps a known amount than by a gesture
whose gain depends on where the camera happens to be.

**What each control does, and what it leaves alone.** Each rotation preserves exactly one axis of the
probe's frame, which is what makes them three distinct clinical motions rather than three ways of
nudging:

| Control | Turns about | Leaves alone |
| --- | --- | --- |
| ▲ ▼ fan | the lateral axis | the lateral axis — the plane sweeps through the heart |
| ◀ ▶ aim | the elevation normal | **the imaging plane itself** — same plane, different part of it under the fan |
| ↺ ↻ roll | the beam | the beam — the plane turns about it, four-chamber toward two-chamber |
| chevrons | nothing; slides along the beam | the orientation entirely |
| centre dot | nothing; recentres | — |

**How to judge it.** Press ◀ or ▶ and watch the cut plane in Echo-plane mode: it should not move at
all, because the imaging plane is unchanged and only the beam's aim within it has. Press ▲ or ▼ and
the plane should sweep. Press ↺ and the plane should turn about the beam. If aim moves the plane,
the axes are wrong.

**The unlock, which is the significant change.** The **Free probe** checkbox turns the probe by hand,
off the view's saved sweep track. Everywhere else the probe is pinned to its view, and that
constraint is what lets the echo panel put a view's name on an image. Unlocking it is a deliberate
owner decision (2026-08-19) and it is paid for by labelling, not by hiding:

- the echo keeps rendering, because seeing what a plane images is the point;
- the moment the probe has *actually* moved — turned OR slid — the panel's heading becomes "Free
  probe — not a saved view", the draft flag becomes "Unvetted plane", and the sweep slider is
  disabled and says the probe is off its track;
- turning the checkbox on and pressing nothing changes nothing, because nothing has stopped being
  true;
- the centre dot recentres onto the saved track without locking, and the claim comes back with it;
- unchecking discards the free pose and returns the probe to the saved track exactly.

**The stand-off, and its stops.** The two chevron buttons are the only translation offered. Sliding
the probe *across* the chest would claim a different acoustic window, which is authored content;
sliding it *along its beam* only changes how far the transducer stands off the tissue. It stops
before the aperture reaches the model surface and before the sector is pulled clear of the heart,
and both stops are measured as a clearance from the surface so they mean the same thing on every
view. A button at its stop is dimmed rather than removed.

**Why the probe looks so close to the heart in the first place.** It is 8 mm off the epicardium, and
that gap is *empty space*. This substrate is heart-only: no skin, no subcutaneous fat, no intercostal
muscle, no pericardium, no ribs. In a patient there would be several millimetres to a couple of
centimetres of tissue there. The pipeline says so in every view's placement landmark, and putting
fake tissue in the gap would be inventing anatomy. Worth knowing when the near field of the echo
looks emptier than a real one.

**The depth arrow, and the slider that is gone.** The cut plane now carries a double-headed arrow
along its own normal; dragging it slides the plane through the model at 1:1 with the hand, in model
units, at whatever zoom. The depth slider it replaced has been removed. A slider is a fine control
for a number and a poor one for a plane: it sits outside the picture, so you look away from the
thing you are moving, and its travel means nothing in the scene. **What that costs is keyboard
reach** — a range input works without a pointer and a 3D drag does not. Shift-wheel still writes the
same value, and the readout still shows it. Worth deciding whether the slider should come back as a
keyboard affordance.

**Judgement calls.** Two degrees and two millimetres per press, repeating after a third of a second;
the pad's size and its bottom-right corner; and the chevron-and-bar glyphs for stand-off. The glyphs
are deliberately NOT arrows: an arrow encodes a screen direction, and a screen direction is only
right for one camera — the heart is above the probe in an apical view and elsewhere in others, so an
arrow pointing at the tissue in one view points away from it in the next. The two are one glyph
drawn once and flipped, so they are exact mirrors.

**Removed at the owner's request.** The orientation marker that used to sit on the probe body.
`display.marker_side` still decides how the sector maps to the displayed image, but the probe no
longer shows which of its sides becomes the left of the panel. That is a real loss of information,
recorded here rather than passed off as a simplification.

---

## 4. Explore mode

**Where.** Top of the screen: **Echo | Explore**. Also `?mode=explore`, which is shareable.

**What to look at.** Explore drops the probe entirely — no echo panel, no wedge, no tilt arrow, no
beam-dim control, no "Match echo" — and forces the cutter free, because there is no probe to sync
to. What is left is a labelled heart you can orbit, cut and inspect. The non-diagnostic notice stays
in both modes; it is not behind a toggle.

**Why it is here.** The app is not only an echo trainer. It is also a free heart-model explorer, and
that is a first-class mode rather than a tool — deliberately reversing the earlier note that said
the opposite. Echo stays the default on a cold link with no param, so the
open-link-to-an-oriented-view path is unchanged for someone arriving cold.

**Unresolved, and explicitly the owner's call.** What Explore's default camera framing should be. It
currently inherits Echo's, minus the room reserved for the probe, which is defensible and not
designed. A mode whose whole purpose is inspecting the model probably wants its own opening shot.

---

## 5. The removed half can be put back as a ghost

**Where.** Anatomy panel, the **Ghost** checkbox, next to **Cut**. **On by default.**

**What to look at.** The half the cutter takes away, drawn back as a faint translucent shell in its
own tissue colour, so the section can be read against the whole heart it came out of. Off, the cut is
a clean section.

**One consequence worth knowing.** The fourteen unnamed vein and caval stubs are drawn slightly
translucent — that translucency is how the viewer says "we have not identified this", see entry 16 —
and at the opacity they had, the ghost showed *through* them and blurred the one distinction the
ghost exists to draw. They are now only just translucent. If the stubs stop reading as unidentified,
that is the number that moved.

**How to judge it.** The ghost must never compete with the cut faces — it does not write depth, so it
should sit behind them rather than fogging them. If the cut face looks hazy, the opacity is too high;
if you cannot tell what was removed, too low. It is one number (0.07) and it is a taste call.

---

## 5b. The cut faces no longer paint through the tissue in front of them

**Where.** Anatomy panel, with **Cut** on. Orbit right round the model.

**What was wrong.** The stencil cap quads were drawn with the depth test OFF, on the reasoning that
everything surviving the clip lies behind the plane so nothing could occlude them. That holds only
while the camera is on the discarded side. From the side that was KEPT, the whole remaining half of
the heart sits between the eye and the plane — and an untested cap painted its palette colour
straight over it. The coloured cross-sections showed through solid tissue, which looked like a
translucency setting and was actually a depth bug.

**A consequence worth knowing.** With the test on, a cut facing away from you now correctly shows
nothing — so the cut had to learn which way to open. It now removes the half nearer the camera when
it is switched on, and on **Reset**. Deliberately not continuously: a cut that flipped itself
halfway through an orbit would be worse than one facing the wrong way, and **Reverse** is right
there.

**How to judge it.** Turn the model all the way round with the cut on. The cut faces should be
visible from one side and hidden from the other, and the heart should look solid from the far side
rather than tattooed with coloured outlines.

---

## 5c. The anatomy panel is now as tall as the echo image plus its scrubber

**Where.** Side-by-side layout, which is any viewport at least 900 px wide. Below that the two panels
stack, which is unchanged.

**What to look at.** The 3D viewport should be about as tall as the echo canvas and the sweep row
beneath it together, with the cut and probe controls sitting below that. Previously it was a 4:3 box,
which left the model in a container two thirds the height of the image it is supposed to be read
against.

**How it is sized.** From the COLUMN width rather than from a guess: both stage columns are `1fr`, so
the anatomy column is exactly as wide as the echo one, and the echo canvas is 4:3 of that width. The
height is that plus a constant for the header and scrub rows. It therefore stays correct at every
window width rather than at the one it was eyeballed at.

**Worth checking.** That the controls below the viewport do not push the panel past the echo column
by enough to look unbalanced, and that the stacked phone layout still uses the 4:3 box, where there
is no second column to match.

---

## 6. Camera and wheel

**Where.** Anatomy panel.

**What changed.** The orbit's vertical sense was **inverted** and is now corrected: drag up and the
face of the model nearest you goes up. The old behaviour made the near surface run away from the
pointer, which reads as pushing the model rather than turning it. Pinned by a test stated in terms
of where a model point lands on screen, because both signs produce a perfectly smooth orbit and the
wrong one is only wrong to a hand.

The wheel's zoom step is 10% → **4%** per notch. A wheel that crosses the whole useful range of
distances in three notches cannot be used to look at something slightly closer.

Camera framing now fits the probe's whole travel, capped at 1.5× the model's reach. Uncapped, fitting
a transducer that sits out on the chest wall shrank the heart to a third of the panel; uncapped the
other way, the probe and its arrow left the panel entirely. The cap is a judgement call between two
things the learner needs at once, and it is the number to change if the heart feels small.

---

## 7. The four valve rings now have names, and colours

**Where.** Anatomy panel, any view. Four small ring-shaped structures at the base of the heart:
pale gold (mitral), pale green (tricuspid), pale violet (aortic), pale teal (pulmonary).

**Why it was uncertain.** Until this session the pipeline *assumed* tags 7–10 were the mitral,
tricuspid, aortic and pulmonary rings, on centroid position, and the whole frame rests on that
reading — the base plane is the mean of the four ring centroids. They are now identified by what
each one separates (mitral borders LV and LA; tricuspid RV and RA; aortic LV and aorta; pulmonary
RV and PA), which is topology rather than position, and the result agrees with the published
Rodero mapping exactly.

**How to judge it.** Turn the model so the base faces you, hide the myocardium if it helps.
The mitral ring should sit left-and-posterior with the aortic ring wedged against it — those two
are fibrously continuous in a real heart and should look adjacent here. The pulmonary ring should
be the most anterior and most superior of the four, and the tricuspid the most rightward. If any
one of those reads wrong, the frame is wrong and everything downstream inherits it.

**Traded off.** They are called *rings*, not *valves*, everywhere. This substrate has the fibrous
annulus as tagged elements and no leaflets at all. If the labels ever say "mitral valve" without
"ring", that is a regression in honesty, not a copy improvement.

**Unverified.** The pulmonary ring's border against the pulmonary artery is the weakest of the
eight measured borders — 44 shared triangles against the pulmonary artery versus 497 against the
right ventricle. It is still 25× above the strongest spurious contact in the mesh, so the
identification is not in doubt, but it means the pulmonary ring meets the artery over a small
area on this mesh. Worth a glance at whether the pulmonary ring looks anatomically continuous
with the artery or slightly detached from it.

---

## 8. The echo was sampling a transposed heart — and that was the real defect

**Where.** Echo panel. Compare it against the 3D panel's wedge: the two are supposed to be showing
the same slice of the same heart.

**Why it was uncertain.** The previous session recorded the thin bright walls as an echo-tuning
finding, with `boundaryReflection` blamed for saturating the interfaces while the interior stayed
dark. That reading was wrong. The label volume was being written x-slowest by the Python pipeline
and read x-fastest by `texImage3D`, so **every pack shipped an x/z-transposed volume**. The
renderer sampled the transposed heart while the wedge on the model used the untransposed geometry.
The two panels were showing different slices — and because a heart is a compact blob, the result
looked like a plausible echo of a plausible heart.

**How to judge it.** Turn the cut plane to the echo plane and compare the cut faces with the echo
image, chamber for chamber. They should now correspond. Before this fix they could not, no matter
how the echo was tuned.

**Guarded now.** `npm run validate:packs` checks each label's voxel centroid against the vertex
centroid of the mesh node it names, so an axis permutation fails CI. Every check that existed
before was satisfied by a permuted volume — same bytes, different order.

---

## 9. Echo tuning: before and after

**Where.** Echo panel, apical four-chamber, sweep parked at 0°.

**Measured with** `npm run measure:echo` (against a built `dist/` on `http://127.0.0.1:4173`),
which marches the shader's own rays, reads the label the pack carries at each depth, and reads the
displayed grey at the screen pixel that depth lands on.

| | before | after |
| --- | --- | --- |
| blood / background, mean grey | 0.07 (median **0**) | 0.11 (median 0.04) |
| LV myocardium, mean grey | 0.70 | 0.53 |
| valve ring, mean grey | 0.94 | 0.59–0.90 |
| rim vs core brightness across a wall, **displayed grey** | 0.97 | 1.21 |
| rendered wall thickness, near-perpendicular chords | 10.5 mm | 10.5 mm |
| true wall thickness, same chords | 10.5 mm | 10.5 mm |

**What changed and why.**

1. **The PSF's coherent pass was normalising wrongly.** It divided by `sum(w)` — an average —
   which attenuates independent scatterers by about 9 dB *at this resolution*, and by a different
   amount at any other. Tissue brightness therefore depended on the renderer's internal sampling
   rather than on the echogenicity the pack authored. It now divides by `sqrt(sum(w²))`, which is
   the normalisation that leaves white noise with the variance it arrived with.
2. **Interior scatter and boundary reflection now have separate scales**, via a new `scatter` knob.
   Diffuse backscatter sits ~20 dB below a specular interface, which is physical, and is what makes
   a wall a band with a border rather than a border alone.
3. **The window was too narrow to hold both ends**: at 55 dB tissue clipped to white while blood
   fell through a rejection floor set *above* it, so the sector was a two-tone mask with no mid-grey
   anywhere. Now 60 dB, with rejection below blood.

**How to judge it.** The wall should read as a textured mid-grey band with a brighter border, not
as a white outline; blood should be dark but grainy, not a black hole; the valve rings should be
the brightest things in the image. If it reads as a segmentation mask, this regressed.

**Kept on purpose.** A wall lying along the beam still loses its bright border while keeping its
interior. That is lateral dropout, and it is teaching content.

**Units, corrected on 2026-08-19.** Every figure in the table above is **displayed grey**, after the
60 dB log window and gamma 1.25. That is not the same quantity as the "~20 dB" the design comment in
`acoustics.ts` speaks of, and the two are not in conflict — they are three different numbers:

| Number | What it is |
| --- | --- |
| ~20 dB | Diffuse backscatter below a **perfect reflector**, in the pre-compression envelope. A statement about the model, not about this pack. |
| ~14 dB | What this pack's strongest real interface — blood against myocardium, an echogenicity step of 0.53 — returns above the tissue interior, pre-compression, at the interface itself. |
| 1.21 | Displayed grey averaged over the outer 1.5 mm of a wall chord against its middle. Worked back through the window and gamma: **6.3 dB** of envelope separation over that window. |

6.3 is lower than 14 because the axial PSF is 0.7 mm, so a 1.5 mm window mixes interface energy into
the "core" and interior energy into the "rim". Nothing measured was wrong; the wording was, in both
places, and is fixed.

**Unverified / taste.** `scatter: 0.1`, `dynamicRangeDb: 60`, `tgcDb: 8` and `reject: 0.0008` are
chosen to land the three levels where the table above says, not measured against a real scanner.
The grey a real pediatric machine puts on myocardium at these settings is a question for the
imaging attending, and `echo_tuning` per view exists precisely so the answer can be authored.

---

## 10. Display orientation: the renderer was honouring `display.vertex` backwards

**Where.** Echo panel. The sector's vertex — the transducer point, where the fan is narrowest —
should now be at the **bottom** of the panel, with the fan opening upward: atria at the top,
ventricles below, cardiac apex at the bottom.

**Verdict on the question asked.** The authored view was **right** and the renderer was **wrong**.
The pack declares `display.vertex: "down"`, which `docs/view_canon.md` makes the pediatric default
for the subcostal and apical families. `displayPass.ts` mirrored the panel when the flag said
`down` and left it alone when it said `up` — exactly inverted — so the deployed apical four-chamber
rendered vertex-**up**, the adult convention.

**How to judge it.** For this view the transducer sits at the cardiac apex, so vertex-down and
apex-down are the same thing: the apex should be at the bottom of the image and the atria at the
top. Against an adult lab's four-chamber this will look upside down. That is correct here.

**Guarded now.** A visual test measures the horizontal extent of lit pixels near the top and near
the bottom of the canvas: a sector is pinched at its vertex and wide at depth, so the shape says
which way up the fan is. Every previous assertion on this canvas was about grey levels, and a
vertically mirrored sector has exactly the same ones.

**Still open.** The apex up/down user toggle is not built. The pediatric default is now correct,
which is the part that had to be right first.

---

## 11. The model turns all the way over now

**Where.** Anatomy panel. Drag downward a long way — past where it used to stop — and keep going.

**Why it was uncertain.** The camera's `up` was pinned to (0, 1, 0), which has no basis when the
camera looks straight down and inverts past that, so pitch was clamped to ±1.5 radians. The clamp
was a workaround for the degeneracy, and it also made the heart impossible to turn over — which a
subcostal view needs, since that view is read from underneath.

**How to judge it.** Turn the model fully upside down and confirm it never flips, tears or goes
blank at the top and bottom of the orbit. Then check that a horizontal drag still turns the model
the way your hand goes *while it is upside down* — that correction is deliberate, and without it
the model fights the pointer for half the orbit.

**Unchanged on purpose.** The pivot is still `C`, and the wheel without a modifier is still zoom.

**Traded off.** There is no "up is up" stop any more, so it is possible to leave the model at an
odd angle and lose your bearings. **Reset** returns it. Whether a soft detent near upright would be
worth having is a judgement call for review.

---

## 12. "Match echo" — the button that makes the correspondence visible

**Where.** Anatomy panel, in the control row. Press it and the model turns to face the echo's
imaging plane over about three quarters of a second.

**What it claims.** Only that the camera is now looking at the model the way the echo panel
presents it: the beam axis running up the screen (because this view is vertex-down), the fan's
lateral axis across it. It is **camera only** — it does not move the wedge, the cutter, the sweep
position, or anything in the pack.

**How to judge it.** After pressing it, the shape of the heart in the anatomy panel should read as
the same slice the echo shows, at the same rotation. Turn the cut on and it should agree too. Then
check the sweep slider and the cut readout have not moved.

**Decision worth knowing.** `flip_lr` is honoured by viewing the plane **from the other side**, not
by mirroring. A mirrored model is a left-handed heart, and an anatomy viewer must not be able to
show one by accident. No view in the pack sets `flip_lr` yet, so this is untested against real
content.

**Why the camera state changed shape.** Matching the echo generally needs a *roll*, and yaw and
pitch cannot express one — the up vector follows from them with no freedom left. The camera now
holds a full rotation, which is also what removed the pole from item 5 above.

**Not built.** It matches orientation only, not zoom or framing. Whether it should also frame the
sector's depth is a judgement call for review.

---

## 13. RETIRED — three targets, one drag, and the one-way bridge

**Superseded on 2026-08-19.** This entry described the Heart / Cut / Echo view selector and the
one-shot **Align cut to echo view** button. Both are gone. The owner used the build and replaced
the interaction model: what a drag moves is now decided positionally (entry 1), and the cutter has
two named modes instead of a one-shot copy (entry 2).

Kept as a stub rather than deleted, because the entry recorded a question — "should the Echo view
target scrub, or refuse to move and say why?" — and the answer is now visible in the build: the
probe carries a scrub arrow that writes the same `t` the slider writes, and a separate, explicitly
labelled unlock for going off the track entirely (entry 3).

---

## 14. Beam dim: the two channels now do different jobs

**Where.** Anatomy panel, the **Beam** checkbox. On, everything the beam does not cross is pushed
toward grey and down in brightness.

**What changed.** One knob became two. Luminance 58% → **60%**, saturation 62% → **28%**. So the
surround is barely darker than before but much greyer, and the imaged band is now marked mostly by
being the part that still has colour.

**Why that split.** Lightness is the channel the eye segments a scene by, so it carries the
marking. Hue *difference* survives being cut hard — two colours stay tellable apart long after
they have stopped being vivid — so saturation is where the cutting can happen cheaply.

**The test that set the numbers.** Outside the beam, can the right ventricle still be told from
the left atrium at a glance? Measured in CIE Lab over the shipped palette rather than judged by
eye. At the specified 72%/28% starting point the answer was yes with a lot of room (25 Lab units),
so luminance was pushed to 60%. The binding constraint turned out not to be that pair but the
**gold left atrium against the green right atrium**, which sits at 11.8 — above the ~10 where two
colours stop reading as different at a glance, and the reason it stopped at 60% rather than going
lower. In/out contrast is 49.8, up from 41.0.

**How to judge it.** Toggle **Beam** off and on. Off, every structure should be its own colour.
On, the band the beam crosses should be obviously the coloured part of the picture, and you should
still be able to name the right ventricle and the left atrium in the greyed surround without
hovering anything. If the surround has gone anonymous, saturation is too low; if the band does not
stand out, luminance is too high.

**Taste.** This is a deliberate trade and a matter of taste. `UI-2` in the planning folder's
`ui_design_questions.md` is now closed on these values, with the measurement recorded there.

---

## 15. Three views authored, two deliberately not

**Where.** The pack now carries four views. The shell still shows one at a time and there is no
rail yet, so reach them by URL:

- `?view=b1-apical-four-chamber` — the default
- `?view=c1-parasternal-long-axis`
- `?view=c2-parasternal-short-axis`
- `?view=ingest-reference-pose` — the mechanical pipeline artefact, not a clinical view

**What to look at.** For **C1**, the plane should run down the long axis of the left ventricle with
the aortic root at one end and the mitral ring beside it — those two are fibrously continuous, and
whether they read as continuous here is the single best check on the plane. The apex may be
foreshortened or out of the sector; that is correct, and is why the apical window exists. For
**C2**, scrub the whole track: the left ventricle should stay a ring in cross-section from base to
apex, with the right ventricle a crescent on one side, and the ring should shrink toward the end.

**Why A3 and A4 are missing.** They were asked for and are not here. The subcostal family is
defined by the beam entering from *below the diaphragm* — that is what puts the atrial septum
near-perpendicular to it, which is A3's entire teaching payload. "Below" is a **body** axis, and
this mesh has no spine, diaphragm or chest wall; the three defensible proxies for body
superior-inferior disagree by up to 46° on it. A guessed placement does not look guessed: it
renders a plausible sector through the atria whose stated claim is false. A4's bicaval *plane* is
derivable here, so **F1, the right parasternal bicaval, is the honest route to that content** —
worth deciding whether to author it next.

**Why C1 and C2 are allowed where A3 is not.** A parasternal probe sits *anterior* to the heart,
and anterior is a derived cardiac axis with an independent check behind it — the pulmonary valve
sits anterior to the aortic valve, and nothing in the frame's construction knows that. So the
parasternal views are placed against a measured axis, not a guessed one.

**`structures_in_order` is now populated, and the distinction matters.** It was empty on the
grounds that naming what a sweep crosses is a clinical reading. Naming them is; *measuring* which
structures the fan intersects is arithmetic. The pipeline walks each sweep and records which
structures have geometry inside the sector, in the order it first reaches them, and it never
consults the canon's list. Restricted to structures with real names — an annotation reading
"tagged region 19" teaches nothing.

**Worth checking that it reads as sensible.** B1's measured order comes out: four chambers, then
the two AV rings, then the aortic wall and ring, then the pulmonary artery and ring. That is the
canon's description of the anterior tilt reaching the outflow tracts — the "five-chamber" — arrived
at by measurement rather than by being told. If it ever stops looking like that, something moved.

**Still unverified.** Indicator clocks, `marker_side` and `flip_lr` are the canon's values carried
across untested for all three views. Fan angles (80°, 70°, 70°) are chosen, not measured. C1's
sweep is one monotonic track from the RV-inflow side to the RV-outflow side; the canon's protocol
returns to the reference between them, which one slider cannot express — that is UI-3 in the
planning folder.

---

## 16. Tags 11–24 are still unnamed

**Where.** Anatomy panel: fourteen small grey structures around the atria — pulmonary vein stubs,
caval stubs, the left atrial appendage.

**Why it is here.** Adjacency identifies the valve planes because each borders exactly *two*
chambers, which is a unique signature. Every one of tags 11–24 borders exactly *one* chamber
(eight on the left atrium, six on the right), so adjacency cannot tell a right upper pulmonary
vein from a left lower one. Telling those apart needs a clinical reading and they stay generic.

**How to judge it.** Nothing to check — this is a deliberate gap. It is noted so the grey stubs
are not mistaken for a rendering failure.

---

## 17. The valve rings are not tellable apart outside the beam

**Where.** Anatomy panel, **Beam** on. The four small rings at the base of the heart, in the greyed
surround rather than in the lit band.

**What to look at.** The pale-green tricuspid ring against the pale-teal pulmonary ring. Outside the
beam they are dE2000 **3.4** apart, which is a little above a just-noticeable difference and far
below the ~10 at which two colours read as different structures across a panel. Four other pairs are
also below 10: RA myocardium vs pulmonary artery wall at 4.8, mitral vs tricuspid ring at 7.8, LV
myocardium vs aortic wall at 9.0, mitral vs pulmonary ring at 9.8.

**Why it happens.** The rings are hued *toward* the chamber each one guards, which is what makes
them readable at full brightness and what makes them collapse onto their chamber's neighbours once
chroma is cut. The two dim knobs are also not independent: multiplying all three channels scales
chroma along with lightness, so pushing luminance down spends saturation budget whether it means to
or not — which is why the pair that runs out first is a pair separated mainly by hue.

**What is guaranteed instead.** The four chamber myocardia. That is the claim the tuning was pushed
against, it holds at 12.8, and `tests/unit/beamDim.test.ts` now pins both it and the full-palette
worst pair, plus the COUNT below the threshold, so a change that trades one pair for another cannot
pass by leaving the single worst figure alone.

**Explicitly not decided.** Whether the rings should stay tellable apart outside the beam. Fixing it
means retuning either the dim or the palette, and both are the owner's call. Nothing has been
retuned; this entry exists so the current answer is on the record rather than assumed.

---

## 18. `structures_in_order` is empty for the short-axis sweep, on purpose

**Where.** `public/packs/normal-rodero/pack.json`, `c2-parasternal-short-axis`. Not visible in the
app yet — the sweep scrubber that would surface it is wave 1d.

**What was measured.** At which sample of 0..60 does each sweep first reach each named structure?

    b1 apical four-chamber   samples [0, 5, 7, 30, 31, 52, 56]
    c1 parasternal long axis samples [0, 6, 23, 30]
    c2 parasternal short axis samples [0]

**Why it matters.** C2's sector is wide enough that its very first position already contains every
named structure, so nothing about the *sweep* decided the order — the size tie-break did, and the
result was simply the ten structures sorted largest first. That is a fact about the mesh. It shipped
looking exactly like a measurement of the sweep, which is the kind of plausible-but-empty content
this project refuses elsewhere, so C2 now emits **no list at all** and its provenance says why. B1
and C1 are unchanged and carry real information.

**How to judge it.** When the scrubber is built, C2 should have no annotated ticks and should not
apologise for it. A tick that marks nothing is worse than no tick.

**A related inconsistency, noted and NOT changed.** `structures_in_order` counts a structure as
reached if **any single surface vertex** falls in the sector. `src/viewer/beamDim.ts` explicitly
rejected that same criterion for its highlight, on the grounds that it calls a whole chamber crossed
when the beam clips one corner of it — "which is precisely the judgement the learner is trying to
make". So the scrubber's list and the on-screen highlight still disagree about what "reached" means.
Changing the criterion changes which structures every shipped view claims to cross, which is a
content decision rather than a cleanup, and it is left for the owner.

**One thing that IS reconciled.** The elevation slab was two numbers — 6.0 mm in the pipeline, 5 mm
in the viewer — for the same physical quantity, so the scrubber would have named structures the
highlight did not mark, invisibly, because both render something plausible. Both now read
`shared/imaging-constants.json`. **6.0 won**: the shipped views were authored and validated against
it, and the two uses fail in opposite directions — in the pipeline it is a tolerance that can be
wrong, in the viewer it is a highlight thickness where a millimetre is imperceptible.

**Worth knowing.** Re-running the ingest on a different NumPy reproduces the pack to about the last
float digit but not bit for bit, so `model.bin` and the pose numbers churn slightly. Nothing
downstream depends on the difference, and `validate:packs` passes either way.

---

## 19. The echo does not depend on the renderer's internal sampling

**Where.** Not visible in the app. Measured with `npm run measure:echo`, and asserted by
`tests/visual/echo-resolution.spec.ts`. Reproducible by hand with `?polar=0.5` and `?polar=2`.

**Why it was uncertain.** The PSF's coherent pass divides by `sqrt(sum(w²))`, which is the
normalisation that leaves *independent* scatterers with the variance they arrived with — so tissue
interior is resolution-invariant by construction. A specular boundary return is not independent: it
is correlated across the kernel, and the normalisation that leaves a correlated input alone is
`sum(w)`. On that reading the boundary term should gain about **3 dB per doubling** of lateral
resolution while the interior stays put, which would mean `boundaryReflection: 0.55` was tuned under
one sampling and silently pinned to it.

**What was measured.** It does not happen. Rim versus core across the left-ventricular wall is flat
to within **0.06 dB** over a four-fold span:

| polar resolution | rim | core | rim/core | vs 1× |
| --- | --- | --- | --- | --- |
| 0.5× — 192 × 256 | 0.648 | 0.539 | 1.203 | −0.04 dB |
| 1× — 384 × 512 | 0.688 | 0.569 | 1.209 | 0.00 dB |
| 2× — 768 × 1024 | 0.743 | 0.619 | 1.201 | −0.06 dB |

Both terms rise together — about 1.2 dB of displayed grey across the whole span — and their ratio,
which is what `boundaryReflection` sets, does not move. The reasoning above assumes the boundary
return is correlated across the PSF kernel; in this renderer it is generated per sample at a label
transition along the ray, so its axial extent is nearer one sample than a kernel width.

**How to judge it.** Load the app at `?polar=0.5` and `?polar=2` and compare the two images. They
should differ in fineness of speckle and in almost nothing else — in particular the walls should not
change from bordered bands to bright outlines. The test asserts 0.5 dB, an order of magnitude above
the measured spread and well below what the failure mode would produce.

**Nothing was retuned.** The tuning constants are the owner's and stand. This entry records that a
suspected dependence was looked for and is not there.

---

## 20. The model picker, and what a chip is telling you

**Where.** The top of the screen, above the Echo / Explore modes.

**What to look at.** Two groups, and the grouping is the point. **Labelled — echo and explore** are
packs with a labelled volume and views; **Geometry only — explore** are packs with meshes and
nothing else. That distinction decides which modes are even available, so it decides the grouping
rather than being mentioned inside it.

Every chip carries a licence-state tag, and in development an unpublished pack carries a red **not
published** tag as well. Right now that is three of five packs, and the two that do ship are the
synthetic stub and Rodero. Nothing new ships in this build, by rule.

**Why it was uncertain.** UI-4 deferred the picker until there was a fourth pack to pick. There are
now five, and packs 4 and 5 differ from the first three in kind rather than in quality — one of them
cannot enter Echo mode at all. A flat list would have made that difference visible only after
choosing.

**How to judge it.** Pick the Cardiac Motion chip. Echo should grey out *and say why* before you
have a chance to wonder whether the app is broken. Pick Rodero again and Echo should come back with
the view intact. The address bar should follow both times, and neither should reload the page.

**Judgement calls.**

- **The catalogue is duplicated data.** It restates each pack's display name, kind and licence state
  in TypeScript. That is on purpose: a manifest generated from `public/packs/` would still list the
  packs the production build prunes, so the picker would offer chips that 404 on the deployed site.
  The duplication is checked field by field against the packs on disk in
  `tests/unit/publishedPacks.test.ts` — and it has already caught one drift, a display name that had
  changed in the pack and not in the catalogue.
- **Rejected packs are offered, not hidden.** In development. They are evidence, and evidence you
  cannot open is not evidence. The red tag is what stops them being mistaken for shipped content.
- **Five chips already crowd the top of a phone screen.** At ten this needs to become something
  else — a select, or a grouped drawer. It is not there yet.

---

## 21. The cine control: half a cycle, bouncing, at a rate nobody stated

**Where.** Explore mode, under the cutter row, on a pack that carries motion. Today that is
`motion-biv-cinemri` only.

**What to look at.** Press **Play**. Ten frames of a biventricular surface run from end-diastole to
end-systole and back. Watch the *scrub*: it should travel to the end and turn round, never wrap.

**Why it was uncertain.** This is the first moving geometry in the repository, and the source covers
half a cycle. Looping it would show the heart snapping from fully contracted back to fully relaxed
in one frame — a motion no heart makes, presented as though the source had recorded it. The pack
records `loop: false` and the playback bounces because of it; a whole-cycle pack would wrap.

**How to judge it.** Two things, both by eye. First, does it read as a heart contracting, or as ten
unrelated meshes flickering? Second, does the *camera* stay still? The framing is deliberately taken
from frame 0 and never recomputed, because re-framing per frame would make the heart pulse in the
viewport for reasons that have nothing to do with the heart.

**Judgement calls.**

- **The rate is invented, and says so.** The deposit states no frame rate, so playback runs at 8 fps
  because that is legible, and the control prints "no rate stated by the source" next to it. If it
  looks too fast or too slow, that is a display choice and not a fact about the heart.
- **A different axis from the sweep, and deliberately a different control.** The sweep moves one
  probe over a static heart; this moves the heart and has no probe in it. Explore has no sweep, so
  the two never appear together yet. How a two-axis time model should work when sweep position and
  cardiac phase both exist is an open owner decision and has deliberately not been designed away.
- **The cut plane follows the motion.** Turn the cutter on and play: the cut faces re-cut each frame
  rather than staying behind on frame 1's cross-section. Worth checking, because getting it wrong
  looks like a renderer bug rather than a missed reference.
- **The frames load behind the first one.** The model is interactive immediately and Play is
  disabled for the moment it takes the other nine to arrive. On a fast connection this is invisible.

---

## 22. `motion-biv-cinemri` — how it actually looks. Blunt: like a bean.

**Where.** Pick the Cardiac Motion chip. Explore is the only mode it has.

**What it is.** Ten cine-MRI biventricular segmentations, Zenodo 10548682, CC BY 4.0 confirmed from
the record's own licence field. One unnamed closed surface per frame, 3,400–4,500 triangles each,
about 120 mm across. 1.0 MB derived, all ten frames.

**What it gets right.** It moves, and the motion is recognisable: the whole body shortens and
narrows toward end-systole, and the apex draws up. That is more than any other model in this
repository does, and it is the entire reason it is here. The scale is right and it needed no
guessing — 119.7 mm across is a heart in millimetres and nothing else.

**What is wrong with it, which is most of it.**

- **It is an epicardial blob.** One outer surface, no chambers, no septum, no valve plane, nothing
  inside. From the outside it reads as a smooth two-lobed bean, and the two lobes are the only
  anatomy visible without cutting. Cut it open and there is nothing in there — it is a shell, not a
  wall, so a cut face is a closed ring of nothing.
- **It has debris.** Frame 1 carries **11 connected components** and there are visibly wrong dark
  triangles on the surface — small inverted or degenerate facets that read as punctures. They come
  and go across the cycle (11 components at end-diastole, 1 at frames 7 and 8, 3 at the last), so
  playback flickers small dark specks on and off. That is segmentation debris in the source, not a
  rendering fault, and it is not fixed here.
- **The surfaces are coarse and lumpy.** Roughly 2,000 vertices over a whole biventricular surface
  is far below what the shape deserves; the smooth shading hides it until the silhouette, which is
  visibly faceted.
- **No labels, so no echo, no colour, no show/hide.** It renders in the unnamed-structure grey.
- **No vertex correspondence.** 2,268 vertices in the first frame, 1,712 in the last. Nothing can be
  tracked through the motion, no strain, no displacement, and no deformation field is derivable.
  This is the fact that shaped the schema.
- **Undocumented.** Two sentences of description, no subject metadata, no segmentation protocol, no
  accuracy statement.

**Is it worth keeping?** Yes, and only for one reason: it is the first thing in this repository that
moves, and watching a ventricle contract teaches something a still model cannot. As anatomy it is
the weakest asset here — worse than the VHL tissue body, which at least has interior surfaces.
Nobody should learn chamber anatomy from it.

**Decision for the owner.** Whether a moving blob earns a place in a teaching tool once better
static models are on the shelf, or whether it stays purely as the thing that proved the motion path
works.

---

## 23. What the Playwright suite does NOT cover, and why

**Where.** Nowhere on screen — this is a gap, recorded so it is not mistaken for coverage.

The visual suite runs against a real **production build**, deliberately: it is the only check that
exercises the artefact that actually deploys, and `tests/static-server.mjs` serves `dist/` alone so
a pruned pack 404s the way Pages would.

The consequence is that **no unpublished pack exists during the visual suite**. So these are not
covered end to end by Playwright:

- the Echo-mode refusal on an EXPLORE-ONLY pack, and its on-screen reason;
- the cine control, its playback, and the cut following the motion;
- the picker's development behaviour — the unpublished tags and the rejected-pack chips.

What covers them instead: the schema invariants and the publication rule are unit-tested; the
playback rule (`nextCineState`) is unit-tested including the bounce; the catalogue is checked field
by field against the packs on disk; and the production half of the picker IS asserted in Playwright,
including that no chip says "not published" on the deployed site. The rest was checked by hand in a
browser, which is what the owner does anyway.

Closing this properly means a second Playwright project served from `npm run dev`. That is a real
piece of work — a second web server, a second base path, and a decision about whether an unpublished
pack should be screenshotted at all — and it is not in this task.

---

## 24. `anatomy-bodyparts3d-heart` — the best-looking model here, and its leaflets are not leaflets

**Where.** Pick the BodyParts3D chip. Explore only.

**What it is.** 86 separately modelled parts from BodyParts3D 4.0 — the 83 elements the source's own
concept map lists under "heart", plus three single-element vessel stubs (ascending aorta, pulmonary
trunk, superior vena cava) added so the semilunar cusps have something to sit in. 105,098 triangles,
2.8 MB derived from a 62 MB whole-body archive that is never committed. CC BY 4.0, confirmed from
the rights holder's own page.

**What it gets right, and it is a lot.**

- **It reads immediately as a heart.** Ventricles, atria, a great-vessel stub, and — the striking
  part — the **coronary tree traced over the surface** in fine separate branches, plus the great
  cardiac vein and the coronary sinus. Nothing else in the repository has coronaries at all.
- **Chambers exist as cavity AND wall, as separate meshes.** `cavity of left ventricle` is its own
  solid, next to the wall segments. That is exactly the cast-and-shell pairing the Alberta pack was
  rejected for failing to provide.
- **Papillary muscles are separate meshes.** Anterior and septal of the right ventricle, the
  anterolateral head of the left lateral muscle.
- **The names are derived from the source, not invented.** Each part is named from the smallest
  concept in `partof_element_parts.txt` that contains it, and the eleven valve elements are pinned
  by id with the ingest failing if the source stops listing them under the expected concept.

**What is wrong with it.**

- **The atrioventricular "leaflets" are not leaflets.** This is the finding that matters most,
  because it contradicts what this pack was fetched for. Element `FJ2432` is listed by the source as
  the posterior mitral leaflet — and also as the inferior wall of the left ventricle, the myocardium
  of that wall, and myocardial zone 4. It measures **49 × 38 × 32 mm** with 3,820 triangles. That is
  a wall segment. `FJ2420`, the anterior mitral element, is 34 × 48 × 31 mm — a leaflet is not 48 mm
  tall. The source's concept map is many-to-many and these meshes stand for every concept they are
  part of. Their labels now carry both names rather than the pipeline picking one.
- **The semilunar cusps ARE real, and they are coarse.** Three aortic and three pulmonary cusps,
  15–24 mm across, 316 to 1,370 triangles each. Cusp-sized, cusp-shaped, and visibly faceted at any
  useful zoom. Not smoothed here — smoothing them would be sculpting anatomy.
- ~~**Every single surface is open, and the cut has no faces.**~~ **WRONG, and the fault was in this
  pipeline rather than in the source — see entry 29.** The OBJs duplicate a vertex per adjacent face
  along their seams; unwelded they measure 1,826 boundary edges and 124 connected components on the
  right atrial wall. Welded, **all 86 parts are watertight, single-component and manifold**. The
  ingest now welds exactly coincident vertices, which moves no surface, and the cutter caps this
  pack properly.
- **82 of the 86 parts render in one grey.** The palette is keyed by the Rodero slugs, and everything
  else falls to the unnamed grey. The four chamber cavities are now marked blood pool and render as
  translucent blue (entry 31), which separates lumen from tissue and is a large improvement — but a
  papillary muscle and a coronary branch are still the same grey as each other.
- **One adult cadaver, fixed.** Nothing paediatric, and the leaflets are in one post-mortem
  configuration: they neither open nor close, and never will.
- **No arch, no descending aorta, no IVC, no pulmonary veins.** Those elements run 96–335 mm down
  the body and would have tripled the model bounds, which the camera framing and the unit inference
  are both measured from. Excluded on that basis, and the pack says so.

**Is it worth keeping?** Yes, clearly the best model on the shelf, and more clearly than this entry
first said. It is the only source with separate cusps, separate papillary muscles, chamber cavities
and a coronary tree; it looks like a heart from the first frame without cutting; and every part of
it is closed, so it cuts properly too.

**Decisions for the owner.**

1. **Colouring 86 unnamed structures.** The current rule is that a structure outside `PALETTE` is
   grey and slightly translucent, and that translucency is a deliberate signal on the Rodero pack —
   "we have not identified this". Here every structure IS identified; it just does not share slugs
   with the palette. Deriving a stable colour per structure id would make this pack legible and
   would change what "grey" means on the shipped one. That is a palette decision and the palette is
   yours.
2. ~~**Whether open surfaces should get caps at all.**~~ Withdrawn for this pack, whose surfaces are
   closed. Still live for CobivecoX, whose ventricles are genuinely truncated at the base.
3. **The licence contradiction.** The rights holder's current page grants CC BY 4.0 with explicit
   redistribution and derivative rights, quoted in the pack. Older mirrors of the same project state
   CC BY-SA 2.1 Japan. If the older reading is right, anything derived from this is share-alike. The
   pack does not ship either way, so nothing turns on it yet.

**What was NOT done, deliberately.** Grafting these leaflets onto the Rodero mesh. The four valve
rings are the registration targets when that happens, and it is a task of its own. Given the finding
above, only the six semilunar cusps are plausible graft candidates; the atrioventricular elements
are wall segments and would bring a second left ventricle with them.

---

## 25. `normal-kit-four-chamber` — the cleanest geometry here, and you cannot see any of it

**Where.** Pick the KIT chip. Explore only, and it can never be anything else: CC BY-NC 4.0.

**What it is.** Seven surfaces from the KIT/IBT four-chamber electromechanics model, Zenodo
10526554 — epicardium, the four chamber cavities, the great-vessel trunks and the outer pericardium.
42,454 triangles, 1.0 MB derived. A single 33-year-old male volunteer.

**What it gets right.** The mesh quality is the best on the shelf by a distance. **Six of the seven
surfaces are watertight with exactly one connected component and zero boundary edges** — compare
BodyParts3D, where all 86 are open and the right atrial wall alone splits into 124 pieces. Only
`outerTrunks` is open, and it is a 164-triangle sketch. That means the free cutter's stencil caps
actually close on this pack: turn the cut on and you get a solid cut face, not a hollow shell.

**What is wrong with it, and it is one thing that ruins the rest.**

**The pericardium is an opaque bag around everything.** `outerPeri.stl` is a 183 mm shell of 1,522
triangles wrapped round the whole heart. The default view of this pack is a featureless grey egg —
you cannot see the epicardium, let alone the four cavities inside it. Turn the cutter on and you get
a clean solid cut face, of the pericardium, which then hides everything behind it. Six good surfaces
are in there and none of them is visible.

This is a **product gap, not a pack defect**, and it is now the clearest one on the list: there is no
per-structure show/hide control anywhere in the app. The schema has `show_hide_preset` per view, but
an Explore-only pack has no views, and Explore has no structure list. Two packs now need it for
different reasons — this one to take the lid off, BodyParts3D to tell 86 identical greys apart.

**Other limitations.**

- **Cavities only, no wall thickness.** The chambers are blood-pool casts and there is one
  epicardium; there is no per-chamber myocardium, so wall thickness is not derivable by pairing
  them. That is the same defect that lost the Alberta pack the wave 1a comparison, and it means this
  model could not replace Rodero as a substrate even if the licence allowed it.
- **No valves at all.** `LabelIDs.txt` names mitral, tricuspid, aortic and pulmonary valve labels
  plus vein and caval orifices — every one of them a tag in the volumetric mesh, none of them a file
  in `Surfaces.zip`.
- **Permanently unpublishable.** Non-commercial, confirmed at the source.

**Two things excluded, both deliberately.**

- `master.stl` and `slave.stl` are the mechanics solver's contact pair, not anatomy. Both are
  coincident with the epicardium at coarser resolution — identical extents and centre to the
  millimetre, 14,848 and 1,522 triangles against the epicardium's 19,816 — so including them would
  z-fight with the anatomy for no anatomical gain.
- `EP.vtu` (640 MB) was never fetched. It is an electrophysiology mesh with no use here.

**`M.vtu` was fetched and is not in the pack, on evidence.** It is the tagged volumetric mechanics
mesh and the only route from this source to a labelled echo volume. Reading its boundary gives
32,505 vertices and 43,916 triangles spanning **183.2 × 150.5 × 151.3 mm — exactly `outerPeri.stl`'s
extent and centre**, which confirms its outer boundary is the pericardium and would have been a
seventh copy of a surface already here. Splitting it by tag is `ingest.py`'s job and needs a derived
anatomical frame this source has not been given. It stays in the cache as the raw material for that,
if it is ever wanted.

**Is it worth keeping?** Yes, but for what it could become rather than for what it shows. As it
stands you cannot look at it. As tagged volumetric geometry with clean watertight surfaces it is the
best-conditioned source in the repository — and it is non-commercial, so it can never ship, which
caps how much work it deserves.

**Decision for the owner.** Whether a per-structure show/hide list is built next. It would unlock
this pack completely and would fix the worst of BodyParts3D. It belongs to viewer-core rather than
to wave 1d, so it does not collide with the view rail.

---

## 26. `motion-straus-us-patient01` — the one that moves properly, and cannot be published

**Where.** Pick the STRAUS chip. Explore only, and Play.

**What it is.** 30 frames of a biventricular myocardium from the Multimodality STRAUS synthetic
database, patient01_healthy, ultrasound modality. 7,536 vertices and 15,076 triangles per frame after
welding, **identical in count and ordering across all 30**, covering one whole cardiac cycle. 10.9 MB
derived — the largest pack in the repository.

**What it gets right.**

- **The motion is convincing.** Compare it against `motion-biv-cinemri`: this contracts smoothly
  through a whole cycle, the apex draws up and the walls thicken visibly, and because the frames
  meet end to end it **loops** rather than bouncing. It reads as a beating heart rather than as a
  sequence of separate meshes.
- **Every frame is watertight, one connected component, zero boundary edges.** No debris, no
  flickering specks, no holes. The cleanest moving geometry available.
- **It has vertex correspondence, and that is the whole point.** All 30 frames share vertex count and
  ordering, so this is the only source in the repository from which a deformation field could ever
  be derived. That fact is recorded in the pack as `vertex_correspondence: true` and it is *checked*:
  the ingest withdraws the claim automatically if decimation ever runs, because quadric
  simplification is data-dependent and decimating frames independently destroys correspondence. The
  triangle budget is applied **per frame** rather than divided across frames for exactly this reason —
  only one frame is on screen at a time, so dividing 220,000 by 30 would have cut a 15,000-triangle
  myocardium in half and silently voided the property this pack exists for.

**What is wrong with it.**

- **It is synthetic.** This is the mesh half of a simulation pipeline: an electromechanical model
  driving a physical ultrasound simulator. It is a plausible heart, not a measured one, and its
  motion is the model's motion. Nobody should learn what a real ventricle does from it without that
  caveat attached.
- **The licence does not exist.** Not "restrictive" — absent. The dataset page, the Girder collection
  description and the collection metadata were all read and none of them names a licence. The only
  access statement anywhere is that the database is public and needs no login, which is permission to
  **download** and says nothing about redistribution or derivative works. State `unconfirmed`, and
  `license` reads "No licence stated at the source" because that is the true position rather than an
  unfilled field. Resolving it means writing to the depositors.
- **One undivided myocardium.** No chambers, no labels, no echo. And because it is the boundary of a
  myocardial *volume*, the surface is epicardium and endocardium as one closed shell — the
  endocardial surface is genuinely in there, tucked inside, and only the cutter reveals it.
- **10.9 MB for a pack that does not ship.** Inside the 15 MB per-pack budget and the largest thing
  in the repository. It was 13.7 MB until welding dropped the volume-interior points no face
  references — a third of every frame. Decimating would halve what is left and destroy the
  correspondence, so there is no cheap saving beyond that.

**Is it worth keeping?** Yes. It is the best moving asset by a wide margin and the only candidate for
any future deformation-field work. The licence is the thing standing between it and usefulness, and
that is an email rather than an engineering problem.

**The Girder fetch was not awkward.** The API is public and unauthenticated:
`/api/v1/folder?parentType=folder&parentId=...` walks the tree and `/api/v1/item/{id}/download`
fetches one file. The thirty item ids are pinned in `pipeline/sources.py` so the fetch is
reproducible without re-querying. The full collection is 14.4 GB and was never touched.

---

## 27. `tof-cobivecox-chd0017001` — congenital, on-topic, and the annuli are only rings

**Where.** Pick the Tetralogy of Fallot chip. Explore only.

**What it is.** One patient of the ten patient-specific repaired-TOF meshes accompanying CobivecoX,
Zenodo 10577973, CC BY 4.0 confirmed. Eight surfaces: epicardium in two pieces, LV and RV
endocardium, and the mitral, tricuspid, aortic and pulmonary annuli. 158,294 triangles, 3.8 MB.

**What it gets right.**

- **It is the only congenital anatomy in the repository**, which is the reason it is here — this is
  a paediatric-cardiology teaching tool and every other model is a normal heart.
- **Endocardium and epicardium as separate surfaces**, per ventricle for the endocardium. Wall
  thickness is the gap between them, which is more than most of the shelf offers.
- **Four named valve annuli as separate meshes**, which is what makes this source the natural
  registration target if BodyParts3D leaflets are ever grafted onto anything.
- **Clean topology.** Every one of the eight surfaces is a single connected component. They are all
  open, but open by construction rather than by damage: the ventricles are truncated at the base and
  an annulus is a ring.

**What is wrong with it.**

- **The annuli are rings, not valves.** 445 to 1,840 triangles each. They are the annulus plane the
  coordinate system is built on. No leaflets, nothing opens, nothing closes.
- **The repair is not described.** These are post-operative Tetralogy of Fallot ventricles from an
  imaging atlas. Which repair, at what age, with what residual lesion — none of it is in the
  deposit. Nothing here should be read as showing a particular surgical result, and a trainee
  looking at it is looking at *a* repaired TOF ventricle and not at *the* repaired TOF ventricle.
- **One patient of ten.** Ten patients would be ten packs at about 4 MB each, which is 40 MB of
  committed assets for material that does not ship. The other nine are one registry line away and
  the archive is already cached.
- **No atria, no great vessels.** Biventricular only, so the outflow tract that a TOF repair is
  mostly about stops at the pulmonary annulus.
- **No echo, and the same 8-structures-in-one-grey problem** as everywhere else on the shelf.

**Is it worth keeping?** Yes, and it is the pack most likely to become clinical content later. It is
the only congenital model, it has the annuli a view could be built on, and the licence is clean.
What it needs before that is a clinician saying which of the ten patients is worth showing and what
the trainee is supposed to see.

---

## 28. Nine packs, and the picker is now too tall

**Where.** The top of the screen.

Entry 20 said five chips already crowded a phone screen and that at ten this needs to become
something else. It is nine. On the desktop layout the picker takes about a third of the viewport
before the model is reached, and on a phone you scroll past the whole shelf to get to the heart.

Nothing is broken and nothing has been changed for it — this is the note that the threshold was
predicted and has now been crossed. What it wants is probably a collapsed control that shows the
current pack and opens the shelf on demand, with the two groups intact.

---

## 29. The geometry ingest was not welding vertices, and it made good models look broken

**This entry exists because the owner looked at the shelf and said most of it was wrong. Three of
the four complaints were right and one of them was a defect in this pipeline, not in the data.**

**What was wrong.** `pipeline/geometry.py` read each surface and used it as it arrived. Several of
these formats duplicate a vertex per adjacent face along seams — BodyParts3D OBJs do it everywhere —
and a tetrahedral source hands over every point in the volume when only the boundary is drawn.
Neither was being cleaned up.

**What that did, measured.**

| Source | Unwelded | Welded |
| --- | --- | --- |
| BodyParts3D right atrial wall | 1,826 boundary edges, 124 components, open | **0, 1 component, watertight** |
| BodyParts3D posterior mitral element | 1,382 boundary edges, 73 components, open | **0, 1 component, watertight** |
| BodyParts3D, all 86 parts | every one "open" | **every one watertight** |
| STRAUS, per frame | 11,370 vertices | 7,536 — a third were unreferenced |

The visible consequences, all of which the owner saw before anyone measured anything:

- **The free cutter's stencil caps count front and back faces to decide what is inside.** An open
  surface breaks that parity, so instead of capping the cut the quad painted solid over whole
  regions — "in cut view the cavities are filled". The surfaces were never open.
- **Observation 24 recorded 124 connected components as segmentation debris.** It was seam
  duplication. That claim was wrong and is struck through above.
- **The STRAUS pack was 13.7 MB**, a third of it points nothing draws.

**The fix.** `weld()` drops unreferenced vertices and merges vertices whose float32 coordinates are
bit-identical. Both are lossless — a vertex no face references renders nothing, and two vertices at
the same coordinates are one point written twice. **Exact equality, no tolerance**, because a
tolerance is a judgement about how close is close enough and a wrong one welds a real gap shut.

For a keyframed pack the weld has to be done once and applied to every frame: `np.unique` sorts by
coordinate, and the coordinates are exactly what differs between frames, so welding each frame
independently would destroy the vertex correspondence STRAUS exists for. Where frames share
connectivity the mapping from frame 0 is valid for all of them; where they do not, each is welded
alone and the correspondence claim is withdrawn.

**Why it was missed.** `ingest.py` has always welded, inside `repair()` — which also calls
`fill_holes()`. The geometry path deliberately skips `repair()` because filling holes on a
genuinely open source fabricates anatomy. That reasoning is right and the conclusion drawn from it
was too broad: welding and hole-filling were dropped together when only hole-filling adds geometry.
One is a measurement, the other is an invention.

**What welding did NOT fix**, so these were real all along:

- **`motion-biv-cinemri` still has 11 connected components** at end-diastole and 1 at end-systole,
  and picks up non-manifold edges when welded. That debris is in the source.
- **CobivecoX is genuinely open.** The ventricles are truncated at the base and an annulus is a
  ring; welding changes nothing. Its cut faces will stay unreliable, and that is the source.
- **KIT was already clean** — welding changed not one vertex.

**What is still nothing to do with preprocessing**, and remains the honest answer to "why does the
shelf look bad":

1. **Everything renders in one grey** (entries 24, 25, 27). The palette is keyed to the Rodero
   slugs. This is the biggest single thing left.
2. **There is no per-structure show/hide** (entry 25). KIT's pericardium is an opaque bag; the
   CobivecoX and STRAUS models nest an endocardial surface inside an epicardial one and nothing can
   take the outer one off.
3. **Explore's default camera framing is inherited, not designed.** Several packs open looking
   straight into their own base, where the truncated ventricles and annuli read as craters in a
   blob. That is what "Fallot and STRAUS are blobs with holes" is: a real opening, seen end-on,
   with no colour to separate the surfaces nested inside it.

---

## 30. The Visible Heart Labs pack DOES echo, and the owner is right that it can be probed

**Where.** `?pack=normal-vhl-heart0102`. It opens in **Echo** mode — no refusal, probe drawn, echo
panel rendering. It is an echo-capable pack and always was.

**What the wave 1a rejection actually said, and what it did not.** It said the pack is a single
undivided tissue body: one material, one echo label, so nothing can be shown or hidden per chamber
and a sweep has no ordered structure list to read out. All of that stands. What it did **not** say,
and what should not be read into it, is that the model cannot be oriented or imaged. It can. The
probe pose, the sector, the cut plane and the echo raster all work on it today.

**What one label costs the echo, precisely.** The renderer maps label → echogenicity and
attenuation. With one label there is one echogenicity, so the image has speckle and attenuation but
**no grey-level ordering between tissues** — the thing `docs/build_plan.md` calls perceptual priority
1. Blood does not read darker than myocardium because there is no blood label. That is a real limit
and it is a limit on the TEACHING content, not on the geometry or the orientation.

**Separately: it is CC BY-NC 4.0.** It cannot ship whatever anyone concludes about the substrate.

**Decision for the owner.** Whether the wave 1a substrate verdict on this pack should be revised in
`src/packs/published.ts` and `public/packs/README.md`. The geometry claim in it — 1,026 connected
components rendering as voids — was measured before the ingest welded vertices, exactly like the
BodyParts3D numbers entry 29 corrects. **It has not been re-measured**, because that pack goes
through `ingest.py`, which has always welded, so the number is probably real. Re-running it and
checking is cheap and has not been done.

---

## 31. The cavity casts are solid, and the geometry ingest never said they were blood

**Follow-up to the owner's "cavity still filled when cut", on BodyParts3D.**

**Not a cap failure.** All 86 parts were re-measured after welding: every one watertight, every one
single-component, **every one winding-consistent**. The stencil caps had nothing wrong with them.

**The cavities are solid casts.** BodyParts3D models chambers as filled lumen solids — `cavity of
left ventricle` is 97.9 mL, right ventricle 117.0 mL, left atrium 51.9 mL, right atrium 84.6 mL.
Cutting one therefore produces a solid cut face, correctly, because there is a solid object there.
With every structure rendering in the same grey, that face was indistinguishable from a wall's, so
the cut read as a filled cavity.

**What was missing was one boolean.** `Structure.blood_pool` has existed since schema v0 and drives
the viewer's lumen colouring — translucent and cool, so a cast cannot be mistaken for a wall. The
Rodero and Alberta packs set it. `pipeline/geometry.py` hardcoded `blood_pool: False` for every
structure it emitted, so no geometry-only pack had ever set it.

`GeometrySource.blood_pool_match` now carries case-insensitive substrings matched against the
display label — `"cavity of"` for BodyParts3D, `"cavity"` for KIT — and a declared pattern that
matches nothing is a hard error rather than a silent no-op, because it means the source's labels
have moved. Four structures matched in each pack, and the pack records which by name.

**And blood pool is NOT capped at the cut.** Marking the casts as lumen was necessary and not
sufficient: capping them still painted a solid blue disc across the opening, and a chamber that
reads as filled reads as filled whatever colour it is. It IS filled — in the file. It is not filled
in a heart. So the stencil cap is withheld for blood-pool structures and the cut face is left open;
the clip removes the near half of the cast and the learner looks straight into the chamber, through
the translucent lumen shell, at the wall and the papillary muscles behind it. Tissue still caps,
because tissue cut across really does present a face. Nothing else changes for these structures —
they still draw, still ghost, still clip. The cap is the only thing withheld.

**What it looks like now.** Uncut, the four chambers are translucent blue and **the papillary
muscles and trabeculae are visible through them**, with the coronary tree standing grey against the
blue. Cut, the chambers open: grey wall rims around a chamber you can see into. This is the largest
single improvement to how the shelf looks so far, and it cost one flag and one `if`.

**It changes nothing on the shipped pack.** `normal-rodero` carries no blood-pool structures at all —
its myocardium is native volumetric tissue, which is why it won the wave 1a comparison. Only the
cast-shaped packs are affected.

**It did NOT fix KIT.** The same four cavities are now blood pool there, and you still cannot see
them: the pericardium is the outermost opaque shell and its cut face is a solid disc across the
whole model. Colour cannot solve that — only hiding the pericardium can.

**This makes the per-structure show/hide control the clear top priority.** It was decision 2 in
entry 25; it is now the only thing standing between two of the best packs and being properly
usable, and it is a viewer-core control that does not collide with the view rail.

**A related question the owner should decide.** `blood_pool` is currently inferred from a label
substring declared per source. That is explicit and checked, but it is still the pipeline reading
anatomy off a name. For BodyParts3D and KIT the sources name their casts unambiguously; a source
that does not would need the flag set by hand, and there is no mechanism for that yet.

---

## 32. BodyParts3D models lumen as SOLID CASTS — including the great vessels

**Follow-up to the owner's "why are these vessels solid filled? aorta and the other one?" and
"same thing with blood around this valve — are you mistaking blood for solid mass?"**

Both are the same finding, and the answer is yes: the pipeline was treating blood as tissue.

**Measured, per element.** Euler characteristic 2 means a closed solid — a topological sphere, not
a tube with a wall. Every one of these is a cast filling the outline:

| Element | Label | Volume | Euler |
| --- | --- | --- | --- |
| FJ2423 | cavity of right ventricle | 117.0 mL | 2 |
| FJ2422 | cavity of left ventricle | 97.9 mL | 2 |
| FJ2424 | cavity of right atrium | 84.6 mL | 2 |
| FJ2425 | cavity of left atrium | 51.9 mL | 2 |
| FJ3413 | ascending aorta | **21.5 mL** | 2 |
| FJ2966 | pulmonary trunk | **19.2 mL** | 2 |
| FJ3645 | superior vena cava | **12.3 mL** | 2 |

The three vessels are lumen casts exactly like the four chambers. Entry 31 marked only the
chambers, because the pattern was `"cavity of"` and the vessels are not called that. Cut across,
they presented solid grey plugs — which is what they are in the file and is not what a vessel is.
The round grey mass the owner saw "around the valve" is the ascending aortic cast seen end-on at
the root.

They are marked blood pool now: translucent, and no stencil cap at the cut, so the aorta and the
pulmonary trunk open into lumen you can see through.

**The coronary and venous segments are casts too, and are deliberately not marked.** Their cut
faces are millimetric, and as opaque grey tubes over translucent chambers they are the most
legible thing in this pack. That is a judgement about legibility rather than about anatomy, it is
written into `pipeline/sources.py` next to the pattern, and it is one line to reverse.

---

## 33. There is no ventricular myocardium in the BodyParts3D heart

**The owner's "why is there no muscle around the ventricles?" — the source does not have any.**
Nothing was dropped in ingest, and this was checked across the WHOLE atlas rather than assumed.

**What the source itself calls ventricular myocardium.** These are the source's own concepts, and
the elements each one resolves to:

| Concept | Elements | Total volume |
| --- | --- | --- |
| `myocardium of left ventricle` (= `wall of left ventricle`) | FJ2418, FJ2429, FJ2432 | **12.1 mL** |
| `myocardium of right ventricle` (= `wall of right ventricle`) | FJ2419, FJ2430, FJ2437 | **7.7 mL** |
| `cavity of left ventricle` | FJ2422 | 97.9 mL |
| `cavity of right ventricle` | FJ2423 | 117.0 mL |
| `wall of left atrium` | FJ2438 | 40.5 mL |
| `wall of right atrium` | FJ2439 | 27.6 mL |
| `interventricular septum` | **no such concept** | — |

A real left ventricular myocardium is 100–150 mL. This atlas has **12.1 mL**, against a 97.9 mL
cavity — and the three elements it is made of are, by the source's own other labels, the
anterolateral papillary head, a patch of anterior wall, and a patch of inferior wall that is also
called the posterior mitral leaflet. What BodyParts3D calls the myocardium of the left ventricle is
**the papillary muscles and two wall patches**. There is no septum concept at all.

The ATRIAL walls, by contrast, are properly modelled at 40.5 and 27.6 mL.

**It is not a selection error.** Every concept in the atlas whose name contains `myocardium`, `wall
of left/right ventricle`, `free wall`, `lateral wall`, `inferior wall` or `subendocardial layer`
was resolved to its elements and checked against the 86 in this pack: **every one is already
inside**. The only elements outside are the brain's ventricles and the cardiac veins. This is the
same check that caught the great vessels in entry 32, run over the whole atlas, and this time it
comes back clean.

So the ventricles render as bare lumen casts with papillary muscles and trabeculae hanging inside
them and nothing around them, and that is an accurate rendering of what the source contains.

**This settles the deferred graft question.** Entry 24 had already narrowed the BodyParts3D graft to
the six semilunar cusps. This confirms it from the other side: there is no ventricular myocardium
here to graft, and Rodero's — native volumetric tagged tissue, which is why it won the wave 1a
comparison — is precisely what BodyParts3D lacks. The two sources are complementary in exactly one
direction: cusps and papillary muscles from BodyParts3D onto Rodero's walls, never the reverse.

**And it caps what this pack can ever teach.** It is the best-looking model on the shelf and it
cannot show wall thickness, hypertrophy, or a septal defect, because it has no ventricular wall to
show them in.

---

## 34. Structures popped in and out under orbit. Near-opaque translucency was the cause.

**The owner's "structures pop in and out of existence as I rotate". A real bug, now fixed.**

Unnamed structures were drawn `transparent: true` at **0.95** opacity — a hint that they had not
been identified anatomically. A `transparent` material goes into three.js's transparent pass, which
sorts per OBJECT and never per triangle. With `DoubleSide` geometry that makes a mesh's own far
surface blend over its near one in an order that flips as the camera turns, and makes neighbouring
meshes swap draw order.

On the Rodero pack, with fourteen unnamed structures among twenty-four, that was a shimmer nobody
had reported. On BodyParts3D, where **all 86 are unnamed and none is in the palette**, it read as
structures popping in and out of existence.

**Now: translucent only where it means something.** Blood pool stays at 0.45, because seeing the
wall through the lumen is the entire point of it and it is seven objects rather than seventy-nine.
Everything else is opaque.

**What that gives up.** The "we have not identified this" signal. It was five per cent of alpha and
was never visible; the observation that introduced it had already raised it once because a lower
value let the ghost show through. If that distinction needs drawing it needs drawing in something a
viewer can actually see — a hue, a hatch, an outline — and that is a palette decision for the owner,
not a reason to keep a rendering hazard.

**Verified** by orbiting the pack through twelve steps and sampling the rendered silhouette at each:
the covered-pixel count moves smoothly (4,362 → 4,902 → 4,126) with no discontinuity, where a
vanishing structure would show as a step.

---

## 35. Orbit was a turntable, and a turntable cannot reach every angle

**The owner's "rotation feels weird, I can't get the heart to the angle I want".**

**What it was.** Horizontal drag rotated about **world up**, vertical about the camera's own right.
That is a turntable — a globe viewer — and `contracts/viewer-core.md` asked for exactly that.

**Why it could not do what was asked.** Yaw and pitch fix the view direction and leave the screen's
up determined by world up, so there is **no drag that rolls the model**. Tilting the apex on screen
was not a thing the control could express. And near the poles it degenerates: looking down world Y,
a world-Y yaw spins the picture in place rather than turning the object, and the sign correction
that kept horizontal drag reading correctly past the pole flipped back and forth for small drags
right at the crossing. Both are inherent to a turntable, neither is a coding mistake.

**What it is now.** Both rotations are about the **camera's own axes**, which are the screen's axes,
composed locally. The model turns exactly the way the hand pushes it at every orientation; local X
and local Y generate the whole rotation group, so every orientation is reachable; and roll comes out
of a curved drag the way it does when you turn something over in your hand.

**Verified.** All 30 existing orbit tests pass unchanged — they pin the requirement as "the near
face of the model follows the pointer", which a trackball satisfies more strongly than a turntable
did, and the sign correction the turntable needed is simply gone. One test added: a closed
right-down-left-up drag loop returns the VIEW DIRECTION to where it started and leaves the screen's
up rotated, which is a roll no turntable could produce. Confirmed in the browser on the Rodero pack.

**What it gives up, and this is a real trade.** The level horizon. A turntable guarantees world up
stays up the screen; this does not, so the heart can end up tilted and `Reset` is the way back. For
a clinical tool that is arguably the wrong way round — orientation is exactly what a trainee is
supposed to be learning — and the alternative is a turntable plus an explicit roll gesture, which
costs a gesture nobody will discover.

**Decision for the owner.** Whether the level horizon should come back as a mode or an option. It
would be a small change either way; what it should NOT be is the only behaviour, which is what it
was.

---

## 36. The stub is a cube on purpose — and the picker was advertising it

**The owner's "the synthetic stub is a cube…". Two separate things, one intended and one not.**

**Why it is a cube, and why it should stay one.** The stub is the only pack whose contents this
repository fixes, so it is the only one that can pin loader and validator behaviour without
depending on ingest output. Its geometry is chosen to be *exactly known*: two nested boxes over
`[-1, 1]³`, with the core label matching its mesh and the shell label deliberately stopping short of
the shell mesh so a rim of background voxels survives — without which the validator's
reserved-background rule would go unexercised. Making it heart-shaped would destroy every one of
those properties and buy nothing: a fixture's job is to be predictable, not plausible.

**What was wrong was that a learner could see it.** `PUBLISHED_PACK_IDS` has always included the
stub, because the visual suite runs against the production artefact and needs it there. Before the
picker, that was invisible — the stub was reachable only by `?pack=stub`, which is exactly how the
suite reaches it. The picker turned "published" into "advertised", and put a chip reading **Synthetic
stub pack** on the deployed site next to a real heart. Publishing a test artefact and offering it as
content are different things, and the picker collapsed them.

**Fixed.** `CatalogueEntry.fixture` marks it; `cataloguedPacks(production)` filters fixtures out
alongside unpublished packs. It stays published, stays in `dist/`, stays reachable by `?pack=stub`,
and in development it still appears — marked **engine fixture** in amber, because there seeing it is
the point.

**A consequence worth knowing: the deployed site now has no picker at all.** With the fixture hidden,
exactly one real pack ships, and a picker offering a single choice is a control that cannot do
anything, so it does not render. The visual test asserts that branch rather than skipping it, and
flips to asserting the full picker the moment a second pack is published. That is an honest
statement of where the project is: **one publishable heart.** Everything else on the shelf is
unpublished, and four of the six shelf packs are unpublished for a licence reason rather than a
quality one.

---

## 37. Isolate makes KIT and BodyParts3D explorable. On KIT it is two clicks.

**Where.** Explore, any pack, the **Structures** panel under the model. Only in Explore — see entry
41.

**The question this had to answer honestly was whether it worked at all.** Entry 25 said of the KIT
pack "you cannot see any of it", and entry 24 said 82 of BodyParts3D's 86 parts render in one grey.
Both were product gaps rather than pack defects, and both are now closed by the same control.

**KIT: two clicks.** Hide `pericardium — outer surface`, hide `epicardium`, and the four chamber
cavities are there in translucent blue with the great-vessel trunks pink beside them. The default
view of this pack was a featureless grey egg and six good watertight surfaces were inside it with no
way to reach any of them. Two clicks. This is the clearest single answer the feature gives.

**BodyParts3D: isolate the left coronary artery and you get the coronary tree.** Twenty-five
branches, each a different muted hue, tellable apart from each other and from the great cardiac
vein — which is the thing nothing else in this repository has and which had been invisible inside
its own model. Isolating a group shows its subtree, so the tree comes out at whatever level of the
hierarchy you point at: the whole left coronary, or the anterior interventricular branch, or one of
its ten diagonals.

**What is genuinely worse than it should be.** An isolated structure keeps the camera it had, which
is framed on the WHOLE model's bounds. A single papillary muscle therefore sits small and off-centre
in a mostly empty panel — legible, but not well shown. See entry 38.

**The tree is deep and does not collapse.** BodyParts3D goes six levels down and the labels are long
("third right anterior branch of anterior interventricular branch of left coronary artery"), so the
list is a lot of indentation inside a 22 rem scroller. The text filter is what makes it usable —
typing "papillary" cuts 86 rows to three — and the filter keeps a match's ancestors so a row never
floats free of what it is part of. A collapse control is the obvious next thing and is not built.

**Honest limit: the click does not honour the cut plane.** The raycast tests geometry, and clipping
is a fragment-stage operation, so with the cutter on a click can isolate a structure whose near half
has been clipped away. Known rather than designed.

---

## 38. Framing the camera on the isolated structure: tried, it helps, and not like this

**The owner left this open deliberately and asked for it to be tried rather than argued.** It was,
as a throwaway spike, and then reverted.

**It helps, clearly.** Isolating the anterolateral papillary head with the camera left alone gives a
pale smudge in the lower-right eighth of the panel. With the camera reframed on what is left, it is
a papillary muscle — you can see the head, the neck and the direction it runs. The difference is not
subtle, and for anything smaller than a chamber the un-framed version barely answers the question
the click asked.

**What is wrong with the spike, and it is not cosmetic.** Framing means moving what the camera looks
at, and the thing it looks at is `C` — the interaction pivot, which is also the free cutter's own
origin. Moving it moves the cut plane under the learner: isolate a structure with the cutter on and
the section jumps somewhere else. And the spike cut to the new camera instead of gliding, which is
the opposite of what `GLIDE_MS` exists for — a camera move the learner did not perform is animated
here precisely so they can see which rotation happened.

**So: worth building, and it is not a one-line change.** A correct version moves the camera's target
and distance without moving `C`, and glides. That is a piece of work rather than an option to
switch on, and it is still the owner's call whether the loss of spatial context — after framing you
can no longer see WHERE in the heart the thing was — is a price worth paying. Showing all reframes
the whole heart and recovers, so the round trip is at least closed.

---

## 39. The derived hues across 86 structures — and the band they had to fit in

**Where.** Explore, BodyParts3D. Every structure that is not blood pool.

**What it looks like.** Olive, sage, tan, slate, dusty rose. Neighbouring coronary branches are
different colours; a papillary muscle and the vein beside it are different colours; nothing looks
like it is claiming to be left heart or right heart. The pack went from "the best-looking model
here, rendering in one grey" to legible in one function.

**The band is narrow on purpose and the narrowness cost something.** Two constraints had to hold at
once. The colours must not read as claiming a side, which rules out the palette's chroma — the
derived band is Lab chroma 14–26 against the palette's 44–62 — and, less obviously, rules out the
palette's HUES: a muted slate blue is still blue to a learner who has been taught that blue is the
right heart, so the arcs within 28° of the left-red and right-blue anchors are excluded outright.
That removes a third of the hue circle. What is left has to separate up to ten siblings.

**Measured rather than judged.** The closest sibling pair anywhere in the repository is **8.2
dE2000**, over nine posterior ventricular branches of the right coronary artery. A just-noticeable
difference is about 2.3, and the beam-dim tests use 10 for "reads as different at a glance" — so
these are comfortably distinguishable and NOT as separated as the shipped palette's own colours.
That is the trade the band bought.

**The uncomfortable part, stated plainly.** The derivation is a pure function of the structure id,
which is what makes a structure the same colour in every session forever — and it therefore cannot
see that two structures are siblings, so it cannot GUARANTEE they differ. What it can do is be
measured against the packs that exist, and the hash salt is chosen to maximise the worst pair.
**A new pack can push the worst pair under the bar.** When it does, `tests/unit/palette.test.ts`
fails, and the failing test is the signal to change the derivation rather than to lower the
threshold. This is the least satisfying thing in this round and it is written down for that reason.

**The exact band is still the owner's, per the brief.** What shipped passes the separation test; it
is not claimed to be the right band.

---

## 40. The droplist at one pack and at nine

**Where.** The top of the screen. Entry 28 said nine chips were too tall; this closes it.

**At nine (development).** One row, 35 px, plus a line of tags for whatever is selected. The
`<optgroup>` labels keep the two groups the chips had. Against the previous layout — which ran to
about 700 px before the model was reached — this is the whole of the improvement, and the structure
list is what got the space.

**At one (the deployed site).** It renders as a **label**, not as an empty droplist and not as
nothing. That is a change from what shipped last round, where the picker vanished entirely below two
packs. Vanishing was defensible — a control offering one choice cannot do anything — but it left the
learner with no statement anywhere of which of the models in this repository they were looking at.
A label says it, in the place the control will appear the moment a second pack is published.

**A native `<select>`, and the reason outranks the styling.** Hospital desktops are a first-class
target. A native select is keyboard-operable, screen-reader-labelled and touch-sized on every
platform without any of that being written here; a custom menu would have needed all of it
re-implemented and would have been worse at it.

**One case worth knowing.** `?pack=stub` reaches a pack the droplist does not offer. Rather than
showing an empty selection or silently selecting something else, the control carries a disabled
option reading "Not in this list — reached by ?pack=". The fixture stays published, stays in
`dist/`, and stays out of the list.

---

## 41. Isolate is Explore-only, and that was the owner's correction mid-build

**What changed.** The structure list, the filter, click-to-isolate and hide were built for both
modes. The owner stopped it: they are Explore-only now.

**Why that is right.** Echo is a claim about one saved probe pose imaging a whole heart. The wedge,
the beam dim and the raster are all statements about what the beam crosses, and a learner who had
isolated one coronary branch would be reading an echo of a heart that is not the heart beside it.
The echo renderer samples a labelled VOLUME, which per-structure visibility does not touch at all,
so the two panels would have disagreed silently rather than visibly — the worst version.

**How it is enforced.** Structurally, not by disabling a button: in Echo the list does not render,
`hidden` is empty, and no click handler is passed to the viewer, so the gesture does not exist
there. The state survives the trip — Echo and back returns the learner to what they had isolated —
because an isolate is a statement about the model rather than about the mode.

---

## 42. The horizon lock: it does exactly what it says, and it says no to roll

**Where.** Echo mode only, the **Level** checkbox beside Ghost and Beam. Off by default.

**What it holds vertical is the MODEL's long axis**, not world up — `meshes.orientation.up`, which
for the shipped substrate is the derived cardiac frame measured in `meshes.anatomical_frame`. Those
are the same thing only while the heart happens to be upright, and holding the heart upright is the
whole job, so world up would have been the wrong axis for the one case the lock exists for.

**Help or a fight?** Both, and the split is clean. It is help in that it is exact: through a curved
drag — the gesture that produces roll on a trackball — the axis stays vertical to within a
millionth of a radian, because the orientation is re-levelled after every step rather than trusted
to stay level. Turning it on levels what is already on screen without moving where the camera
looks, so it is not a jump to a canonical pose.

It is a fight in exactly one way, and it is inherent rather than a defect: **there is no drag that
rolls the model while it is on**, because that is what "locked" means. And near the pole the
vertical component of a drag simply stops being applied — three degrees short, where "up" has no
answer — which reads as the model refusing rather than as a boundary being reached. Nothing on
screen says why.

**Which is why it is an option and Echo's only.** Explore keeps the trackball as its only orbit,
because free inspection is the point there and the turntable was removed precisely because it could
not reach every angle (entry 35). Offering the lock as the default anywhere would re-create the
problem entry 35 records.

---

## 43. What this round's gates cost, and the one measurement that corrected the record

**Four checks were added for defects that had been found by eye.** Each was verified to FAIL when
its defect is reintroduced, because a gate that cannot fail is not a gate — and every gate in this
repository was green through all six defects last round.

- **Watertightness.** Reintroduced by deleting the vertex weld from the geometry ingest, which is
  the exact `436052a` regression: the ingest now refuses to write the pack. Also reintroduced from
  the data side, by deleting CobivecoX's declarations from its `pack.json`.
- **Blood pool decided.** Reintroduced by restoring `blood_pool: False` in `geometry.py`, and
  separately by stripping the decision out of a `pack.json`. Both are refused.
- **Blood pool never capped.** Reintroduced by removing the guard in `caps.ts`. Three tests fail.
- **The fixture never in the picker.** Reintroduced two ways — removing `fixture: true` from the
  catalogue entry, and removing the filter from `cataloguedPacks` — and the Playwright test fails
  both times.

**Measuring the shipped surfaces corrected something this repository had written down.** The record
said all 86 BodyParts3D parts are watertight, single-component and manifold after welding.
**Eighty-three are.** Three — the anterolateral papillary head, the right anterior pulmonary cusp
and the septal tricuspid leaflet — are two closed shells each in the source. Both shells of each are
individually clean; they are simply not joined, and welding merges seams and cannot join surfaces
that never touched. They are now declared individually in the source registry, and the earlier claim
is struck through where it was made. That is the first thing this gate found, and it found it
immediately.

**A stale declaration is refused too.** A pack that declares a reason for being unclean and measures
clean fails validation. A declaration that outlives its defect is how the next real one gets waved
through.

**One cost worth recording.** The Rodero pack's assets were re-emitted by this round's schema
change, and a handful of derived probe values moved by one unit in the last place — a BLAS
reduction-order difference on this machine, stable run to run here. Nothing is semantically
different; it is 5.3 MB of binary re-committed for arithmetic noise, and it is the price of the
pipeline being the source of truth rather than the committed artefact.

---

## 44. The two panels are a pair now, and the red banner is not over the image

**The owner's "align the two windows, make it look good", 2026-08-19, mid-session.**

**What was wrong.** The echo was a card with a title; the anatomy was a bare viewport with no title
at all. Side by side that reads as an illustration next to a named image, and it left the model
panel silent about the one thing a learner wants from it — *what am I looking at*. The two canvases
also started at different heights and were different sizes, because the anatomy box had been sized
to match the echo CARD (canvas plus its rows) from when the anatomy had no header of its own.

**What it is now.** Both are cards with the same header, and the canvases are the same size and
start at the same y — measured, not eyeballed: 314 px down and 341 px tall in both columns at
1400 px wide.

**The anatomy header names what you are looking at, in the order you are likely to be asking.**
The structure under the pointer first, then the one you isolated, then the model. A long derived
name truncates with an ellipsis rather than wrapping, because a header that grows a line taller than
its neighbour moves its canvas and undoes the alignment; the full name is on the element's `title`.

**The red "Simulated — not a recording of a patient" banner is gone from over the image**, at the
owner's request — the flags and licence furniture are being reworked as a set before this is put in
front of anyone else. The WORD is not gone: `WORKFLOW.md` carries a standing safeguard that
simulated echo is labelled simulated, so it now reads "Simulated" in the panel header and
"Simulated — not a recording of a patient" in the provenance line under the image, in ordinary type.
That is a deliberate reading of "drop the banner" rather than "drop the label", and it is easy to
finish removing if that is what was meant.

---

## 45. "Eight of the nine packs have no probe pose" is not what the packs say. Five have none.

**Checked before building anything, because the brief for this unit rested on it.** The count on
the shelf today:

| Packs with authored `views[]` | Packs with none |
|---|---|
| `normal-rodero` (4), `normal-alberta-neonatal` (1), `normal-vhl-heart0102` (1), `stub` (2) | `anatomy-bodyparts3d-heart`, `motion-biv-cinemri`, `motion-straus-us-patient01`, `normal-kit-four-chamber`, `tof-cobivecox-chd0017001` |

So four packs carry a probe pose and five do not. That does not change what this unit had to
build — five unlabelled packs is still the problem — but it changes what "placeable" means, and
the difference matters for the next unit rather than this one.

**Because the five are exactly the five with no `echo_volume`.** Schema v0 refuses views on a pack
with no volume — a view is a pose to image from, and there is nothing there to image — so the five
packs with no pose are the five that cannot enter Echo mode at all. **Placing a probe on them does
not make Echo enterable.** It cannot: what they are missing is a labelled volume, which is a
pipeline job, not a viewer one.

**Which is the honest answer to the question this round was asked to answer.** Anchor-then-adjust
makes those five packs *poseable* — a pose can be placed, saved, exported and handed back for
ingest — and it does not make them *echoable*. Both halves are true and the second one is the one
worth knowing before the next unit is chosen.

---

## 46. Anchor-then-adjust: it works, and it changes the shape of the job

**The gesture.** Orbit until the model is at the angle you want to look from, press one button, and
the probe is on that axis aimed at the model's centre. Then the pad does the fine work.

**On a pack with no view at all, this is the difference between possible and not.** Before it there
was no probe on those five packs — no wedge, no indicator, nothing. The pad cannot help, because
the pad turns a pose that already exists. Anchoring produces the first one.

**What it costs to get from an arbitrary start to a rough window, counted.** The pad's fan and aim
buttons are two degrees a press. Getting from an arbitrary orientation to roughly the right
approach is order ninety degrees on two axes, which is forty-five presses each, and the standoff
would still be wrong. Anchoring is one press and lands within a few degrees of what the eye chose,
because the eye chose it.

**Where it is less good than it looks.** The anchored fan is edge-on to the camera at the instant it
is placed — necessarily, since the beam runs along the view axis — so the thing you just made is
invisible until you orbit ninety degrees to look at it. That is not confusing so much as
anticlimactic, and the honest fix is a camera move on anchor, which is the same piece of work as
framing on isolate (entry 38) and is deferred with it.

---

## 47. The derived standoff, and the depth that no standoff can rescue

**The derivation.** For a cone of half-angle `a` to contain a sphere of radius `R` whose centre lies
on its axis at distance `d`, `d ≥ R / sin(a)`. That is exact, it is tangency, and the shipped
standoff is that quotient times 1.12. The cone rather than the fan, because the fan is planar and
cannot contain a solid — what is actually wanted is the property that survives the probe being
rolled, and that is containment by the cone of revolution.

**Across the shelf it spreads by a factor of eighty**, which is the argument against a constant:

| Pack | Bounding radius (mm) | Fan | Derived standoff (mm) |
|---|---|---|---|
| `stub` | 1.7 | 60° | 3.9 |
| `normal-alberta-neonatal` | 59.5 | 75° | 109 |
| `normal-rodero` | 76.7 (measured) | 80° | 134 |
| `anatomy-bodyparts3d-heart` | 103.5 | 75° | 190 |
| `normal-kit-four-chamber` | 140.6 | 75° | 259 |

A neonatal heart and a synthetic cube and an adult cast do not share a number, and nothing had to be
tuned for any of them.

**On `normal-rodero`, looked at.** The authored pose sits 81 mm from the bounding-sphere centre and
its fan visibly clips the heart left and right — the owner's report, confirmed by eye. The anchored
pose sits at 134 mm and the heart is comfortably inside the sector with black either side. That is
the improvement asked for and it is there.

**And the depth cannot be rescued by any standoff, on three of the four packs that have one.** The
two constraints together require `depth ≥ R · (1/sin(a) + 1)`:

| Pack | Authored `depth_cm` | Needed | Short by |
|---|---|---|---|
| `normal-rodero` | 16.8 | 21.0 | 4.2 cm |
| `normal-alberta-neonatal` | 8.6 | 16.9 | 8.3 cm |
| `normal-vhl-heart0102` | 19.1 | 31.1 | 12.0 cm |

There is no standoff that fixes this: moving the probe closer narrows the sector's reach across the
heart, moving it further pushes the far side further away, and the authored depth is under the
minimum either way. **So on `normal-rodero` the anchored fan contains the heart LATERALLY and
truncates it at depth**, and the panel says so in amber: "Fan depth is 4.2 cm short of the far side
— it needs 21.0 cm. Not changed."

**This answers the question the owner left open** — whether the anchor should also set
`fan.depth_cm` — with a fact rather than a preference. On these three packs, reporting alone leaves
a fan that cannot contain the model. Either the anchor writes the depth, or the three authored
depths are wrong content and get fixed in the packs. The unit reports and does not write, per the
brief; the decision is the owner's and it is now a decision with a number attached. `depth_cm` is
authored clinical content, so the recommendation is the second: fix it in the packs, where a review
state applies to it.

---

## 48. Slots: two kinds, one confirm, and the guesses that were shipped rather than decided

**Standard slots are the pack's `views[]` and saving over one never edits the pack.** It writes a
local override that sits *beside* the authored pose, the droplist says "— overridden", and "Revert
to authored" is exact because the authored value was never touched. That is enforced by the seeds
being deep-frozen clones and by no module under `src/authoring/` being able to import `Pack` at
all — asserted over the source, so it is a property of the module graph rather than a habit.

**The confirm on Save centre: right, and barely noticeable.** Pressing arms it and names what will
be overwritten; a second press does it. It is two clicks for a destructive act during a session
that might be an hour of placing, which is the correct trade — but it is worth saying plainly that
this was never tested against irritation, because it has only been used in a build session and not
in a placing session. **If it turns out to be an irritation, the thing to remove is the confirm on
CUSTOM slots and keep it on standard ones**, because those are the ones where the cost of a
mis-click is an override on reviewed content.

**Two things were shipped rather than decided, both flagged as open by the owner.**

* **Custom slots are NAMED, and capped at eight.** Named because an author placing eight positions
  on an unlabelled heart cannot tell "custom 3" from "custom 5" an hour later; capped because a
  droplist has to stay a droplist, and because a cap that is reached says so rather than growing
  silently. Neither is defended as the right answer.
* **`fan.depth_cm` is reported and never written.** See entry 47 — this one now has evidence
  against it.

**The button that is deliberately not where it would fit.** Save centre sits outside the probe
control pad, in the authoring block, with a rule above it separating it from the row that selects
the slot. The pad's buttons repeat while held and are pressed dozens of times in a placing session;
a destructive control adjacent to those is a mis-click waiting for a tired hand.

---

## 49. The stand-off stops were a trap, and only a pose from outside could find it

**Reported from the app mid-session: the closer/further buttons stopped working.** They had. After
anchoring, five presses of "closer" moved the probe origin by exactly zero.

**The rule was "the resulting clearance must be inside [3, 70] mm".** That is correct while the
probe starts inside the band, and from outside it every move lands outside, so every move was
refused — including the move back. Both buttons went dead with no way to recover.

**It could not be reached before this round.** Every pose on offer was an authored one, and authored
poses sit inside the band by construction; the pipeline parks the transducer 8 mm off the
epicardium. An anchored pose sits at the derived standoff, which on `normal-rodero` is 134 mm and
therefore well outside the far stop. **The first press after the first anchor found a latent defect
that had been shipped for a round and could not have been found by using the app as a learner.**

**Two smaller failures inside the same one.** The buttons' enabled state was predicted as
`clearance ± 2 mm` while the press measured the moved pose — different numbers, so a button could
be enabled and inert. And the room was recomputed only by the three places inside `PackViewer` that
move the probe, so a pose arriving from anywhere else left the buttons describing a pose no longer
on screen.

**The fix is that the stops are barriers rather than a band.** A step is allowed if it lands inside
the band or if it reduces how far outside the band the probe is. The stop still cannot be crossed;
it can be retreated from. The rule moved to `freeProbe.ts` where it is unit-tested, including a walk
that takes thirteen presses to return from 96 mm.

---

## 50. Four left edges under two canvases, and the 0.9 px that proves the measurement earns its place

**What "make it look designed" turned out to mean, measured.** Under the two canvases the control
rows sat at four different left edges: the anatomy's controls at 16 px from the card, the echo's
flip row at 0, its sweep label at 16, and the range input *inside that label* at 18, because a range
input carries its own 2 px margin. Three different row gaps, and the anatomy's first control row had
no gap at all from the bottom of the image — it was flush against it, because the rule that adds the
gap named `.cutter` and the first row is `.cutter-mode`. Controls in one row came out 28.8, 20.4 and
19.2 px tall.

Each of those was defensible where it was written. The set of them was not a design.

**Three tokens now**: one inset, one row gap, one control height, used by both panels. And the
alignment is asserted rather than written down: the visual suite measures that the two headers are
the same height, that the canvases start at the same y and are the same size, that every row under
either canvas sits at one inset, and that every control in those rows is one height.

**The measurement earned its place immediately.** Making "Simulated" a considered header chip —
outlined, tracked, uppercase — grew the echo header by **0.9 px** and moved its canvas down by 0.9
px, breaking the alignment that entry 44 established. Invisible to the eye, caught by the assertion,
fixed with `line-height: 1`. Last round the same alignment was measured by hand and written into
this file; a number in a document is not a gate.

**The word stays and now looks like it was chosen.** `WORKFLOW.md` carries the standing safeguard
that simulated echo is labelled simulated. The chip is not red — the banner was removed deliberately
and this is not it returning — and the full sentence is still in the provenance line under the
image.

---

## 51. Eight packs declare an orientation nothing measured

**Checked because the owner's proposal rested on it**, and it is the single most
consequential thing found this round.

| Pack | `meshes.orientation` | `meshes.anatomical_frame` |
|---|---|---|
| `normal-rodero` | up=+y, anterior=+z, patient_left=+x | `cardiac-landmarks-v2` |
| the other eight | up=+y, anterior=+z, patient_left=+x | **absent** |

Every pack declares the same triple. One of them derived it. The other eight
carry the ingest's default — not measured, just written into the field a
measurement would go in, and indistinguishable from a measurement once it is
there. The schema requires the field and cannot require evidence for it; the
`anatomical_frame` block is optional precisely because most substrates cannot
support the derivation.

**This is why the horizon lock levelling `orientation.up` was levelling nothing**
on eight packs, and why the four-chamber's long axis is worth more than the
declaration it replaces.

**What is NOT proposed here**: that the runtime should fix it. The plan at this
point was to carry a derived frame in the export and have a later ingest write
it with its own provenance and checks list. A runtime that overwrote
`anatomical_frame` would replace
evidence with a gesture, and the pack would go on claiming a derivation it no
longer had.

That was the pre-implementation plan. Entry 58 records the safer v1 boundary
that landed: export may report the frame, but pose ingestion deliberately
ignores it and leaves the pack's independently derived anatomical frame alone.

---

## 52. The four-chamber defines the axes, and the one thing geometry cannot decide

**The owner's proposition, checked and adopted.** An apical four-chamber is not
just another view: the transducer sits at the apex and the beam runs to the
base, so one pose states three things at once — the long axis **z** with the
sign the atria are on, the four-chamber plane giving left-right **x**, and the
plane normal giving anterior-posterior **y**. It maps exactly onto
`imagingFrame`'s `{beam, lateral, normal}` and onto the schema's own
`basis_source_to_pack` `{patient_left, basal, anterior}`.

**Handedness is made a tautology rather than checked.** `anterior` is
CONSTRUCTED as `patient_left × basal` rather than measured independently, so the
triple is right-handed by definition. That matters more than it sounds: a
left-handed basis mirrors the anatomy, puts right-sided structures on the left,
and looks entirely plausible doing it — which is the failure the schema's own
triple-product refinement exists to catch.

**The sign of x is not a geometric fact, and nothing here pretends otherwise.**
Rolling the probe 180 degrees gives the SAME plane with left and right
exchanged. No amount of geometry distinguishes them; what distinguishes them is
which chamber is on which side of the image, which is read off the anatomy. The
sign is taken from the pose's own `display.flip_lr` and the assumption is stated
on screen next to the axes it produced. **If the author places a four-chamber
mirrored, the frame comes out mirrored and everything downstream is mirrored
with it.** That is the one place in this unit where a wrong input produces a
confident wrong answer, and the only defence is the author looking at the image.

**Where it shows up immediately**: the Level lock. It held
`meshes.orientation.up` — the unmeasured default on eight packs — and now holds
the measured long axis when there is one. On `normal-vhl-heart0102` the
difference is a heart lying on its side versus a heart standing up with the
transducer under the apex.

---

## 53. Three defects, all found by using it, none by a test

The pattern from the review round holds: the gates were green through all three.

**1. "Save centre didn't save it."** It saved. The centre of the d-pad was the
wrong control. The brief specified the recall on the LOCKED pad — and a placing
session is never locked, because placing a probe sets a free pose — so the
button actually pressed was the learner's recentre, which returns to the view's
saved track and ignores the stored pose entirely. From outside, indistinguishable
from a save that did nothing. **A control specified for a state the user is never
in is a control that does not exist.**

**2. "The centre d-pad button is gone."** It rendered only when the selected view
held a pose. Select an empty canon view — which is most of them on a pack that
has just been opened — and the middle of the cross vanished. A control that
comes and goes is one you have to re-find; it is always drawn now and disabled
when there is nothing to recall.

**3. "The level selector does not respect the z axis."** Entry 52.

**And one found by looking rather than by being told**: a stored pose whose id
matched no view appeared in NO group on screen, while still being counted in the
total and still going into the export. A pose leaving in a file that no row
admitted to holding. Found on a store still holding rows written before view ids
were keyed on `view_id` — which will happen again, because a store outlives the
shape of the thing that wrote it. Orphans get a group of their own and a way to
clear them.

---

## 54. The hover hint, and the two things that make it not a native tooltip

**One card, one second, in the app's own type.** The native `title` tip fires in
about a second too, and renders in the OS's type at the OS's size wherever it
likes — on a screen of 0.85 rem controls and a measured panel pair, it is the
one element that looks like it came from somewhere else. The layer borrows the
`title` while the pointer is over the control, so the native tip cannot fire
underneath, and gives it back on leave.

**The delay was tried at three seconds, then 1.5, and settled at one.** Three
was the first ask and was long enough that the pause read as nothing happening.

**Concise is enforced, not hoped for.** Most `title`s here carry the reasoning as
well as the action — that is where the reasoning belongs — and a card
reproducing all of it would be worse than what it replaced. So an authored
`data-hint` wins, otherwise the FIRST SENTENCE of the title, and if even that
runs past 84 characters the hint is **dropped rather than truncated**: half a
sentence in a card is worse than no card, and an empty result is the signal to
write a `data-hint` for that control. The Playwright suite applies the rule to
every button, select, label and input on the page in both modes, so a new
control cannot ship without a usable hint — it found six on its first run.

**What it does not cover, and it is the half that would help most.** The
affordances drawn INSIDE the canvas — the cut-plane handles and the probe arrow
— are not DOM elements and have no `title` to borrow. They are precisely the
draggable things whose function is least obvious. Reaching them needs the scene
to publish what is under the pointer, which it already does for structure
hover; not built, and it is the obvious next thing.

---

## 55. Explore has no probe, and the cost of that on five packs

**The owner's correction, mid-session, and the second time this round a rule of
theirs overrode something I had built.** The authoring build briefly drew the
transducer and its fan in Explore, so that a pose placed on a pack with no
`views[]` would be visible somewhere. It is now gone, on the rule that Explore
is the heart on its own — a transducer floating beside it is a mode saying two
things at once, and that is exactly the disagreement entry 41 removed when
isolate was made Explore-only.

**Asserted rather than trusted.** The scene publishes `data-probe` on the host
and the Playwright suite reads it on `normal-rodero` and `stub` in Explore, and
in Echo to prove the assertion is about the mode rather than about a probe that
was never built. Verified to fail when the mode condition is removed.

**The cost, stated plainly, because it is the owner's to weigh.** Five packs —
`anatomy-bodyparts3d-heart`, `motion-biv-cinemri`, `motion-straus-us-patient01`,
`normal-kit-four-chamber`, `tof-cobivecox-chd0017001` — have no `echo_volume`,
therefore no views, therefore **no Echo mode at all**. Explore is the only mode
they have, and Explore draws no probe. So on the five packs this whole unit
exists for, **an author can place a pose, store it, derive the axes from it and
export it — and cannot see the probe or the fan while doing any of it.** The
numbers are right; the placement is blind.

**Three ways to close it, none taken, because the choice is the owner's:**

1. **Let authoring reach Echo on a volume-less pack.** The 3D panel draws the
   model, probe and wedge; the echo panel shows the refusal it already has for
   these packs. Honest — "Echo" means there is a probe, and the IMAGE is what is
   unavailable — and it touches the learner mode gating, which is why it was not
   done unilaterally.
2. **An authoring-only third mode**, so Explore's rule is untouched and the
   probe has somewhere to live.
3. **Leave it blind and place by the numbers**, using the derived-axis readout
   and the standoff report as the only feedback. Workable for the four-chamber,
   where the camera angle IS the placement, and poor for anything needing a
   nudge.

---

## 56. The learner build is a SUBSET of the author build, not the other way round

**Owner's direction, 2026-08-20:** *"Let's focus on the author complete build for
now. The learner build is not a separate build but a subset, so it will be easy
to create after we have completed the full build. Right now the incomplete build
is lacking in many ways."*

**This reverses the framing of the last round without changing a line of the
gating.** The flag already produces exactly this relationship — one codebase, one
build-time constant, and Rollup drops what the learner does not get — so nothing
architectural moved. What moved is where effort goes: the author build is the
product being built, and the learner build is what falls out of it.

**And it immediately unblocked the thing observation 55 recorded as the owner's
call.** Five packs have no `echo_volume`, therefore no views, therefore no Echo —
and Explore draws no probe, so placement on those five was blind. Option 1 was
"let authoring reach Echo on a volume-less pack", and it is the option that
satisfies BOTH of the owner's rules at once:

* **Explore still has no probe**, in any build. That rule was never what was in
  the way.
* **Echo is where a probe is.** A learner is offered Echo to look at an image and
  on these packs there is no image, so the mode is withheld from them. An author
  is in Echo to place a PROBE, and a placement needs no volume — the wedge on the
  model is the entire feedback loop.

Verified on `anatomy-bodyparts3d-heart`, which authors nothing: Echo reachable in
the authoring build, single-column stage, the probe and fan drawn, the note under
the mode buttons saying why there is no image, and the anchored fan containing
the heart. In the learner build the pack still refuses Echo with the same words
it always did.

**A second bug fell out of the same screen.** "Match echo" — the one button whose
entire job is agreement between the two panels — read `view.probe`
unconditionally. So it faced the pose the PACK authored rather than the one being
imaged the moment the probe was unlocked, and did nothing at all on a pack with
no views. It now faces whatever is driving the image, which is the rule the wedge
and the echo already follow.

---

## 57. Free probe placement may be a learner feature, not only an author one

**Owner, 2026-08-20:** *"authoring view is also kinda cool because it allows for
free probe placement, which on its own is a good learning feature."*

Worth recording as a product idea rather than acting on. What exists today splits
cleanly:

* **Already learner-reachable:** the `Free probe` toggle and the control pad —
  turn the probe by hand, off the saved track, with the echo panel withdrawing
  the view's name while it is off. Shipped last round.
* **Authoring only:** `Place from camera` — the gross-placement gesture that puts
  the probe on the axis you are looking down.

So the "good learning feature" the owner is describing is mostly the *anchor*.
Making it learner-reachable is a small change and a real decision: it would let a
learner say "image it from here", which is a genuinely good exercise, and it
would also let them produce an arbitrary plane in one press rather than in forty.
The labelling that makes the free probe defensible — the echo panel withdrawing
the view name — already covers it, so the argument against is about what a
learner should be ENCOURAGED to do rather than about what they could claim.

Not built. It is a scope question for the learner build, which by entry 56 is the
last thing to be cut rather than the first.

---

## 58. Q25 closes in the draft, and the pack changes only after crossing two named boundaries

**Owner decision, 2026-08-20:** explicit `Place from camera` may expand the local working pose's
`fan.depth_cm` to the measured minimum needed to reach the model, but may never shrink the supplied
depth or mutate the loaded pack. This is safer than bulk-correcting shallow pack values as a side
effect of placement: the adjustment is visible on screen, remains session/local-store data, and can
leave only through **Save → `authoring-slots/v1` export → explicit ingest**. Ordinary viewing still
has no path to it. Switching packs now drops the free pose, so model-space coordinates cannot be
saved under the wrong pack.

**The round trip was run, not synthesized.** A fresh Chromium authoring session selected Rodero's
`view-ingest-reference-pose`, placed from the default camera, saved the local override, and captured
the browser download. The report measured a **141.1 mm** standoff and expanded depth from **15.54 cm
to 21.779307682107543 cm**. The exact JSON content is retained at
`tests/fixtures/authoring/normal-rodero-ingest-reference-pose.authoring-slots-v1.json`, with source
pack version `0.1.0`, saved time `2026-08-20T21:19:34.948Z`, and export time
`2026-08-20T21:19:34.981Z`.

**Ingestion is a separate fail-closed tool.** Preview is the default; `--write` requires exact
source pack revision and schema identity, a changed output pack version, the standard slot for one
existing view, and a `draft` target with no recorded review history. It validates the original and
complete candidate packs. The Rodero proof updated only `ingest-reference-pose`, bumped the pack
from **0.1.0 to 0.1.1**, kept review `draft`, and left `meshes.anatomical_frame` untouched. Its sweep
axis moved rigidly from `[1, 0, 0]` to the new probe's lateral axis
`[0.6216099682706647, 5.551115123125784e-17, -0.7833269096274834]`; the already-empty
`structures_in_order` was reset pending any future measurement. The old pose-derived
`placement_landmark` was invalidated pending content review, and provenance now names the source
pack revision, slot, and timestamps instead of claiming the current pose came only from
`pipeline/ingest.py`.

The writer serializes the complete validated candidate. On this Python-generated pack that also
caused a one-time textual normalization of equivalent JSON number and Unicode spellings; a deep
semantic comparison found no changes outside the version and the target view fields named above.
This cycle also tightened the still-pre-stable `authoring-slots/v1` envelope by requiring the source
`pack_version`; earlier dev exports without it are intentionally refused and must be re-exported.

No clinical view was asserted, no review was promoted, and the Alberta/VHL shallow-depth findings
were not bulk-edited. Entry 47 remains the historical recommendation that preceded this owner
decision; this entry supersedes its proposed remedy without rewriting the finding. Learner access
to the placement gesture remains the separate, still-open question recorded in entry 57.

---

## 59. Four geometry-only models leave the picker; their evidence stays

**Owner judgement, 2026-08-20.** Of the five Explore-only models, BodyParts3D is the only one worth
keeping in the normal model list for now. `motion-biv-cinemri`, `motion-straus-us-patient01`,
`normal-kit-four-chamber`, and `tof-cobivecox-chd0017001` read as incorrect blobs or incomplete
shells, with conspicuous or missing openings, rather than as useful anatomy.

**This is picker withdrawal, not registry or evidence destruction.** The four pack directories,
assets, provenance, validators, and complete registry entries remain untouched. They are absent
from the normal development droplist but remain reachable by an explicit development `?pack=` URL for
research or comparison. Removing one id from the hidden list restores it without re-ingest. Pages
is unchanged: none of these packs was published there.

---

## 60. Authoring opens on the whole heart, and saved-view cuts face the author

**Owner direction, 2026-08-20.** The first authoring frame must not silently present B1 while the
authoring selector names an empty A1 slot. `None — full heart` is now a real neutral presentation:
it is selected on cold authoring load, draws no probe or beam, leaves Cut off, withholds the echo
panel, and frames the loaded anatomy alone. It is not a pack view, local slot, export row, or review
state. Selecting an empty canon row keeps that row as the next placement target but also keeps the
neutral presentation, rather than leaving a different view visible behind its name.

**The learner boundary is deliberate.** The learner subset has no view rail yet. Making its cold
state None would leave no route to an echo view, so its existing first-view cold path remains until
the rail is built. The authoring selector is the current place where nullable view selection can be
used honestly; the future rail contract already permits `currentView() = null`.

**The opaque-side cut bug was the same kind of stale presentation.** The cutter previously chose
its camera-facing half only when Cut was enabled. B1/B4 and F1 need opposite retained halves, so a
sticky flip from the preceding view could put intact opaque tissue in front of the section. At an
app-driven saved-view landing, Echo-plane mode now evaluates the camera against the actual offset
plane `Q = C + sN` and applies Reverse if needed. It does not watch manual orbit, does not touch the
Free cutter, and does not override a manual Reverse until another saved view is applied.

---

## 61. Echo depth now has a visible physical scale

**Owner direction, 2026-08-21.** The echo image now shows small calibration dots at one-centimetre
radial intervals along the screen-right fan edge. If an unusually wide sector runs outside the
canvas, its markers follow the visible right crop edge while remaining on their exact radial depth
circles. The ruler uses the exact live fan depth: changing depth, scrubbing, or moving between
authoring views changes its spacing with the image. Flip apex mirrors the radial direction
vertically, while `flip_lr` and the separate probe-notch `marker_side` convention do not move the
screen-right ruler.

**What to look at.** The dots should read as quiet device chrome, not bright anatomy: 3 CSS px,
cool grey, no glow, no labels, no focus marker. The vertex and exact distal boundary carry no dot,
so neither end is half-clipped. The overlay is outside the WebGL echo raster, preserving the
renderer’s grey-level and performance measurements. Numeric depth labels, a focus marker, and the
removed probe-orientation mark remain separate decisions.

---

## 62. C1 and C2 now use distance-first review poses, not wider probe heads

**Owner correction, 2026-08-21.** The first C1/C2 poses inherited the pipeline's old 8 mm
visual stand-off and looked implausibly close. The current generated review set moves both
apertures backwards without changing their imaging axes or 70 degree fan heads. C1 now has a
30.000001 mm reference forward gap (31.812369 mm to the nearest source vertex), 14.32 cm depth,
and 9.21 cm focus. C2 has the same measured forward lower bound throughout its normal-axis
translation, 30.052534 mm nearest sampled vertex distance, 13.93 cm depth, and 8.89 cm focus.
Both depths leave more than the required 5 mm distal guard.

**What this does not claim.** C1's apex and part of its projected heart envelope remain outside
the retained 70 degree sector; C2 also has measured lateral clipping. Those are visible,
non-gating probe-head limitations for later work, not reasons to push the current aperture an
implausible distance away or silently widen the head. The 30 mm rule remains an adult Rodero
visual-layout proxy on a heart-only source, not a chest wall, patient measurement, pediatric
default, or clinical validation. Candidate files are generated working evidence and may be
regenerated in place; the registry locks their current bytes and the Python replay checks the
geometry.

**Working-definition wording.** These imported coordinates are the views currently being defined,
so the authoring selector no longer appends `— overridden` or presents that as their status. The
browser still keeps the loaded pack pose intact underneath and offers **Restore pack pose**; the
storage boundary remains exact without turning implementation language into the author-facing
meaning of the row.

## 65. A registered chest turns three proxies into measurements — and disagrees with two of them

*(2026-08-22.)*

**The chest wall was a number, and now it is anatomy.** Every Rodero pose was authored against a
heart-only mesh, so the stand-off was measured from the EPICARDIUM and a 30 mm "adult visual-layout
proxy" stood in for a chest. With the BodyParts3D chest registered, that proxy is checkable, and it
was wrong in the direction nobody could have seen: five of six apertures sat INSIDE the body — B1
19.7 mm deep to the skin, B4 21.6 mm, C2 11.9 mm, F1 66.5 mm. Only C1 was on the wall. B1, B4 and
C2 were migrated back along their own beams; the imaging plane is preserved exactly and only the
stand-off and the depth change.

**F1 says something different, and it was not migrated.** Reaching skin needs 73.7 mm of retreat
and a 22.19 cm imaging depth, outside the range adult transthoracic imaging works in. A correction
that large is not a stand-off error; it says the right-parasternal plane itself needs reauthoring.
`migrate_apertures.py` refuses retreats over 40 mm for exactly this reason: a tool that slid it
anyway would have produced a geometrically consistent, clinically useless pose.

**The composite is slightly too big for its chest, and that is disclosed rather than fixed.**
Cardiothoracic ratio 0.543 against 0.491 for BodyParts3D's own heart in the same chest; diaphragm
overlap 9.9 mm against 3.3 mm. Placement is right — apex at the midclavicular line, two thirds left
of midline, nothing behind the spine or outside the skin. The difference is one fact: Rodero is
14 mm wider. And Rodero is the credible heart (LV 86.7 mm base-to-apex, normal adult range) while
BodyParts3D's is 65.9 mm, below range, in a source that admits artist adjustment. Repairing the
ratio means scaling one of the two bodies and then reporting false dimensions for whichever was
scaled, so it is measured and published instead.

**Two containment methods were wrong before one was right.** BodyParts3D's skin is a thin closed
SHELL, not a solid: its own volume reads 3.4 L. `trimesh.contains` returns false for everything
including the thoracic spine, and ray-parity voting counts two crossings from an interior point —
one through each face of the layer — so both call a point inside the chest "outside". Only a
radially-outward ray, validated against a known-inside and two known-outside controls, gives the
right answer. Worth recording because the wrong methods are the obvious ones.

**The probe was a third of life size.** 33 mm end to end with a 16 mm barrel, built from four
cylinders and a sphere. Against a heart alone that read as hardware; against a true chest it read
as a marker lying on skin. It is now an adult phased-array transthoracic probe: 21 x 15 mm
footprint, 30 x 22 mm handle, 108 mm housing, 126 mm with the cable stub — comparable in length to
the heart is wide, which is what those two objects are. One revolved profile rather than stacked
primitives, flattened into an elliptical cross-section whose wide axis IS the array's long axis, so
the silhouette states the imaging plane without any marker on it. Off-white, like the hardware.

**Known cost.** At the default framing a real probe runs past the panel edge, because the camera is
framed on the heart and the framing cap that keeps it the subject was left alone. The scan head and
most of the handle are visible.

## 66. A heart with twelve chambers and a wall it may not teach

*(2026-08-22.)*

**What landed.** `normal-vhl-heart0102-chambers` is on `dev`: twelve observer-authored structures
— six lumen casts and six per-chamber myocardium surfaces — a 192³ labelled echo volume, and a
cardiac basis measured from the same observer's 27 chamber seeds. Against the undivided Heart0102
it replaces in the development picker, that is one tissue body becoming twelve named ones, so
show/hide, per-structure cut caps and a second echo-capable substrate are exercisable on something
other than Rodero for the first time.

**The wall is the thing to look at, and the thing not to believe.** LV wall volume : RV wall volume
is **1.09 : 1**, against about 2.6 : 1 on `normal-rodero`, and three independent measurements agree
this model carries no left-right wall asymmetry. **This pack must not be used to teach wall
thickness.** Nothing in the geometry is broken by that: the surfaces are exactly the authored label
boundaries, extracted with no smoothing, no decimation and no invented geometry. The labels simply
do not encode a thicker left ventricle, and painting one in would have been fabricating the finding
the pack exists to report.

**Two chamber volumes are also wrong, and only one is understood.** RV lumen is **148.3 mL** against
an expected 60–100 mL; its 384³ label is one face-connected volume, so the excess is not stray
debris, and it is **unresolved**. RA lumen is **75.0 mL** against 25–45 mL, and that one has an
explanation — it includes the caval stubs and the atrial appendage.

**Why it was merged with all of that still true.** It is development-only and cannot become a
teaching claim by accident: the source is CC BY-NC 4.0, `license_state` is `non_commercial`, the
pack is absent from `PUBLISHED_PACK_IDS`, the build filter drops it from `dist/`, and
`check:published-packs` and `publishedPacks.test.ts` both assert it stays out. A wall that may not
be taught cannot reach a learner from a pack that never ships. Isolating the branch instead would
have kept the same limitation and lost twelve structures the platform can be built against.

**The limitation is data, not a log line.** All three figures are in the pack's own
`provenance.modified.note`, which is schema v0.1's only carrier for them — `Provenance` is a
`strictObject` with no limitations field, and inventing one would freeze a provisional content
finding into the schema. The note is generated by `pipeline/vhl_pack.py`, which independently
re-measures the ratio and refuses to write a pack if it moves off 1.09. So the caveat travels with
anyone holding only the pack, and it cannot silently drift away from the geometry it describes.

**Deferred on purpose.** The RV lumen figure is not resolved, no body context or reference chest is
bound to this pack, and no view has been authored or probe placed on it — its one view is the
mechanical ingest reference pose, flagged Draft and explicitly not clinical. The original
`normal-vhl-heart0102` is byte-unchanged and stays as the 2026-08-19 substrate-rejection evidence;
this derivative does not overturn that verdict, it sits beside it.

## 67. A chest fitted to this heart, and the two things the fit does not fix

*(2026-08-22.)*

**What to look at.** Load `?pack=normal-vhl-heart0102-chambers`, tick **Show chest**, then press
**Fit chest**. The chamber-labelled heart now sits inside a thorax that was sized for it:
`fitted-chest-bp3d-heart0102-chambers` is the same BodyParts3D source as the adult chest, scaled
uniformly by **1.211184** until the heart occupies the same fraction of the thorax that
BodyParts3D's own heart occupies in its own — cardiothoracic ratio **0.4911** against a target of
0.4911, the same measurement the adult composite reports. The adult chest and its Rodero binding
are untouched, and each pack has its own context.

**The factor is greater than one, and that is the headline.** The chest was made 21 percent BIGGER,
not smaller. A 14-year-old's heart needing a thorax larger than an adult male's is not a fact about
adolescents: BodyParts3D's own heart is undersized for its own body (65.9 mm base-to-apex), and this
specimen's own outer transverse width is 140.1 mm. Uniformly scaled, the source body's 1719 mm skin
height becomes 2082 mm — a number with no meaning except as a reminder that this is a ratio fit and
not a body. *(Corrected 2026-08-22: this paragraph first blamed the factor on the pack's unresolved
148.3 mL right ventricular lumen. It is not that, and entry 68 says why.)*

**Where the apex lands.** The left mid-clavicular line sits at x = 92.2 mm; the measured LV apex
lands at 81.5 mm, **10.7 mm medial** to it, and the heart's left border reaches 95.2 mm, crossing
the line by 2.9 mm. The native pair crosses it by 3.9 mm. So the apex sits just inside the
mid-clavicular line with the heart's silhouette reaching a few millimetres past it, which is where
an apex belongs. 74.4 percent of the heart is left of midline, against 68.8 for the native pair.

**The first thing the uniform fit does not fix: the heart floats.** Clearances are 14.6 mm to the
ribs, 14.8 mm to the sternum, 15.0 mm to the spine and 8.2 mm to the diaphragm, and **zero** of
2,988,093 heart vertices sit below the diaphragm dome. In a real chest the heart sits ON the
diaphragm — BodyParts3D's own heart overlaps its dome by 4.6 mm across 418 of its vertices. This one
is suspended in the middle of its cage. The scaling rule fixes SIZE, and nothing in it constrains
where a chamber-centroid registration puts the heart front to back. Both facts are measured and
reported; neither is repaired, because moving the heart to touch would be authoring a placement
rather than measuring one. Entry 68 measures how much of this the native pair shares.

**The second: nothing about the ribs became age-correct.** A uniform scale multiplies every
distance by one number and changes no angle and no proportion. The ribs still run at adult
obliquity, the intercostal spaces are adult spaces merely further apart, and the costal cartilage is
the adult source's. **A probe window indexed to an intercostal space on this chest is approximate**,
which is exactly why authoring or migrating echo view angles onto it is the next unit and is
deferred until this one is signed off.

**What the registration cost.** This pack has no valve-ring geometry — its source carries none and
its provenance records that none was invented — so the four valve centres the Rodero fit uses do not
exist here. It is fitted on the four chamber-cavity centroids plus an apex-direction landmark
instead: same estimator, same scale lock, cruder correspondence. RMS residual 9.220 mm and max
11.915 mm against Rodero's valve-plane fit, with the long axis agreeing to 3.5 degrees. Part of that
residual is the unresolved right ventricle: a cavity centroid moves with how full the cavity is.

**Two licence readings, on purpose.** The adult context records CC BY 4.0, read from the rights
holder's current page. This one records **CC BY-SA 2.1 Japan** with the 2008 Life Science Integrated
Database Center copyright line, per the owner's instruction, and treats the scaled mesh as a
share-alike derivative. The source's licensing history genuinely is inconsistent and share-alike is
the more restrictive reading, so honouring it satisfies either. Both descriptors say which reading
they carry and why; reconciling them is an owner decision about both, not a pipeline change.

**Neither the pack nor the chest ships.** The bound pack is CC BY-NC 4.0 and `non_commercial`. The
build filter and `check:published-packs` now cover `public/body-context/` the way they already
covered `public/packs/`, so a context reaches `dist/` only when the pack it serves does.

## 68. The fitted chest, checked against a real pair and a textbook — and two things I had wrong

*(2026-08-22. Entry 67 asserted the fit; this one tests it. Every figure here is now re-derived by
`placement_verification` in `pipeline/body_context.py` rather than written down once.)*

**Orientation is right, and it is right for a reason the fit could not have forced.** A rigid fit on
four chamber centroids is never told which way is down, where the sternum is, or that a heart leans
left. Measured against BodyParts3D's own heart in the same chest, the placed long axis disagrees by
**3.5 degrees** — 55.2 degrees of leftward tilt off the midsagittal plane against the native pair's
52.0, and 44.1 degrees of anterior tilt off coronal against 44.3. All six chamber relations come out
correct with margins in the same range as the native pair: RA right of LA 36.6 mm (native 39.8), RV
right of LV 28.1 (18.4), RV anterior to LV 25.4 (30.8), LA posterior to RA 23.3 (33.7), atria above
ventricles 25.4 (16.0). Against the textbook: 74.4 percent of the heart is left of midline where
sources say about two thirds; the apex lands **10.7 mm medial to the left mid-clavicular line**,
where sources put it "just medial to the midclavicular line", with the left border crossing that
line by 2.9 mm against the native pair's 3.9 mm. Nothing about the orientation is in doubt.

**Placement is not right, and the reason is shape, not scale.** Sources agree a heart *rests on the
superior surface of the diaphragm*. This one clears the dome by 7.2 mm at every one of its 2,988,093
vertices; the native heart overlaps its own dome by 4.6 mm across 418 of its. That is a difference of
KIND. The sternal gap is 14.6 mm against the native pair's 7.15 mm — an excess of 7.4 mm, not the
whole gap, because BodyParts3D's sternum is bone alone and the costal cartilages the right ventricle
actually lies against are a different concept. So the honest claim is "7.4 mm further off than a real
pair", not "not touching".

**And no scale of either body fixes it.** At equal transverse width the placed heart is
**depth/width 0.807 against the native pair's 0.919** — about a tenth shallower front to back. Walk
the chest scale down and both gaps close, but the ratio goes with them: 1.2112 gives CTR 0.4911 with
a 14.6 mm sternal gap; 1.15 gives 0.5180 and 10.1 mm; 1.10 gives 0.5422 and 7.8 mm; 1.05 gives 0.5686
with the heart 0.4 mm off its diaphragm; and at **1.00 the heart erupts through the left ribs** (957
points) before it ever reaches the sternum. You can have a normal cardiothoracic ratio or a heart
that touches its own diaphragm. Not both.

**Scaling the HEART buys exactly one thing, and it is not this.** The composite's relative geometry
depends only on the ratio of the two scales, so moving the factor from chest to heart leaves the
ratio, the orientation, the clearances and the contact gaps pixel-for-pixel identical and changes
only the absolute size of the pair — a real adult-male-sized composite instead of a 2082 mm one. It
is also not free: `frameToBody` carries every probe pose's `depthMm` and `focusMm` through the
model-to-body transform **unchanged**, which is correct only at unit scale, so a scaled heart would
show one size on screen and another in the echo's own depth scale. That is the dependency
`body-context/v0` is protecting when it pins the scale to literal 1, and it is a live one at about a
dozen call sites — not a schema nicety.

**Two things entry 67 and the descriptor had wrong.**

*The scale factor does not inherit the RV lumen figure.* The scale was solved against the heart's
OUTER transverse width. The right ventricular lumen is an interior label, and repartitioning the
inside of a tissue body cannot move its outer envelope. The width is 140.1 mm and it is the
specimen's own — large for fourteen, about two standard deviations above the 115.3 ± 12.0 mm mean
reported for 17–21 year olds, and inside the 155 mm upper limit of normal quoted for adult males.
The Visible Heart Laboratories perfusion-fix their specimens with formalin **under pressure to hold
an approximation of the end-diastolic state**, which is the fullest the chambers ever are. A wide
heart needs a wide thorax to reach a normal ratio. That is the whole of the factor.

*And 148.3 mL may not be the defect at all.* Against paediatric CMR reference equations for exactly
the end-diastolic volumes this specimen was fixed at — RVEDV = 83.8 × BSA^1.469 and LVEDV = 77.5 ×
BSA^1.380 for males — the pack's 148.3 mL right ventricle implies a body surface area of about
**1.48 m²**, ordinary for a fourteen-year-old boy. Its 82.1 mL **left** ventricle implies about
**1.04 m²**, which is not. The right-to-left lumen ratio is 1.81 where normal is near 1.1, and the
left ventricular wall is labelled at 150.0 mL against 137.3 for the right. Read together those point
at the left ventricular wall having been labelled inward at the expense of its own lumen — the same
defect the pack already reports as its 1.09:1 wall ratio — rather than at an oversized right
ventricle. This is an observation about the pack and changes nothing in it; repartitioning it is a
separate decision, and this context does not depend on the answer.

**One measurement method corrected too.** The descriptor called this pipeline's cardiothoracic
denominator "the radiographic internal thoracic diameter". It is a proxy for it: the radiographic
quantity is the inner rib margin at the level of the dome of the right hemidiaphragm, and this
pipeline uses the pleural span at the heart's own height. Measured both ways on the native pair they
differ by **0.0027** of ratio, so the proxy is fair — and it is now named as one, measured on every
run, and flagged for the further gap no measurement here closes: the radiographic figure is read off
a projected film with its own magnification, and these are true three-dimensional extents.

## 69. Ten probe poses that had to find a window first

*(2026-08-22.)*

**What to look at.** `normal-rodero` is v0.1.4 with ten Draft views (was six) and
`normal-vhl-heart0102-chambers` is v0.1.1 with seven (was one). The ten new ones were placed by
`pipeline/acoustic_windows.py`, and the thing to look at is not the plane — it is where the
transducer is standing. It is on skin, in a named interspace, and its whole fan has been cast
against the ribs, the costal cartilages, the sternum, the clavicles and the lungs before the pose
was kept.

**A window is a gap, not a direction.** Every pose in this repository before now was aimed: build a
plane out of cardiac landmarks, then back the probe away from the geometry until it is outside.
That produces a beautiful plane through the fourth rib, which is not a view, it is a picture of a
rib. Ultrasound crosses neither bone nor air, so a real study is a search — slide and angle until
the beam finds a path between two ribs and through the cardiac notch. This does that search
exhaustively: a named region of skin, every candidate aperture that can stand in the view's own
imaging plane, twenty-one rays each, and a window counts as open only when the central 45 percent of
the sector reaches cardiac tissue without crossing bone or air.

**The bug worth recording.** The first run reported almost every window shut, including the
parasternal. The rays were being run past the heart and out the other side, so the lung behind the
left atrium and the vertebral body behind that were counted as obstructions — to structures the beam
had already imaged. A blocker only blocks if it lies BETWEEN the transducer and the heart. Lengthing
each ray at its first intersection with cardiac tissue turned five shut windows open, and it is the
difference between a physical test and a plausible one.

**Ribs are named, so interspaces are reported rather than asserted.** BodyParts3D ships every rib
1–12 and every costal cartilage 1–7 per side as separate concepts, so each aperture is bracketed by
its own two ribs and says which. Costal cartilage is scored separately from bone and never folded
into it: it is not the same acoustic obstacle, and in a child it transmits. Where an aperture is not
between two consecutive ribs the placement says exactly that instead of rounding to a plausible
number — four of the apical poses land "lateral to the curve of the left rib 6", which is honest and
is also a finding about where these hearts sit.

**The subcostal blocker was half real.** Entry 58 and `view_canon.md` recorded that A3 and A4 could
not be authored on Rodero because the subcostal family is defined by the beam entering from below
the diaphragm, "below" is a body axis, and a heart-only mesh has none. A registered chest removes
exactly that: **A3 is now authored on both packs**, entering below the xiphoid with the beam cast
under the costal margin. **A4 is still not authored, on a different ground that no chest fixes** —
it is the bicaval reference and neither substrate has separately tagged cavae.

**A pack with no valve rings got its valves back.** `normal-vhl-heart0102-chambers` has no
valve-ring geometry and never will; its source carries none and its provenance records that none was
invented. But two chamber lumens are separated by myocardium *everywhere except at the valve they
share*, so the surface where two lumen labels come within 2 mm of each other IS that orifice. All
four come back: mitral, tricuspid, aortic and pulmonary, each a compact and strongly planar patch.
At 1 mm the aortic one is empty — the authored 384³ partition leaves a one-voxel gap there — which
is why the tolerance is 2 mm and why that number is in the code with its reason.

**What is visibly wrong, and is reported per pose.** The parasternal long axis on the chamber pack
lands in the left **2nd** intercostal space; a PLAX belongs at the 3rd or 4th, and this is the
floating, high-sitting heart of entry 68 pushing the plane's skin trace upward. Stand-offs run
41–51 mm on Rodero and 52–110 mm on the chamber pack, where a real adult parasternal window is
20–30 mm of chest wall; the chamber pack's are additionally inflated by its 21 percent chest. Its
subcostal pose sits 62 mm below the xiphoid and needs 24.9 cm of depth, past where transthoracic
imaging works. And two views could not be placed on it at all: the apical two-chamber and the apical
long axis found no plane in their allowed range with both an open window and their own landmarks in
it. Those failures are in `evidence/acoustic-windows/`, because a pack has nowhere to say that a
view was attempted and failed, and that is what tells a reader about the substrate rather than about
the poses.

**One near-miss caught by a guard rather than by luck.** The first write added
`b4-apical-long-axis` to Rodero, which already carried `b4-apical-three-chamber` — the same clinical
view under a second id — and it also re-sorted the pack's existing views. Both were reverted. The
writer now refuses to add a view that collides with an existing one by name or alias, never
reorders, and leaves an authored pose untouched; `tests/unit/acousticWindows.test.ts` asserts that
the six poses a person authored on Rodero still carry no trace of this module.

**The cascade.** Adding views moves a pack's bytes, and a `body-context/v0` registration pins those
bytes, so both contexts had to be re-derived or every new pose would be placed through a
registration the loader refuses to apply. Only `pack_binding` changed in either descriptor — the
registrations, the residuals and both chest assets are byte-identical.

**Nothing here is vetted.** Every pose is Draft, no clinician has read a window or a plane, and each
one carries the sentence the chest makes unavoidable: it is an adult male thorax, so the interspace
it names is an adult interspace and is not age-correct.

## 70. Three things that were wrong when you looked at it

*(2026-08-22. All three came from one session of actually using the viewer, which is what this file
is for.)*

**The sector was not centred, and about six degrees of that was mine.** The beam was aimed at the
mean of a view's landmarks — for the four-chamber, the midpoint of the two atrioventricular
orifices — and that is not the middle of the heart as seen from the apex. Measured on the
chamber-labelled pack: tissue spanning **−19.8° to +31.9°** inside a ±35° sector, so 15.2 degrees of
dead sector on one side against 3.1 on the other. The beam is now rotated WITHIN the imaging plane
until it bisects the angular spread of the tissue that plane actually cuts, which changes the plane,
its normal and every landmark residual not at all, and moves only the angular test. The same view
now reads **−25.9° to +25.9°**. The window is re-cast after the re-aim, because a re-aimed fan
sweeps different rays; where centring shuts the window the original aim is kept and the pose says so.

**The rest of "not centred" is not centring at all, and no re-aim fixes it.** Between the
transducer and the first tissue there is 26–48 percent of the sector's depth, empty. That wedge is
the composite's own stand-off: 54.7 mm from skin to heart at Rodero's apical window, 71.8 mm at the
chamber pack's, 110.5 mm at its subcostal one, against roughly 20–30 mm of real adult chest wall.
It is chest wall plus the floating heart of entry 68, and it is now stated on every pose rather than
left to look like a framing decision.

**The light was behind the patient.** One directional light, fixed at `(1, 1.4, 1)` in the
patient/body frame — where `+Y` is POSTERIOR. So the key sat behind the chest: orbit round to the
front, which is where a learner reads a heart from, and you are on the shadowed side of everything.
Worse, a structure's brightness was a fact about where the body frame pointed rather than about
where you were standing. Now: hemisphere fill, a key that rides the CAMERA so the side turned toward
the learner is always lit, and six low axis fills so nothing is ever black. Total intensity held
close to the old rig's, because the translucent chest was tuned against that level. A lighting
panel is wanted and is recorded as deferred in `docs/build_plan.md`.

**And the lag has a number.** `pipeline/geometry.py` has carried a per-pack budget since wave 0 —
15 MB of derived assets and 220,000 triangles, from the build plan — and enforces it by decimating
on the way out. `normal-rodero` sits at 12.4 MB and 222,380 triangles, which is that budget working.
`normal-vhl-heart0102-chambers` sits at **151.2 MB and 6,029,784 triangles: ten times the byte
budget and twenty-seven times the triangle budget.** *(Corrected 2026-08-22: the two byte figures
first read 11.9 MB and 144 MB, and the ratio "nine times". Those are MiB, and the budget they were
being compared against is not: `GEOMETRY_BUDGET_BYTES` is 15_000_000 and the gate divides by 1e6, so
the same packs print 12.4 MB and 151.2 MB. Decimal MB is now the convention wherever a pack size is
quoted, stated once at the constant in `pipeline/geometry.py`. Only the units moved; the bytes and
the triangles are unchanged.)* It is not a regression and not a mistake — that pack
is built by `pipeline/vhl_pack.py`, which decimates nothing on purpose, and "no smoothing,
decimation or hole filling" is one of its stated properties. But the budget was a STEP inside one
pipeline and never a CHECK, so a pack built by another pipeline simply never met it. Now it is
checked: `npm run check:pack-budget` measures every pack, and the oversized one is a named exception
carrying its size and the decision behind it, so an existing exposure is visible and a new one
cannot arrive unnoticed. Whether to decimate that pack is a decision about the pack, and the honest
trade is legible now: its interiors are the reason it is heavy, and its interiors are the reason it
exists.

## 71. The probe has to be touching the patient, and the two builds stop pretending to be one

*(2026-08-22. Owner decision, from looking at a pose in the viewer and not recognising it.)*

**The pose nobody could name was 92.31 mm off the body.** The chamber-labelled pack's ingest
reference pose put its transducer nine centimetres clear of the skin, and `normal-rodero`'s
right-parasternal bicaval put its 66.05 mm clear, and both drew a confident sector with an echo
image under it. *(Corrected 2026-08-22: these two first read 92.6 mm and 66.5 mm, which are
nearest-VERTEX distances — 92.55 mm and 66.51 mm exactly — in an entry whose whole argument is that
vertex distance is the wrong measure. Both figures are now the point-to-TRIANGLE distance this gate
actually computes, re-derived by running the gate's own point-to-triangle code against F1 at
`normal-rodero` v0.1.4, the revision it was withdrawn from, and against
`normal-vhl-heart0102-chambers`/`ingest-reference-pose` as it stands. The correction does not
change the conclusion: both are more than an order of magnitude past the 5 mm tolerance.)* Nothing in the repository checked the most basic fact about transthoracic
echocardiography: **ultrasound does not cross an air gap.** A transducer not in contact with skin
images nothing, so a pose whose origin is off the body is not a poor view — it is not a view.

**`npm run check:probe-on-skin`, and no exception list.** Every view in a canon family (A–F) of a
pack that has a `body-context/v0` registration bound must have its probe origin within 5 mm of the
reference chest's skin. It is point-to-TRIANGLE distance against the shipped surface, not
point-to-nearest-vertex, and the difference is not cosmetic: the parasternal short axis measures
8.15 mm to the nearest skin VERTEX and **0.07 mm to the skin**. A vertex test would have failed
correct poses and taught us nothing. Of the fourteen surviving canon views, thirteen sit under
0.1 mm from the surface and the widest is 3.16 mm — an aperture `migrate_apertures.py` slid onto the
wall along its own beam. The tolerance is 5 mm because that is what the evidence needs, not what
would be comfortable.

**The INGEST family is out of scope by definition, not by exemption.** An ingest reference pose is
derived from a pack's own bounding sphere, says in its name that it is not a clinical view, exists
only because schema v0.1 requires a pack with an `echo_volume` to carry at least one view, and is
the anchor for the ingest replay in `tests/unit/authoringIngest.test.ts`. It makes no claim to a
transthoracic window, so a rule about windows does not reach it. Writing it into an exception list
instead would have been the beginning of a list, and the point of a hard check is that it has none.

**F1 is withdrawn.** `f1-right-parasternal-bicaval` was hand-authored in the authoring tool from the
canon rather than derived from this mesh, and it could not be rebuilt: `normal-rodero` has no
separately tagged cavae, so there is no measured bicaval plane on this substrate to place a window
on. Entry 65 had already found that reaching the skin needed a 73.7 mm retreat and a 22.19 cm
imaging depth, and concluded the plane itself needed reauthoring. Under a hard contact rule there is
no third option, so the pack is v0.1.5 with nine views and F1 is gone from it. Its authoring slot,
its review-session evidence and its canon entry all remain, so reauthoring it is picking the work
back up rather than starting over.

**And the two builds stop pretending to be one.** *(Owner decision.)* The learner build is
**archived** and the authoring build is the only active surface until the owner is satisfied with
it. This is the same idiom the phone/touch workstream already uses: paused, not deleted, and not
unguarded — `check:published-packs` and `check:authoring-absent` are licence and exposure controls
and keep gating, because they protect something other than product quality. What stops is
developing, polishing and iterating against the learner surface.

The distinction earns itself immediately. An off-skin probe pose is a perfectly reasonable
work-in-progress in an authoring tool, where the whole job is moving a transducer around until it is
right. It is never acceptable in front of a learner, who has no way to know that the picture is of
nothing. Conflating the two is what let one reach a learner-facing panel, and it is why the check
above exists rather than a note asking someone to be careful.
