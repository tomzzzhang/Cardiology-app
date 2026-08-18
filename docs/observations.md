# Observations — the visual review list

**Last Updated:** 2026-08-18 13:20 EDT

Not a changelog. This is the list of things worth *looking at*, written for whoever opens the app
next with the intent of judging it. Each entry says what to look at, why there was uncertainty,
how to tell whether it is right, and where in the UI to see it.

Anything guessed at, anything that looked plausible but is unverified, and anything traded off
belongs here. The changelog lives in the planning folder's `progress_log.md`.

---

## 1. The four valve rings now have names, and colours

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

## 2. The echo was sampling a transposed heart — and that was the real defect

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

## 3. Echo tuning: before and after

**Where.** Echo panel, apical four-chamber, sweep parked at 0°.

**Measured with** `npm run measure:echo` (against a built `dist/` on `http://127.0.0.1:4173`),
which marches the shader's own rays, reads the label the pack carries at each depth, and reads the
displayed grey at the screen pixel that depth lands on.

| | before | after |
| --- | --- | --- |
| blood / background, mean grey | 0.07 (median **0**) | 0.11 (median 0.04) |
| LV myocardium, mean grey | 0.70 | 0.53 |
| valve ring, mean grey | 0.94 | 0.59–0.90 |
| rim vs core brightness across a wall | 0.97 | 1.21 |
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

**Unverified / taste.** `scatter: 0.1`, `dynamicRangeDb: 60`, `tgcDb: 8` and `reject: 0.0008` are
chosen to land the three levels where the table above says, not measured against a real scanner.
The grey a real pediatric machine puts on myocardium at these settings is a question for the
imaging attending, and `echo_tuning` per view exists precisely so the answer can be authored.

---

## 4. Display orientation: the renderer was honouring `display.vertex` backwards

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

## 5. The model turns all the way over now

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

## 6. Tags 11–24 are still unnamed

**Where.** Anatomy panel: fourteen small grey structures around the atria — pulmonary vein stubs,
caval stubs, the left atrial appendage.

**Why it is here.** Adjacency identifies the valve planes because each borders exactly *two*
chambers, which is a unique signature. Every one of tags 11–24 borders exactly *one* chamber
(eight on the left atrium, six on the right), so adjacency cannot tell a right upper pulmonary
vein from a left lower one. Telling those apart needs a clinical reading and they stay generic.

**How to judge it.** Nothing to check — this is a deliberate gap. It is noted so the grey stubs
are not mistaken for a rendering failure.
