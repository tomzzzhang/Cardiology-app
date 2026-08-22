# Chamber labeller and review viewer

**Last Updated:** 2026-08-22 10:33 EDT

A browser tool for putting chamber labels on a heart model that does not carry
them, and for looking at the result honestly. Built on `experiment/vhl-partition`
against `normal-vhl-heart0102`; nothing in it is specific to that source.

It exists because every automatic route to naming a chamber failed on that model
— donor registration is a coin flip at a 0.02 Dice margin, the LV/RV wall
thickness contrast the geometric discriminator needs is absent, and
cross-sectional shape is diluted across merged chambers. A person looking at a
four-chamber view identifies them in seconds. See `output/vhl-partition/NOTES.md`
§5b for the evidence, and the branch progress log for what each mode was built to
fix.

## What it does

| Mode | Marks | Consumed by |
|---|---|---|
| Label voxels | a chamber tag on the cut face | `vhl_seed_partition` |
| Trace rim | points around a valve orifice | `vhl_annulus`, `vhl_valve_plane` |
| Paint the wall | groove strokes and region points on the EPIcardium | `vhl_wall_paint` |
| Paint the inner surface | boundary strokes and region points on the ENDOcardium | (consumer not yet written) |

Grooves and boundaries are barriers, region points are seeds, and the flood runs
over one surface only. Three region points around a Y junction name three
territories; nothing special is needed for that.

Tags are `anatomy.py`'s own numbers — 1-6 chambers, 7-10 valve rings, 11-24 the
veins, stubs and appendage — so anything marked here can be handed to it
unchanged. `vhl_tags` is the vocabulary.

## Running it

```bash
python pipeline/labeller/export.py \
  --grid <grid.npz> --tissue <tissue.npz> \
  --lumen <lumen-labels.npz> --wall <wall-labels.npz> \
  --frame <seed-partition.json> --chamber-space <mask.npz> \
  --volumes <seed-partition-round6.json> --out <dir>
python pipeline/labeller/serve.py <dir> 8777
```

Then `http://127.0.0.1:8777`. Use the numeric address, not `localhost`: a stale
server bound on the other IP stack has silently served old data here before.

`export.py` copies `viewer.html` and three.js from `node_modules` into the output
directory, so `npm ci` has to have run. three is NOT vendored — a second copy in
Git would drift from the pinned one.

## Things that cost real time

* **Re-export after ANY change to the labels.** The viewer reads the exported
  files and nothing else, so a stale export is indistinguishable from a labelling
  bug. That mistake has been made twice.
* **Marks come back in CARDIAC coordinates**, because the viewer raycasts posed
  meshes. Map them with `ROT.T` before touching the voxel grid. Getting this
  wrong produced a whole round of plausible, wrong numbers.
* **Marks are DOTS, roughly a brush-width apart.** Join them into curves before
  using them as a barrier — dilating dots leaves gaps the flood walks straight
  through. Split strokes at an 8 mm gap: within a drag the marks sit ~2.9 mm
  apart, while the jump between strokes is 18.7 mm at p95.
* **Serve with caching off.** `serve.py` sends `no-store` for this reason.
* A blank canvas with the backing store stuck at 600x300 means `setSize` never
  ran, whatever the console says.

## What it is not

Not a pipeline stage. Its output is a handful of small JSON files of human marks,
and any labelling built from them carries "seeded by hand on N marks by one
observer" as its provenance, not "derived". That is an acceptable trade for one
evidence pack and not for a repeatable multi-source pipeline.
