# Handoff — `experiment/vhl-partition`

**Last Updated:** 2026-08-21 15:49 ET
**Branch:** `experiment/vhl-partition`, cut from `dev` at `294751faf124b79693cae99d9335e881189a032c`

Read `NOTES.md` for evidence and `progress_log.experiment-vhl-partition.md` for state.
This file is only "what to do next, and how".

---

## READ THIS FIRST: nothing is committed, and it lives in /tmp

Every change from the 2026-08-21 sessions is **uncommitted** in a clone under
`/private/tmp/...`, which macOS clears on reboot. The clone also holds the source
STL and about 150 MB of scratch render data that must NOT be committed.

**Recover by committing the working tree of that clone, or by re-running the
pipeline from the seed files, which ARE the durable input.** The seeds are small,
they are in `output/vhl-partition/`, and everything else is derived from them.

## Where the partition got to

Six chambers, all single connected components, both septa intact.

| tag | mL | expected | note |
|---|---|---|---|
| LV | 81.0 | 60-100 | in range |
| RV | 138.0 | 60-100 | high |
| LA | 38.2 | 25-45 | in range |
| RA | 85.4 | 25-45 | high, see below |
| aorta | 11.6 | 15-25 | short stub |
| PA | 20.7 | 15-25 | in range |

Per-chamber MYOCARDIUM is also labelled now (`wall-labels.npz`), so the heart
renders as a labelled organ from outside the way `normal-rodero` does.

**The owner's stated purpose is orientation and eventual placement in a mock
body, and for that the chamber set is adequate.** The two open items below are
recorded as known, not as blockers.

## The inputs, in the order they were placed

1. `seeds.observer-A.json` — round one, 27 chamber seeds.
2. `seeds.observer-A-round2.merged.json` — plus 553 "not lumen" marks on the
   epicardial surface. These define the chamber-space mask by line of sight.
3. `seeds.observer-A-round3.json` — 6,594 corrections. **The old "RA" was the
   pulmonary artery in its entirety, 99% of it.**
4. `seeds.observer-A-round4.json` — 4,361 further corrections.
5. `valve-rims.observer-A.json` — the tricuspid and mitral annuli, traced.

**For tag-99 marks use `model_point_mm`, never `voxel`.** `vhl_label_tool_3d`
searches up to ten grid steps for a CAVITY voxel, which for a mark clicked on the
outside of the heart lands on the far side of the wall - displacing it by up to
13.56 mm. Chamber seeds are unaffected.

**Traced rims are in CARDIAC coordinates**, not model. The viewer raycasts posed
meshes. Map with `ROT.T` before touching voxels. Getting this wrong cost a whole
round and produced numbers that looked plausible.

## Two open items, both understood

* **RA at 85.4 mL** almost certainly carries the caval stubs and the atrial
  appendage. Tags 16, 17 and 11 are wired into the viewer and unused. Tagging them
  is the single highest-value thing left.
* **The RA-RV interface is 6,262 mm2** against about 1,000-1,200 for a tricuspid
  annulus. It is not at the annulus: median 12.6 mm away, 29% beyond the disc
  radius. No plane fixes it; it is most likely the same caval/appendage lumen.

## What NOT to redo

* Four flood variants, all failed, reasons in NOTES §5c.2.
* Six mask definitions; occlusion from the epicardial marks won. NOTES §5d.4.
* An "Ebstein" apicobasal bound on the RA — **withdrawn**, the annulus is oblique.
* An automatic annulus refinement — it undershoots (934 vs 1405 mm2 traced).
* Boundary-edge counting on a sub-block as a mesh-quality proxy: worthless, the
  block cuts the heart.

## The wall boundaries are drawn (round six)

`wall-paint.observer-A.json` holds 375 groove marks and 1,076 region points;
`pipeline/vhl_wall_paint.py` turns them into `wall-labels.npz`. 0.14% of the
epicardium was left unreached, so the grooves close well enough.

**The left-atrial wall includes the pulmonary veins on purpose** - too many to
resolve on this model and topologically continuous with the atrium. That is why
it reads 75.6 mL. Do not "fix" it.

## Superseded: the wall boundaries WERE inferred

Assigning wall to the nearest labelled cavity gives ragged, patchy territories,
because the nearest cavity is not what bounds a chamber on the OUTSIDE - the
atrioventricular and interventricular grooves are, and on this specimen they are
plainly visible. The observer is drawing them.

The viewer has a **Paint the wall** section: `Draw groove` lays a barrier stroke
along a groove, `Name region` puts a chamber tag inside one. Export writes
`wall-paint.json` in CARDIAC coordinates.

`pipeline/vhl_wall_paint.py` consumes it: a seeded watershed over the epicardial
SURFACE, blocked by the grooves, after which the wall beneath inherits from the
surface above it. Confining the flood to the surface is the whole trick - two
points either side of a groove are millimetres apart in space but far apart across
the surface, which is what a groove encodes and a distance transform through the
wall cannot see.

Plumbing is smoke-tested end to end with synthetic marks; it has not yet seen a
real one.

## New modules

`vhl_surface_nets.py` (voxels to mesh), `vhl_valve_plane.py` (least-area
separating plane; settles mitral and pulmonary, not tricuspid), `vhl_annulus.py`
(refinement), `vhl_wall_labels.py` (per-chamber myocardium), `vhl_tags.py`
(vocabulary including the vessel stubs, numbered to match `anatomy.py`),
`vhl_wall_paint.py` (grooves drawn on the surface to a wall partition).

## The anatomy gates still cannot run, and should not be faked

Measured, not read: `identify_valve_planes` needs a PA to border the pulmonary
valve, and `derive_cardiac_frame` needs tags 16 and 17 for the cavae. Five
fabrications are required in total, after which **at most two of the nine checks
measure anything**. NOTES §6b has the ladder and the per-check breakdown.

## Deferred, per the brief

Publishing, the loader, echo rendering, authoring UI, and the 2026-08-19
rejection, which stands. Five proposed deltas sit unapplied:
`sources.proposed.md` (four) and `pack-orientation.proposed.md` (the fifth, for
the orientation block - declared axes are wrong by 37.6 / 77.9 / 65.3 degrees).

## Gate

`npm run check:fast` green at every step. `anatomy.py` and `view_candidates.py`
read and called, never modified. Nothing outside `pipeline/` and
`output/vhl-partition/` has been touched.
