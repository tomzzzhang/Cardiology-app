# Progress log — branch `experiment/vhl-partition`

**Branch:** `experiment/vhl-partition`
**Branched from `dev` at:** `294751faf124b79693cae99d9335e881189a032c`
**Last Updated:** 2026-08-20 22:25 EDT

Branch log. Interleave these entries by timestamp into the planning folder's
`progress_log.md` at merge, then delete this file.

Newest first.

---

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
