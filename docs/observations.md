# Observations — the visual review list

**Last Updated:** 2026-08-19 05:11 EDT

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
