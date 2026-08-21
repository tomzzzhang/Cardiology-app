# Handoff — `experiment/vhl-partition`

**Last Updated:** 2026-08-21 01:10 EDT
**Branch:** `experiment/vhl-partition`, cut from `dev` at `294751faf124b79693cae99d9335e881189a032c`

Read `NOTES.md` for evidence and `progress_log.experiment-vhl-partition.md` for
state. This file is only "what to do next, and how".

---

## The very first thing

**The owner has a round-two seed file to paste.** It carries the same chamber
seeds plus a coat of `Not lumen` barrier marks over the outside of the heart.
Save it into the branch and run one command:

```bash
# save the pasted JSON as output/vhl-partition/seeds.observer-A-round2.json, then:
conda run -n cardiology-app python pipeline/vhl_seed_partition.py \
  --seeds output/vhl-partition/seeds.observer-A-round2.json \
  --source pipeline/.cache/vhl/Heart102_Tissue.stl
```

That prints the frame, the checks, and a volume per tag against normal ranges
for a 14-year-old, and writes `seed-partition.json`.

**The single number to look at: the RV.** It was 238 mL with the round-one seeds
against an expected 60-100, because the label wrapped the whole organ. If the
barrier marks work it should land in range. If it does, the partition is done
and the anatomy gates below become runnable for the first time.

Note the source STL is **not in the repository** — CC BY-NC 4.0, gitignored. It
sits at `pipeline/.cache/vhl/Heart102_Tissue.stl` in the owner's checkout. It is
not in `checksums.json`; SHA-256
`5843eb9619ff9644c1ded5dd2911d9bbdfd3e5e43c8d622ff753b83272f41402`, 40,177,184 bytes.

**File access:** `~/Downloads` and `~/Library/CloudStorage` are both blocked by
macOS privacy protection for the agent process, sandbox settings notwithstanding.
`/tmp` and the repo work. Ask for a paste or a copy into `/tmp`, not a path in
either of those folders.

## What is already settled

* **Debris: solved.** 1,025 of the 1,026 components are inward-wound bubbles
  inside the tissue, separable by volume with a 4,986x margin, at a cost of
  2.63% of triangles and 0.155% of volume. Cleaned mesh is watertight and single
  component.
* **The orientation: measured, and the declared one is WRONG.** Derived from the
  seeds, it is off the declared axes by 37.6, 77.9 and 65.3 degrees — "up" is
  nearly perpendicular to the true base-apex axis. Source and shipped glTF
  bounding boxes agree to 0.1 mm in the same axis order, so ingest applied no
  rotation and this carries to the pack directly. **A proposed delta for
  `pack.json`'s orientation block has NOT been written yet — write it.**
* **Four chambers already come out clean** from round one: LV, LA, RA and aorta
  are each a single connected component, correctly shaped and placed. See
  `chambers-3d.png`.

## The open problem, in one paragraph

`cavity = epicardial_envelope AND NOT tissue` is not only chamber: it also holds
the film between the true epicardium and the envelope, and the trabecular
interstices, both connected sheets wrapping the organ. First label to touch one
inherits all of it. Four software fixes were tried — plain BFS (238 mL), priority
watershed on the distance transform (279), Dijkstra with a narrowness penalty
(257), and thresholding by clearance (179, still wrapping). None can work,
because the bogus pockets the envelope bridges are **as wide as the valve
orifices it must seal**, so no radius separates them. Hence the barrier marks.

**If round two still leaks**, do not tune the flood again. Fix the mask: define
chamber space by ray parity against a smoothed epicardial *surface* rather than
a morphological envelope that bridges external concavities.

## Then, and only then: the anatomy gates

The brief gates these on a partition existing. Nothing has been run yet because
nothing has been emitted. They need more than tags 1-6:

* `identify_valve_planes` needs **separate valve-plane tags 7-10** and derives
  their identity from which chamber *pair* each borders. It **raises** on
  disagreement with the published Rodero mapping.
* `derive_cardiac_frame` calls `apex_from_uvc`, needing a per-point `Z`
  apicobasal field. The VHL source carries none.
* Both take a `TetMesh`, not a surface.

So: tetrahedralise the tagged voxels, synthesise valve-plane bands at the
chamber interfaces, supply a `Z` field. **A `Z` field derived from one's own
partition makes the apex check partly circular — say so, do not report it as an
independent pass.** Report each of the nine checks individually.

Watch the tag numbering: the barrier label is **99**, deliberately not 7,
because 7-10 are the valve planes and a collision would be silent.

## Things this branch got wrong, so they are not repeated

* **A circular check was reported as passing.** "RV anterior to LV", +0.0 mm. The
  frame's left-right axis is built FROM the LV-RV difference, so those centroids
  cannot differ along the perpendicular. Retracted; deliberately absent from
  `vhl_seed_partition.derive_frame`.
* **"Handedness" and "mirror" were used for a rotation ambiguity**, which reads
  as a claim about the specimen. No reflection occurs anywhere; every candidate
  pose is a proper rotation. Say "which lobe it calls LV".
* **The labeller shipped twice failing blank** — once from an ES module, which
  cannot load from `file://`, and once from a surface-only point cloud that made
  the cut face invisible. It now fails loudly with the error in a banner.
* **A drag-direction test probed a point on the +x axis**, where cosine is even
  and both rotation directions look identical. It passed while the control was
  inverted. Test with a front-facing probe.
* **The barrier label first rejected the clicks it existed for**, refusing any
  point outside the cavity mask — i.e. the outside of the heart.
* **"Not a chamber" was a dangerous name.** The aorta is not a chamber but IS
  tag 5, so an anatomically correct reader would have excluded it. It is "Not
  lumen" now.

## Deferred, per the brief, and not started

Publishing this pack, any change to published packs or the loader, echo
rendering, authoring-mode UI, and reversing the 2026-08-19 rejection. Four
proposed deltas sit in `sources.proposed.md`, unapplied; a fifth for the
orientation is owed.

## One piece of cleanup owed

Commit `37e9211` added `seed-partition-labels.npy` at **54 MB**, which GitHub
warned about on push and which breaches the brief's "keep derived outputs small".
It is removed from the working tree and the module now writes a compressed
`.npz` instead — 685 KB for the same array, since it is almost all zeros over six
distinct values.

**The 54 MB blob is still in this branch's history.** Removing it needs a
history rewrite, and the brief says not to force-push shared history, so the
decision is left to the owner. If this branch is ever merged or kept, drop it
first; if it is abandoned, it costs nothing. Anyone cloning the branch pays the
54 MB either way.

## Files

Tools: `pipeline/vhl_partition.py` (analysis, morphology, renderers),
`vhl_donor_labels.py` (the four failed automatic identifications),
`vhl_label_tool.py` (slice labeller, superseded), `vhl_label_tool_3d.py` (mesh
labeller, current), `vhl_seed_partition.py` (seeds to partition and frame).

Data: `seeds.observer-A.json` is round one, 27 chamber seeds, all landing in
cavity. Round two is what the owner is pasting.

Gate: `npm run check:fast` has been green at every commit on this branch, and
**zero tracked files outside `pipeline/` and `output/vhl-partition/` have been
modified.** `anatomy.py` and `view_candidates.py` were read but never edited.
