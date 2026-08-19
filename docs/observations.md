# Observations — the visual review list

**Last Updated:** 2026-08-19 08:55 EDT

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

## 33. There is almost no ventricular muscle in the BodyParts3D heart

**The owner's "why is there no muscle around the ventricles?" — the source genuinely does not have
it.** Not a preprocessing loss; nothing was dropped.

Volumes over the whole 86-part heart:

| | Volume |
| --- | --- |
| Left atrial wall (FJ2438) | 40.5 mL |
| Right atrial wall (FJ2439) | 27.6 mL |
| **All four ventricular wall patches** (FJ2429, FJ2432, FJ2419, FJ2430) | **12.3 mL** |
| Ventricular cavities (FJ2422 + FJ2423) | 215 mL |

A real left ventricular myocardium is 100–150 mL. This atlas carries **12.3 mL of ventricular wall
against 215 mL of ventricular cavity**, in four small patches that are each also labelled as a
papillary muscle or a valve leaflet — the same many-to-many labelling entry 24 records. The atrial
walls are properly modelled; the ventricular myocardium effectively is not.

So the ventricles render as bare lumen casts with papillary muscles and trabeculae hanging inside
them and nothing around them, and that is an accurate rendering of what the source contains.

**This is decisive for one of the deferred tasks.** Grafting BodyParts3D onto the Rodero mesh was
already narrowed to the six semilunar cusps by entry 24. This confirms it: there is no ventricular
myocardium here to graft, and Rodero's — native volumetric tagged tissue — is exactly what
BodyParts3D lacks. The two sources are complementary in the direction the graft was already
pointing, and in no other.

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
