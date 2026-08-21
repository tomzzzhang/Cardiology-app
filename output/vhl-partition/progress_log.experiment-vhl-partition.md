# Progress log — branch `experiment/vhl-partition`

**Branch:** `experiment/vhl-partition`
**Branched from `dev` at:** `294751faf124b79693cae99d9335e881189a032c`
**Last Updated:** 2026-08-21 01:10 EDT

Branch log. Interleave these entries by timestamp into the planning folder's
`progress_log.md` at merge, then delete this file.

Newest first.

---

## 2026-08-21 01:10 ET — session closed for length; handoff written, round-two seeds pending

**State.** Work paused mid-task by choice, not by failure. The observer has placed a
second seed round — the same chamber seeds plus a coat of "not lumen" barrier marks
over the outside of the heart — and it is pending paste into the next session. Nothing
else blocks.

**What changed this entry.** The flood and frame code had been living in throwaway
scripts, which would have forced a rewrite. It is now `pipeline/vhl_seed_partition.py`
and reproduces the round-one numbers exactly, so the next session runs one command
instead of reconstructing an afternoon. `output/vhl-partition/HANDOFF.md` carries the
resume instructions, the open problem, the gate requirements, and a list of the
mistakes this branch made so they are not repeated.

**Next step is one command,** given in HANDOFF.md: run `vhl_seed_partition.py` against
the round-two seeds. The single number that decides it is the right ventricle, 238 mL
on round one against an expected 60-100 because the label wrapped the whole organ. If
the barrier marks bring it into range the partition is done and the anatomy gates
become runnable for the first time on this branch.

**If it still leaks, do not tune the flood again.** Four variants have been tried and
the reason none can work is recorded: the bogus pockets the sealing envelope bridges
are as wide as the valve orifices it must seal, so no radius separates them. The fix
is upstream — define chamber space by ray parity against a smoothed epicardial surface
instead of a morphological envelope.

**Owed and not written:** a proposed delta for `pack.json`'s orientation block. The
declared orientation is measurably wrong by 37.6, 77.9 and 65.3 degrees and that is
the most consequential finding on this branch, but no proposal has been drafted for
it yet. The four existing deltas in `sources.proposed.md` remain unapplied.

**Environment note for the next session.** `~/Downloads` and `~/Library/CloudStorage`
are blocked by macOS privacy protection for the agent process regardless of sandbox
settings; `/tmp` and the repo work. Ask for a paste or a copy into `/tmp`.

## 2026-08-21 00:30 ET — human seeding lands; orientation SETTLED, partition still blocked

**State.** One observer placed 27 seeds in the 3D labeller, covering five of six
tags. All 27 land in cavity. This is the first result on this branch that came from
a person rather than an algorithm, and it immediately produced the thing four
automatic methods could not.

**Orientation is now measured, and the declared one is wrong.** The tool never asks
which way is patient-left; chambers are named and the frame is derived from where
they sit. Derived patient-left is 37.6 deg off the declared +x, base/superior is
77.9 deg off +y, anterior is 65.3 deg off +z. The model is not axis-aligned to
anatomy at all. Internal coherence is strong and independent: the raw left-right and
base axes come out 89.4 deg apart unforced, LA is 42.3 mm posterior to RA, the aorta
is 48.2 mm basal to the ventricles. Source and shipped glTF bounding boxes agree to
0.1 mm in the same axis order, so ingest applied no rotation and the frame carries to
the pack directly. Proposed delta to follow for pack.json's orientation block.

**Partition: four tags plausible, RV badly wrong.** LV 86.6 mL, RA 22.8, aorta 15.3
are anatomically shaped and correctly sized for a 14-year-old. LA 55.8 is high. RV
comes out at 257 mL with a bounding extent of essentially the whole heart.

**Cause is this branch's cavity definition, not the seeds.** `envelope AND NOT
tissue` includes the film between the true epicardium and the morphological
envelope, plus the trabecular interstices. Both are connected sheets wrapping the
organ, so the first label to touch one inherits all of it, and the RV seeds are the
most peripheral. Three flood variants were tried — plain geodesic BFS, priority
watershed on the distance transform, and Dijkstra with a narrowness penalty — giving
238, 279 and 257 mL. None fixes it because none can: no flood weighting repairs a
mask that contains the wrong space. Eroding the film out instead disconnects the
lumen and strands 14 of 27 seeds.

**Next step, and it is upstream of everything.** Define chamber space against a
proper epicardial surface — ray parity against a smoothed epicardial mesh — rather
than a morphological envelope that bridges the AV groove and the gaps between
vessels. Every downstream number on this branch inherits that definition.

**Observer notes, both confirmed.** The pulmonary artery stub is too short to seed.
The AV valves are modelled open, so atrium and ventricle are one connected space with
no neck to cut at — the same blocker §5b.3 found from the automatic side, and the
likely explanation for LA reading high.

**A retraction.** An earlier check in this session, "RV anterior to LV", was reported
as passing. It is circular: the frame's left-right axis is built from the LV-RV
difference, so those centroids cannot differ along the perpendicular. It measured
nothing and is withdrawn in NOTES.md §5c.1.

## 2026-08-20 23:05 EDT — Rodero tried as label donor; two variants disagree on which lobe is the LV

**State.** Fourth identification route, and the best-motivated one: `normal-rodero` is tagged
MYOCARDIUM with a ready-made labelled 192^3 volume whose structures map onto tags 1-10 exactly,
so registration is tissue-against-tissue rather than lumen-against-cast. It also carries the
LV:RV wall asymmetry (135.4 vs 52.4 mL, 2.6:1) that VHL itself does not exhibit, so a correct
pose would transfer exactly what §5b.2 could not measure.

**Result: still not usable, and now for a demonstrable reason.** Registering on tissue gives
Dice 0.398 with margin 0.094 — four times the bodyparts3d margin, still under the 0.10 threshold.
Registering on the epicardial envelope gives Dice 0.771 with margin 0.012. The two variants pick
OPPOSITE left-right assignments. Absolute fit and discriminative power trade off directly: smoothing the
target to fit better erases the asymmetry that distinguishes left from right. This is positive
evidence the pose is undetermined by shape overlap, not a tuning problem.

**Rendered anyway, as labelled evidence.** `label-transfer-UNVERIFIED.png` shows Rodero in its
real tags beside VHL wearing transferred ones. Committed because it is useful for judging
plausibility, named UNVERIFIED because the left-right assignment may be swapped.

**3D preview added.** `heart-3d.png` — exterior plus cutaway with the recovered chamber space
coloured. Renderer lives in `vhl_partition.preview_3d` so the image is reproducible rather than
an orphan artefact. Worth noting what it shows: the exterior looks like an entirely ordinary
heart from every angle, which is why this source's defect survived to ingest before anyone
noticed there were no chambers in it.

**Recommendation unchanged and now better supported.** Four human-placed watershed markers remain
first. Four automatic identification routes have now failed, three of them on telling left from
right. A
single human click carries the one bit that none of them could recover.

## 2026-08-20 22:50 EDT — identification is the real blocker; all three automatic routes fail

**State.** Follow-on to the 22:25 entry, same branch. The splitting result stands. Three
independent routes to NAMING the lobes were tried; all three fail, and they fail for one shared
reason that reframes the problem.

**Route 1, donor registration.** `anatomy-bodyparts3d-heart` is a much better donor than the
handoff brief describes — 119 structures including a 1:1 cover of tags 1-6 as labelled lumen
casts, plus ventricular free walls and valve leaflets. The brief's "lacks ventricular myocardium
and models lumen as solid casts" is wrong on the first count, and the casts are an advantage
rather than a limitation, since lumen is exactly what this experiment recovers. It fails on POSE,
not content: all four proper-rotation starts converge under ICP to within 0.05 Dice (best 0.547,
margin 0.022), which cannot separate the pose putting the donor LV on the VHL LV from the one
putting it on the RV. Not
used. Proposed delta 4 written to correct the donor's characterisation.

**Route 2, wall thickness.** No contrast on this model — identical medians and maxima for both
lobes, p90 differing by 0.31 mm in the wrong direction. Verified the ~3:1 expectation is correct
for a 14-year-old (RV:LV proportions plateau by ~0.5 m² BSA) before accepting the negative, so
this is a property of the model rather than a wrong pediatric baseline.

**Route 3, cross-sectional circularity.** Inconclusive, 0.59 vs 0.71 with neither near circular.

**The shared cause, which is the actual finding.** Every identification signature — donor
overlap, wall thickness, cross-sectional shape — is a property of an INDIVIDUAL chamber. The
lobes available to measure are 274 mL and 151 mL, each a union of a ventricle with an atrium and
great-vessel lumen merged through the open orifices. No per-chamber signature survives being
measured across a union. **The merge is upstream of all three failures**, so splitting and
identification are not separable problems to be attacked in either order.

**Next step changed as a result.** Previously "better donor registration". Now: **four human
clicks as watershed markers** — one inside each of LV, RV, LA, RA on a handful of slices. A
marker is simultaneously a seed and a label, so it breaks the merge, the identification and the
left-right assignment at once, needing no registration, no orientation and no thickness contrast. Minutes of
work against an open-ended automatic search. The cost is provenance: labels become "seeded by
hand", acceptable for one non-published evidence pack and not for a repeatable multi-source
pipeline. Donor registration drops to third, useful mainly as a check against a hand-seeded
result rather than as a primary route.

**Method note worth keeping.** Both errors in the 22:25 entry, and the reframing above, came
from LOOKING at cross-sections rather than from any metric. Numbers agreed with each wrong answer
at every step. The renders are committed for that reason.

**Gates unchanged.** `npm run check:fast` green, exit 0. `anatomy.py` frame and valve checks
still correctly not run — no partition emitted, and nothing here changes that.

## 2026-08-20 22:25 EDT — VHL heart0102 partition experiment: debris solved, partition partial

**State.** Exploratory unit on whether the two defects behind the 2026-08-19 rejection of
`normal-vhl-heart0102` are solvable. Debris: solved. Per-chamber partition: not delivered,
but the pessimistic reading of the rejection is wrong and the reason is now measured.

**What the debris turned out to be.** The rejection's 1,026 connected components reproduce
exactly on the source STL using the repository's own `geometry.component_count`. 1,025 of the
1,026 enclose *negative* signed volume — they are bubbles inside the tissue, not floating
islands. A volume threshold separates them with a 4,986× margin and nothing in between across
three orders of magnitude, so the cut is not tuned. Cleaning costs 2.63% of triangles and
0.155% of volume, and yields a watertight single-component mesh. **This defect is not a real
obstacle.**

**What the chambers turned out to be.** They are present, as ~425 mL of open lumen at a
17.75 mm largest inscribed sphere — the right scale for a 14-year-old LV. They are *not*
enclosed cavities: every valve orifice is modelled open, so the chamber space is continuous
with the outside and plain connected-component analysis finds nothing. Distance-transform
seeding splits the lumen into two stable ventricle-scale lobes and no further, because the
atrioventricular orifices are wide open and there is no neck at which an atrium separates from
its ventricle.

**Two wrong answers on the way, both recorded in NOTES.md §3.** A 5 mm closing said the
chambers were packed solid with a 4.6 mm inscribed sphere — plausible, and it survived a 2×
resolution check. It was an artefact of the seal radius. Raising the radius while still using a
closing is also wrong, structurally: a closing fills gaps *smaller* than its ball, so no radius
encloses a ventricle. The fix is dilate → fill-holes → erode. Both errors were caught by
rendering a cross-section, not by any number, which is why the render is now part of the module.

**Blocker for the six-tag partition.** Not compute and not data quality — the missing piece is
valve cut planes. Atrium/ventricle separation needs a plane, not a distance maximum. Two
sub-blockers behind it: nearest-core assignment is a Voronoi that walks through the septum
(a geodesic watershed is needed, and `skimage` is not in `environment.yml`), and no anatomical
frame has been derived, so the regions found are unidentified.

**Gates.** `npm run check:fast` green, exit 0 — 28 test files, 616 passed, 2 skipped. The
`anatomy.py` frame and valve checks were **not** run, correctly: the brief gates them on a
partition being produced and none was. NOTES.md §6 records what those gates will additionally
need (valve-plane tags 7–10, a `Z` apicobasal field, a `TetMesh`) and flags that a `Z` field
derived from one's own partition makes the apex check partly circular.

**Decision unchanged.** The 2026-08-19 rejection is **not** reversed and nothing in the
repository was edited to soften it. Two of its three legs are untouched: CC BY-NC 4.0 licence,
and unverified orientation. A successful partition would remove one objection out of three.

**Next step, if resumed.** In order: (1) geodesic watershed confined to the cavity, ~40 lines
of priority-flood, to split LV from RV respecting the septum; (2) valve annulus fitting for the
AV planes — `anatomy-bodyparts3d-heart` models lumen as solid casts, useless as a myocardial
label donor but the right shape to register a valve plane against; (3) only then the tet mesh,
valve tags, and the nine anatomy checks. If the substrate question is live, a permissively
licensed source with per-chamber structures already modelled is likely a better use of the same
effort.

**Provenance gap found in passing.** The VHL source STL is absent from
`pipeline/.cache/checksums.json`, unlike every other source, and appears to have been acquired
outside `fetch.py` — plausible since Sketchfab requires an authenticated download. Recorded,
not fixed. Proposed delta written to `output/vhl-partition/sources.proposed.md`.
