# Handoff — `experiment/vhl-partition`

**Last Updated:** 2026-08-21 17:26 ET
**Branch:** `experiment/vhl-partition`, cut from `dev` at `294751faf124b79693cae99d9335e881189a032c`
**Head:** `c93824d` (local commit, NOT pushed)

`NOTES.md` has the evidence, `progress_log.experiment-vhl-partition.md` the
narrative. This file is what to do next.

---

## 1. Recover the state first

The work is committed to `experiment/vhl-partition` in a clone under
`/private/tmp/...`, which macOS clears on reboot. A durable copy sits in
**`~/Downloads/vhl-partition-handoff/`**:

* `vhl-partition-session.bundle` — every commit this session, 2.9 MB
* `seeds/` — every observer input; **these are the real source of truth**
* `labels/` — the current lumen and wall label volumes
* `HANDOFF.md`, `NOTES.md`, `progress_log...md`

To restore:

```bash
git clone https://github.com/tomzzzhang/Cardiology-app.git <dir>
cd <dir> && git checkout experiment/vhl-partition
git bundle verify ~/Downloads/vhl-partition-handoff/vhl-partition-session.bundle
git pull ~/Downloads/vhl-partition-handoff/vhl-partition-session.bundle experiment/vhl-partition
```

Then copy `Heart102_Tissue.stl` into `pipeline/.cache/vhl/` (CC BY-NC, gitignored,
SHA-256 `5843eb96…f41402`) and rebuild the grid. **Nothing has been pushed.**

## 2. Where it got to

Six chambers, each one connected component:

| | LV | RV | LA | RA | aorta | PA |
|---|---|---|---|---|---|---|
| lumen mL | 82.1 | 148.3 | 37.0 | 75.0 | 11.6 | 20.7 |
| expected | 60-100 | 60-100 | 25-45 | 25-45 | 15-25 | 15-25 |

Myocardium is labelled per chamber too, from grooves drawn on the epicardium.

**Resolved, briefly.** Debris (1,025 inward-wound shells) stripped. Chamber space
defined by line-of-sight occlusion from 553 epicardial marks, after six mask
definitions were tried. Chamber identity fixed by 11k observer corrections — the
old "RA" was the pulmonary artery in its entirety. Tricuspid and mitral annuli
traced and cross-validated (planes 10.3 deg apart; each orifice area agrees with a
circle fit to its own points within 10%). Atria forced above their own valve planes.

## 3. The open problem

**The left-atrial wall over-claims: 109.6 mL.** Grooves are now connected into
continuous curves and LV/RV come out clean (11 and 9 components, aorta 2), but LA
wins territory it should not — most likely a groove that is not drawn, or one the
observer said is buried under tissue. **It needs another groove drawn, not another
parameter.** Ask for one and re-run; the loop is about two minutes.

Also open, and fine to leave: RA at 75.0 carries the caval stubs and appendage
(tags 16/17 are wired into the viewer, unused), and the RA-RV interface is ~6,000
mm2 against ~1,100 for a tricuspid annulus.

## 4. Traps that cost real time

* **Tag-99 marks: use `model_point_mm`, never `voxel`.** The labeller displaces
  them up to 13.56 mm by snapping to the nearest cavity — through the wall.
* **Traced rims and painted grooves are in CARDIAC coordinates**, not model. Map
  with `ROT.T`. Getting this wrong produced a whole round of plausible, wrong numbers.
* **Groove marks are DOTS ~2.9 mm apart.** Connect them into curves before using
  them as a barrier; dilating dots leaves gaps the flood walks through. Split
  strokes at an 8 mm gap — between-stroke jumps are 18.7 mm at p95.
* **Re-export the viewer after changing labels.** Twice the owner saw a stale
  render and reasonably assumed a labelling bug.
* **`conda run` buffers all output** unless `--no-capture-output` is passed.
* A blank WebGL canvas with the backing store stuck at 600x300 means `setSize`
  never ran, whatever the console says.

## 5. Do not redo

Four flood variants; six mask definitions (occlusion won); an "Ebstein" apicobasal
bound on the RA (**withdrawn** — the annulus is oblique); automatic annulus
refinement (undershoots, 934 vs 1405 mm2 traced); boundary-edge counting on a
sub-block as a mesh-quality proxy (the block cuts the heart, so it is meaningless).

## 6. Gates and constraints

`npm run check:fast` green throughout. `anatomy.py` and `view_candidates.py` read
and called, never modified. Nothing touched outside `pipeline/` and
`output/vhl-partition/`. The 2026-08-19 rejection stands. Five proposed deltas sit
unapplied, including `pack-orientation.proposed.md` — the declared orientation is
wrong by 37.6 / 77.9 / 65.3 degrees.

**The anatomy gates still cannot run honestly**: they need a PA, an SVC and an IVC
that this source lacks, and after fabricating all five missing inputs at most two
of the nine checks measure anything. NOTES §6b has the ladder.

## 7. The viewer

`vhl-clone/../diag/render/` served on :8777 by `python -m http.server`. Rebuild its
data with `../diag/export_bins.py` and `export_volume.py`. It has: cut plane on any
axis or facing the camera, labelling on the cut face, valve-rim tracing, wall
painting with grooves and regions, and per-chamber wall colour. All of it is
scratch; only the exported JSON matters.
