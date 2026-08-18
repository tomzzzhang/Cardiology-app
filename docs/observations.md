# Observations — the visual review list

**Last Updated:** 2026-08-18 12:43 EDT

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

## 2. Tags 11–24 are still unnamed

**Where.** Anatomy panel: fourteen small grey structures around the atria — pulmonary vein stubs,
caval stubs, the left atrial appendage.

**Why it is here.** Adjacency identifies the valve planes because each borders exactly *two*
chambers, which is a unique signature. Every one of tags 11–24 borders exactly *one* chamber
(eight on the left atrium, six on the right), so adjacency cannot tell a right upper pulmonary
vein from a left lower one. Telling those apart needs a clinical reading and they stay generic.

**How to judge it.** Nothing to check — this is a deliberate gap. It is noted so the grey stubs
are not mistaken for a rendering failure.
