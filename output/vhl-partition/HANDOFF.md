# Handoff — `experiment/vhl-partition`

**Last Updated:** 2026-08-22 01:30 ET
**Branch:** `experiment/vhl-partition`, cut from `dev` at `294751faf124b79693cae99d9335e881189a032c`
**Head:** `cb94ff9` (local commits, NOT pushed. Nothing has ever been pushed from this branch.)

Read this first, then `pack-labelled-vhl.proposed.md` if you are landing the model,
or `NOTES.md` and the progress log if you are continuing the labelling.

---

## 1. Recover the state

```bash
git clone https://github.com/tomzzzhang/Cardiology-app.git <dir>
cd <dir>
B="$HOME/Library/CloudStorage/GoogleDrive-tomzzzhang@gmail.com/My Drive/Cardiology app temp/vhl-partition-handoff/vhl-partition-session.bundle"
git bundle verify "$B"
git fetch "$B" 'refs/heads/experiment/vhl-partition:refs/heads/experiment/vhl-partition'
git checkout experiment/vhl-partition
npm ci
```

Then the source mesh, which is **CC BY-NC 4.0, gitignored, and never committed**:

```bash
mkdir -p pipeline/.cache/vhl
cp /Users/yipeng/dev/Cardiology-app/pipeline/.cache/vhl/Heart102_Tissue.stl pipeline/.cache/vhl/
shasum -a 256 pipeline/.cache/vhl/Heart102_Tissue.stl   # 5843eb96…f41402, 40,177,184 bytes
```

Finally the derived arrays, from `labels/` in this folder. They are the session's
working state and none of the large ones are in Git.

## 2. What is in this folder

| | |
|---|---|
| `vhl-partition-session.bundle` | every commit on the branch, 13 MB, head `cb94ff9` |
| `labels/` | the voxel grid and every labelling. **See the table below — two files are superseded and kept only for comparison.** |
| `seeds/` | every observer mark. **These are the real source of truth**; everything else is derived from them |
| `viewer/` | a copy of the labeller. The authoritative copy is `pipeline/labeller/` in the branch |
| `NOTES.md` | technical findings. **Current through §5d only** — §6b is corrected by the progress log, see §5 below |
| `progress_log.experiment-vhl-partition.md` | the narrative, newest first. Current |
| `pack-labelled-vhl.proposed.md` | how to land the model as a pack. Current |

### `labels/`

| file | what | status |
|---|---|---|
| `grid.npz` | 384³ voxel grid: `pitch`, `origin`, `tissue`, `space` | current |
| `tissue-clean.npz` | tissue mask from the DEBRIS-STRIPPED mesh | current |
| `round3-final-mask.npz` | chamber space, after line-of-sight occlusion | current |
| `round6-labels.npz` | **the lumen partition, six chambers** | **current** |
| `wall-labels-current.npz` | **the myocardium partition, six chambers** | **current** |
| `surface-labels.npz` | `outer` and `inner` surface labels | current |
| `discs.json`, `valve-fits.json` | the two traced valve rims and the fitted discs | current |
| `seed-partition-round6.json` | per-chamber lumen volumes | current |
| `round5-labels.npz` | lumen before the atrioventricular divide | superseded, kept for comparison |
| `seed-partition-labels.npz` | round FOUR lumen. This is what is committed in Git | superseded |
| `wall-labels.npz` | the 109.6 mL left-atrial wall, before the epicardium fix | superseded |

## 3. Where it stands

**Six chambers, each one connected component, plus per-chamber myocardium.**

| | LV | RV | LA | RA | Aorta | PA |
|---|---|---|---|---|---|---|
| lumen mL | 82.1 | 148.3 | 37.0 | 75.0 | 11.6 | 20.7 |
| wall mL | 150.0 | 137.3 | 24.9 | 32.3 | 8.8 | 10.8 |
| expected lumen | 60–100 | 60–100 | 25–45 | 25–45 | 15–25 | 15–25 |

The endocardium takes the tag of the lumen it touches and the epicardium comes
from grooves the observer drew; disagreement between the endocardium and the wall
it ends up in is **0 mm² for all six chambers**.

**The cardiac frame is measured**, not declared: patient-left
`[0.792, -0.488, -0.366]`, base `[0.514, 0.210, 0.832]`, anterior
`[-0.329, -0.847, 0.417]` in source coordinates. The pack's declared orientation
is wrong by 37.6 / 77.9 / 65.3 degrees.

## 4. What is still open

* **RV lumen 148.3 mL against 60–100.** One component, survives erosion to 6 mm
  as one piece. Not a mask artefact and not resolved.
* **RA lumen 75.0 mL against 25–45.** Carries the caval stubs and the appendage.
  Tags 16 and 17 exist for the cavae and are unused.
* **No valve-ring geometry.** Tags 7–10 exist (`vhl_tags.VALVES`) and the
  labeller can paint them; nothing has been drawn.
* **LV wall : RV wall = 1.09 : 1**, against 2.6 : 1 for `normal-rodero`. Three
  independent routes agree this model carries no left-right wall asymmetry.
* The atrial endocardium renders about 4% wrong — mesh spacing 0.775 mm against a
  1.34 mm median wall half-thickness. A RENDER artefact; the labels are exact.

## 5. Corrections to NOTES.md

`NOTES.md` was last revised at 2026-08-21 00:30 and is current through §5d. Two
things in it are now wrong, both corrected in the progress log:

* **§5d.5 "the RV is the open question at 216.9 mL"** — superseded. Valve discs
  and the atrioventricular divide brought it to 148.3.
* **§6b "the gates need five fabrications"** — one rung gone. There is now a real
  pulmonary artery at tag 6, 20.7 mL. Still missing: valve rings 7–10, an SVC at
  16, an IVC at 17, and a `Z` apicobasal field. **The recommendation not to run
  the anatomy gates on a fabricated mesh stands.**

## 6. Traps that cost real time

* **Tag-99 marks: use `model_point_mm`, never `voxel`.** The labeller displaces
  them up to 13.56 mm by snapping to the nearest cavity — through the wall.
* **Marks come back in CARDIAC coordinates.** Map with `ROT.T` before touching
  the voxel grid. Getting this wrong produced a whole round of wrong numbers.
* **Marks are DOTS.** Join them into curves before using them as a barrier;
  dilating dots leaves gaps the flood walks through. Split strokes at an 8 mm gap.
* **Re-export the viewer after ANY label change**, and serve with caching off.
  A stale page has twice been mistaken for a labelling bug.
* **Do not smooth or `absorb_thin` across the labelled faces.** This wall's median
  half-thickness is 1.34 mm, so a 1.5 mm strip filter absorbs the atrial layer
  whole and hands it to the chamber on the far side.
* **`conda run` buffers all output** unless `--no-capture-output` is passed.

## 7. Do not redo

Four flood variants; six mask definitions (occlusion won); an "Ebstein"
apicobasal bound on the RA (withdrawn — the annulus is oblique); automatic
annulus refinement (undershoots onto the narrowest local neck); boundary-edge
counting on a sub-block as a mesh-quality proxy; **an infinite half-space at each
valve plane** (withdrawn — it pushes 12.5% of the epicardium off the grooves);
**vertex normals for the wall colour** (worse than the alternative, the surface is
too trabeculated for a stable normal).

## 8. Constraints

`npm run check:fast` green throughout. `anatomy.py` and `view_candidates.py` are
read and called, never modified. Nothing touched outside `pipeline/` and
`output/vhl-partition/`. **The 2026-08-19 rejection stands and this work does not
reverse it** — three of its four grounds are answered for a DERIVED pack, and CC
BY-NC 4.0 is untouched and is the binding one. Never push to `dev` or `main`.
