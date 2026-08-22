# Superseded wall-labelling

**Last Updated:** 2026-08-22 14:47 EDT

Kept for provenance, not imported by anything.

* `vhl_wall_labels.py` — a wall voxel took the label of its nearest labelled
  LUMEN voxel, measured straight-line. Superseded twice. The boundaries came out
  ragged, because the nearest cavity is not what bounds a chamber on the outside
  (the atrioventricular and interventricular grooves are), and the straight-line
  distance walks through the septum as though it were not there.

The groove flood that replaced it lives in `vhl_wall_paint.py`, and the surface
it should run on in `vhl_epicardium.py`.
