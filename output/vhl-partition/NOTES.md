# VHL heart0102 partition experiment — technical findings

**Last Updated:** 2026-08-22 07:13 EDT

Branch `experiment/vhl-partition`, cut from `dev` at `294751faf124b79693cae99d9335e881189a032c`.

Scope: test whether the two defects recorded in the 2026-08-19 substrate rejection of
`normal-vhl-heart0102` are solvable. Those defects were (a) 1,026 connected components of
debris and (b) no per-chamber structures.

**Headline: (a) is solvable at negligible cost. (b) is not solved here, but it is not
impossible either — the chambers are present as open space and split cleanly into two
ventricle-scale lobes. A six-tag partition needs valve cut planes this experiment does not
have.** Nothing here reverses the rejection; see the recommendation at the bottom.

---

> **Terminology note.** Earlier drafts of this document said "handedness" and "mirror". Both were
> borrowed from linear algebra and both are actively misleading here, because they read as claims
> about the specimen. They are not. **No reflection is involved anywhere in this work**: every
> candidate pose is a proper rotation, forced to determinant +1 in the PCA starts and again by the
> Kabsch correction inside ICP. The specimen is an ordinary heart and nothing measured here
> suggests dextrocardia or situs inversus.
>
> The real ambiguity is that a roughly half-turn rotation about the long axis lands the donor's
> left ventricle on the subject's right ventricle. The geometry stays a normal heart throughout;
> only which chamber receives which LABEL changes. And the open question about this pack's
> `orientation` is a question about **which direction in the FILE is patient-left**, not about the
> patient's anatomy.


## 1. Source and provenance

Measurements are taken on the **source STL**, not the shipped pack. The pack ships a decimated
mesh, and decimation changes every number in this section.

| | source `Heart102_Tissue.stl` | shipped pack `model.gltf` |
|---|---|---|
| triangles | 803,542 | 219,998 |
| vertices | 401,569 | 108,513 |
| connected components | **1,026** | 343 |
| boundary edges | 0 | 0 |
| non-manifold edges | 0 | 472 |
| watertight | yes | no |

The rejection note's figure of 1,026 reproduces **exactly** on the source, using the
repository's own `geometry.component_count` (faces are nodes, a shared *edge* is a link). The
shipped pack's 343 is the same mesh after decimation. Both are correct; they are not the same
measurement, and quoting 343 against the rejection would be comparing different objects.

- Source SHA-256 `5843eb9619ff9644c1ded5dd2911d9bbdfd3e5e43c8d622ff753b83272f41402`, 40,177,184 bytes.
- The source is **not** in `checksums.json` — every other source is. It appears to have been
  acquired outside `fetch.py`, which is plausible given Sketchfab requires an authenticated
  download. Flagged as a provenance gap, not fixed here.
- The STL is CC BY-NC 4.0 and stays out of Git. Only derived measurements are committed.

## 2. Debris — solvable, and cheaply

Signed volume per component, via the divergence theorem. The **sign is the finding**:

- **1 component encloses positive volume** (the outer shell, 364,116 mm³).
- **1,025 components enclose negative volume.** They are inward-wound shells — bubbles *inside*
  the tissue, not islands floating outside it. A triangle count cannot see this distinction.

| |volume| band (mm³) | components | triangles | total |vol| (mm³) |
|---|---|---|---|
| 0 – 1e-6 | 148 | 1,184 | 0.000 |
| 1e-6 – 1e-3 | 311 | 2,506 | 0.060 |
| 1e-3 – 0.01 | 111 | 882 | 0.397 |
| 0.01 – 0.1 | 203 | 1,840 | 9.606 |
| 0.1 – 1 | 158 | 3,754 | 67.299 |
| 1 – 10 | 85 | 6,502 | 223.299 |
| 10 – 100 | 9 | 4,438 | 265.764 |
| **> 1000** | **1** | **782,436** | **364,116.176** |

**A volume threshold separates them trivially.** The largest component is 4,986× the second by
|volume|; there is no populated bin between 100 mm³ and 364,116 mm³. Any threshold in three
orders of magnitude gives the same answer, so the cut is not a tuned parameter.

**Cost of cleaning: 2.63% of triangles, 0.155% of |volume| (566 mm³).** Result: 782,436
triangles, **1 component, watertight, 0 boundary edges, 0 non-manifold edges.**

Written to `cleaned-review.gltf` — decimated to 120,000 triangles so the artefact stays small.
Regenerate the full-resolution cleaned mesh with `--full-resolution-mesh` (~14 MB, not committed).

## 3. Two wrong answers, recorded because both looked right

This is the most useful part of this document. Both errors produced plausible numbers that
survived the obvious checks.

### 3.1 "The chambers are packed solid" — WRONG

Sealing the valve orifices with a **5 mm closing** and measuring the enclosed space gives a
largest inscribed sphere of **4.58 mm** radius. A 14-year-old's LV admits roughly 20 mm
(LVIDd ≈ 44 mm at this age). Conclusion drawn: the chambers are filled with trabeculae and
unrecoverable.

It even passed a resolution check — re-voxelising at 384³ (0.387 mm pitch) gave **4.55 mm**,
and total tissue volume was identical at both resolutions (363.6 mL), so smearing was ruled out.

**It is an artefact of the seal radius.** The valve orifices are 20–25 mm across. A 5 mm ball
never bridges them, so the chamber lumen stays *outside* the envelope and is silently excluded;
what was being measured was the film of interstices between trabeculae.

### 3.2 "Raise the closing radius" — ALSO WRONG

A closing fills gaps **smaller** than its ball and leaves anything wider open, so no radius
makes a closing enclose a ventricle. Push it up and it engulfs the space *around* the heart
before enclosing the space *inside* it. At a 12 mm seal it keeps 268 mL of interstitial film
while dropping **161 mL of real lumen, in four pieces of 13–18 mm inscribed radius** — exactly
the anatomy being searched for.

### 3.3 What actually works

`epicardial_envelope` = dilate by r → `binary_fill_holes` → erode by r. Dilation joins the
orifice lips, the fill makes the heart solid because the lumen is no longer connected to
outside, the erosion returns the boundary to the epicardium.

| seal radius (mm) | largest cavity (mL) |
|---|---|
| 6 | 400 |
| 8 | 416 |
| **10** | **425** |
| 12 | 430 |
| 14 | 447 |
| 16 | 465 |

Flattening between 8 and 12 mm is the signature of the seal closing rather than of more space
appearing. `SEAL_RADIUS_MM = 10.0`.

**Recovered: 425 mL of connected chamber lumen, largest inscribed sphere 17.75 mm** — the
right order for an LV. Both errors were caught by *rendering a cross-section*, not by a number.
The render is in the module for that reason.

**How both errors were reachable:** an operator that quietly measures something other than what
it is named for, reported as a single number with the parameter that produced it left implicit.
`CavityReport` now carries `seal_radius_mm` beside every figure.

## 4. What the model actually is

- **Tissue: 363.6 mL.** Confirmed three ways within 0.3% — ray-parity voxelisation at 192³ and
  384³ (identical), the pack's own `echo-volume.raw` (362.4 mL), and the mesh's signed volume
  (363.5 mL). Zero odd scanlines at every resolution, consistent with a watertight source.
- **Thin-walled and heavily trabeculated.** Median tissue half-thickness 1.34 mm (1.16 mm at
  384³); 68% of tissue is under 2 mm half-thickness. This is what fills the chambers with
  speckle in the renders, and it is genuine geometry, not a voxel artefact.
- **No enclosed voids.** Interior void analysis on the raw tissue finds 855 bubbles totalling
  ~1 mL, largest 0.229 mL. **No chamber is an enclosed cavity**, because every valve orifice is
  modelled open — topologically the tissue is a mug, not a box. This is why plain
  connected-component analysis of the complement finds nothing, and it is the single fact that
  makes this model harder than it looks.

## 5. Partition attempt

Method: `epicardial_envelope` → largest cavity → 2 mm closing on the *cavity* to bridge
trabeculae → distance transform → threshold sweep for chamber-scale cores.

The core sweep is the seed-finding half of a marker watershed: if N chambers are lobes joined
at narrow valve necks, some threshold must cut the necks and leave N cores.

| threshold (mm) | cores | cores > 8 mL | sizes (mL) |
|---|---|---|---|
| 4 | 62 | 2 | 101.5, 43.2 |
| 5 | 23 | 2 | 77.2, 31.9 |
| 6 | 34 | 2 | 61.7, 23.2 |
| 7 | 36 | 2 | 47.9, 10.0 |
| 8 | 31 | 1 | 36.6 |
| 9 | 8 | 1 | 27.3 |

**Two chamber-scale lobes, stable across thresholds 4–7 mm.** Almost certainly the two
ventricles. Four do not appear at any threshold, and the reason is structural rather than a
tuning failure: the atrioventricular orifices are modelled open and wide, so each atrium stays
continuous with its ventricle. No distance maximum separates them, because there is no neck.

Grown back by nearest-core assignment at the auto-selected 8 mm threshold: **3 regions,
273.6 / 84.7 / 67.0 mL**. See `chamber-cores.png`.

**This is not a partition and must not be read as one.** Two reasons:

1. **Nearest-core is Voronoi, not watershed.** It measures straight-line distance, which walks
   through the septum as though it were not there. The boundary it draws is a plane between
   cores, not the muscle that separates them. A geodesic flood confined to the cavity would
   follow the septum; scipy has no such transform and `skimage` is not in `environment.yml`.
   Adding a dependency for an experiment was not justified.
2. **The regions are unidentified.** Nothing here establishes which region is which chamber.
   They are coloured from a neutral palette, deliberately *not* from the anatomy tag colours —
   colouring an unnamed region LV-red is the first step towards believing it is the LV.

The 273.6 mL region is plainly over-large and has swallowed more than one chamber plus the
great-vessel lumens.

## 5b. Identification — both available routes fail

Finding two lobes is not naming them. Two independent routes were tried to decide which lobe
is the left ventricle. **Both fail, for different reasons.** This is the real blocker, not the
splitting.

### 5b.1 Donor registration against `anatomy-bodyparts3d-heart` — ambiguous

The handoff described this pack as lacking ventricular myocardium and modelling lumen as solid
casts, and therefore able to carry at most part of the labels. **That characterisation is wrong
on the first count and backwards on the second.** The pack carries **119** structures, including:

- `cavity-of-left-ventricle` (97.9 mL), `cavity-of-right-ventricle` (117.0 mL),
  `cavity-of-left-atrium` (51.9 mL), `cavity-of-right-atrium` (84.6 mL),
  `ascending-aorta` (21.5 mL), `pulmonary-trunk` (19.2 mL) — all flagged `blood_pool: true`.
  That is a **1:1 cover of tags 1–6.**
- `free-wall-of-left-ventricle`, `free-wall-of-right-ventricle`, `anterior-wall-of-left-ventricle`,
  `wall-of-left-atrium`, `wall-of-right-atrium` — so ventricular myocardium **is** present.
- Valve leaflets and cusps, papillary muscles, coronary tree, `superior-vena-cava`.

And the solid casts are an **advantage**, not a limitation: what this experiment recovers from
VHL is lumen space, and a cast is exactly the shape to match lumen against.

So the donor is right in principle. The registration is what fails.

| initialisation | Dice after ICP | mean NN (mm) | fitted scale |
|---|---|---|---|
| (+1,+1) | 0.5112 | 1.76 | 0.998 |
| (+1,−1) | 0.5020 | 1.73 | 0.997 |
| **(−1,+1)** | **0.5473** | 1.63 | 0.986 |
| (−1,−1) | 0.5252 | 1.68 | 0.986 |

**Best Dice 0.5473, margin over second best 0.0221.** All four proper-rotation starts converge
to within 0.05 Dice of each other. The cavity blob is close enough to an ellipsoid that its
principal axes do not discriminate, and trimmed point-to-point ICP does not break the tie.

**A 2% margin cannot distinguish the pose that puts the donor's LV on the VHL LV from the one
that puts it on the RV.** Labels
transferred on this basis would look entirely plausible and be a coin flip. Not done.

Mean nearest-neighbour distance of 1.63 mm is *not* evidence of a good fit here — the target is
dense, so donor points land near *some* target point regardless of whether the correspondence is
anatomically right. Dice is the honest measure.

Contributing: the donor is an adult, the subject is 14; the VHL cavity (425 mL) includes
pulmonary veins and caval lumen that the six donor casts (392 mL total) do not cover, which caps
achievable Dice below 1 even for a perfect registration.

### 5b.1b Donor registration against `normal-rodero` — better donor, same verdict

Tried after bodyparts3d, and the better idea: Rodero is **tagged myocardium**, not lumen casts,
so registration is tissue-against-tissue rather than cast-against-space. Its `echo-volume.raw`
is already a labelled 192³ volume, and its structures map onto `anatomy.CHAMBER_TAGS` exactly —
`lv-`/`rv-`/`ra-`/`la-myocardium`, `aortic-wall`, `pulmonary-artery-wall` (tags 1-6) plus the
four valve rings (tags 7-10). It also **carries the LV/RV asymmetry that VHL lacks**: LV
myocardium 135.4 mL against RV 52.4 mL, a 2.6:1 ratio, so what §5b.2 could not measure on VHL is
present in the donor and would transfer with a correct pose.

Two variants were run, and the pair of results is the finding:

| registered on | best Dice | margin over 2nd | which lobe it calls LV |
|---|---|---|---|
| tissue (myocardium to myocardium) | 0.398 | **0.094** | (+1, +1) |
| epicardial envelope | **0.771** | 0.012 | (−1, −1) |

**They disagree on which lobe is the LV.** The envelope fits far better and discriminates nothing — it is
a smooth blob, so every pose lands on it. The tissue fits poorly (VHL carries 362 mL of
trabeculated tissue against Rodero's 259 mL of smooth myocardium, so they cannot overlap well)
but retains the most discriminative power of anything tried: margin 0.094, four times
bodyparts3d's 0.022, though still under the 0.10 threshold `MIN_DICE_MARGIN` requires.

Two variants of one method, on one pair of models, choosing **opposite left-right assignments**.
That is not a
weak result to be improved by tuning; it is positive evidence that the pose is undetermined by
shape overlap on this pair, and it explains why: absolute fit and discriminative power trade off
against each other here. Smoothing the target to fit better erases exactly the asymmetry that
would tell left from right.

`label-transfer-UNVERIFIED.png` shows Rodero in its genuine tags beside VHL wearing labels
transferred under the tissue pose (LV 176.1, RV 70.1, LA 45.4, RA 41.7, aorta 22.8, PA 6.3 mL).
It is committed as evidence and named for what it is. **The left-right assignment may be swapped** — the red
region may be the right ventricle — and the region boundaries are the donor's imposed through a
0.398-Dice fit, not boundaries measured on VHL. It must not be read as a partition.

### 5b.2 Wall thickness (LV ≈ 3× RV) — does not discriminate on this model

The orientation-independent discriminator: identify the LV as the lobe with the thicker
surrounding myocardium. Measured at 384³ (0.387 mm pitch) on *compact* myocardium only
(opening at 1.5 mm strips trabeculae, leaving 295.6 mL of 363.6 mL), restricted for each lobe to
the tissue nearer that lobe than the other, so each is judged on its own free wall:

| lobe | cavity (mL) | median | p75 | p90 | p99 | max |
|---|---|---|---|---|---|---|
| core 2 | 59.8 | 1.16 | 1.64 | 2.23 | 3.49 | 4.12 |
| core 11 | 22.0 | 1.16 | 1.78 | 2.54 | 3.67 | 4.12 |

(half-thickness, mm)

**No separation.** Identical medians and identical maxima; the p90 differs by 0.31 mm, and in
the direction *opposite* to the expected reading — the smaller cavity has the marginally thicker
wall. The expected ~3:1 LV:RV ratio (LV 8–12 mm, RV 3–5 mm) appears nowhere: implied full wall
thickness is 4.5 mm and 5.1 mm at p90, and 8.2 mm at maximum, for both.

Most likely cause: so much of this segmentation's wall is trabecular that the compact layer is
thin and roughly uniform everywhere, and the MR segmentation does not resolve compact myocardium
as a distinct layer. Whatever the cause, **this model does not carry the thickness contrast the
method depends on**, so the discriminator is unavailable here even though it is sound in general.

**Checked before accepting this negative: is a ~3:1 ratio the right expectation at 14?** It
would be a bad failure to reject a working method against a wrong pediatric baseline. It is the
right expectation. RV:LV proportions are steeply age-dependent in infancy — a newborn's RV mass
index sits ~20% above adult while its LV is ~30% under-developed, and the RV:LV end-systolic
diameter ratio falls from 0.83 in neonates to 0.55 by 12–24 months — but the decline flattens by
a body surface area of roughly 0.5 m² and is **almost constant thereafter**. A 14-year-old is far
past that plateau, so adult-like proportions apply and the ~3:1 target is correct. The negative
is a property of this model, not of the age of its subject.

The same question applies to the donor in §5b.1, which is an **adult**. At 14 the proportions
transfer; absolute size does not necessarily. Worth noting the direction is unexpected — donor
casts total 392 mL against 425 mL of recovered VHL lumen, so the *child* measures larger. That
is most likely over-recovery on the VHL side (the connected cavity picks up pulmonary venous and
caval lumen that the six donor casts do not model) rather than a real size difference, and it is
a further reason the achievable Dice is capped well below 1.

### 5b.3 Cross-sectional circularity (LV circular, RV crescentic) — contaminated

The third discriminator, and the one that needs neither donor nor wall thickness: the LV cavity
is circular in short axis, the RV is crescentic and wraps it. Measured as the ratio of the two
minor principal axes of each lobe, per slab along its long axis (1.0 = circular):

| lobe | volume | global ratio | per-slab median | p25 / p75 |
|---|---|---|---|---|
| 1 | 274.2 mL | 0.601 | 0.590 | 0.538 / 0.649 |
| 2 | 151.1 mL | 0.697 | 0.705 | 0.650 / 0.747 |

**Inconclusive, and for an instructive reason.** Neither lobe is near 1.0, and the separation is
modest. The cause is not the metric — it is that these lobes are 274 mL and 151 mL, far larger
than any single chamber. Each has an atrium and great-vessel lumen merged into it through the
open orifices, so a per-*chamber* shape signature is measured across a union of chambers and
diluted away.

**This is the same root cause as §5b.1 and §5b.2, not a third independent failure.** Every
identification signature — donor overlap, wall thickness, cross-sectional shape — is a property
of an individual chamber. None survives being measured on a merged union of several. Splitting
and identification are not two separate problems to be attacked in either order: **the merge is
upstream of all of them**, and nothing downstream can be fixed while it stands.

### 5b.4 What would actually work: a human-placed seed

Attempted and abandoned: rendering all four candidate donor poses and choosing between them by
eye (`work/four_poses.png`, not committed). At Dice ≈ 0.5 no pose reads as anatomically right —
donor casts sit partly on tissue in all four — so the eye has nothing clean to prefer.

But the underlying instinct is correct, and this experiment has evidence for it: **the two
errors in §3 were both caught by looking at a cross-section, not by any number.** A reader can
identify a four-chamber view immediately in `cross-sections.png`, and in the tissue-only slices
the left ventricle is recognisable from its own signature — round lumen, thick compact rim,
papillary muscles as isolated islands within the cavity — with no orientation assumed and no
donor required.

The mistake was asking the eye to *rank automatic fits*, when what it is good at is *supplying
the seed*. Concretely, and cheaply:

> Show a handful of slices. Have a person click once inside each of LV, RV, LA and RA. Use those
> four clicks as watershed markers.

That is a couple of minutes of human work, and it breaks the merge, the identification, and the
left-right assignment **simultaneously** — because a marker is both a seed and a label. It needs no
registration, no orientation, no thickness contrast, and none of the three failed signatures.
Nothing else in this document has that property.

It is a human-in-the-loop step and should be recorded as one: the resulting labels would carry
"seeded by hand on N slices" as their provenance, not "derived". For a single non-published
evidence pack that is an acceptable trade; for a repeatable pipeline over many sources it is
not, which is the honest argument against it.

### 5b.5 Consequence

With both routes failing, the three regions in `chamber-cores.png` are coloured from a neutral
palette and remain **unidentified**. No tag in 1–6 is assigned to anything. Assigning them would
mean picking between a coin-flip registration and a non-discriminating measurement, and calling
the result anatomy.


## 5c. Human seeding — the orientation falls out, the partition does not

27 seeds placed by one observer in the 3D labeller (`seeds.observer-A.json`),
covering five of the six tags. **All 27 land in cavity**, which is the first
thing checked and not a given.

### 5c.1 The orientation, settled

The seeds were never asked which way is patient-left; they name chambers, and
the frame is derived from where those chambers turn out to be. The derived axes,
in the model's own coordinates:

| axis | direction | angle from the DECLARED axis |
|---|---|---|
| patient-left | `[ 0.792, -0.488, -0.366]` | 37.6 deg from `+x` |
| base / superior | `[ 0.514, 0.210, 0.832]` | **77.9 deg** from `+y` |
| anterior | `[-0.329, -0.847, 0.417]` | 65.3 deg from `+z` |

**The pack's declared orientation is wrong**, and not marginally: its "up" is
78 degrees from the true base-apex axis. The model is not axis-aligned to anatomy
at all. `pack.json` has always said ORIENTATION UNVERIFIED; it is now measured.
The source STL and the shipped glTF have bounding boxes agreeing to 0.1 mm in
the same axis order, so ingest applied no rotation and this frame carries over
to the pack unchanged.

Supporting evidence that the seeds are internally coherent, none of it used to
build the frame:

- The raw left-right axis (LV to RV) and the raw base axis (ventricles to atria)
  come out **89.4 degrees apart** without being orthogonalised.
- LA is posterior to RA by 42.3 mm — passes, and passes strongly.
- The aorta seed is 48.2 mm basal to the ventricular centroids — passes.
- LV and RV centroids are 45.2 mm apart along the derived left-right axis.

One check FAILS: RA sits 11.4 mm to the patient-LEFT of LA, where normal anatomy
puts it to the right. That axis is the weak one — the interatrial septum is
oblique and the atria genuinely overlap left-to-right, so an 11 mm discrepancy
is within the range where the ordering is not diagnostic. A straight LA/RA label
swap is ruled out by the posterior check, which would have inverted.

**A check that was reported and must be retracted:** "RV anterior to LV" was
scored and passed at +0.0 mm. It is circular. The frame's left-right axis is
built FROM the LV-RV difference, so those two centroids cannot differ along the
perpendicular by construction. It measured nothing.

### 5c.2 The partition: four tags plausible, one badly wrong

Geodesic flood from the seeds through the cavity, so no label can cross the
septum. Volumes against normal ranges for a 14-year-old:

| tag | mL | expected | verdict |
|---|---|---|---|
| LV | 86.6 | 60-100 | plausible |
| RV | **257.1** | 60-100 | **wrong** |
| LA | 55.8 | 25-45 | high |
| RA | 22.8 | 25-45 | plausible |
| aorta | 15.3 | 15-25 | plausible |
| PA | ~0 | 15-25 | no seed |

LV, RA and aorta come out anatomically shaped and correctly sized. **The RV label
wraps the entire organ** — its bounding extent is 101 x 112 x 141 mm, essentially
the whole heart.

**The cause is this experiment's cavity definition, not the seeds.** `cavity =
epicardial_envelope AND NOT tissue` includes two things that are not chamber:
the film between the true epicardial surface and the morphological envelope,
which bridges the AV groove and the gaps between vessels, and the trabecular
interstices. Both are connected sheets running the whole way around the heart,
so whichever label reaches one first inherits everything. The RV seeds are the
most peripheral and the most numerous, so the RV won.

Three flood variants were tried and none fixes it, because none of them can:

1. **Plain BFS** (geodesic, equal step cost): RV 238 mL.
2. **Priority flood by descending clearance**, the textbook watershed on the
   distance transform: RV 279 mL. It also has a specific failure — priority is
   the voxel's ABSOLUTE clearance, so a seed inside a wide chamber sweeps up
   narrow territory before a seed sitting in that narrow structure is ever
   processed. The PA seeds claimed a handful of voxels for this reason.
3. **Dijkstra with cost `1/(clearance + 0.5)`**, making narrow passages
   expensive to traverse: RV 257 mL. A 20x penalty is not enough over a long
   path.

Eroding the film away instead (clearance > 1.5 mm) disconnects the lumen: only
13 of 27 seeds land in the largest remaining piece, and LV, LA and aorta come
out empty.

**No flood weighting repairs a mask that includes the wrong space.** The fix is
upstream: define the chamber space against a proper epicardial surface — ray
parity against a smoothed epicardial mesh — rather than against a morphological
envelope that bridges external concavities.

### 5c.3 Two observations from the observer, both confirmed

- *"Very short pulmonary artery portion"* — confirmed. No PA seed could be
  placed, and the aorta region is itself only 15 mL. The great-vessel stubs on
  this source are short enough that the PA may not be separably present.
- *"The valves between atrium and ventricle are both open, so it might be hard
  to draw the boundary"* — confirmed, and it is the same finding as §5b.3 from
  the automatic side: the AV orifices are modelled open, so atrium and ventricle
  are one connected space with no neck to cut at. LA at 55.8 mL against an
  expected 25-45 is most likely this, the LA label reaching through the open
  mitral orifice.

Two of the observer's nine RV seeds sit at base +56 mm and +47 mm, level with
the aorta seed at +48 mm and the RA centroid at +52 mm, while the other seven
run from +12 down to -42 mm. They are at great-vessel height and are plausibly
RVOT or pulmonary artery rather than RV cavity. **Not retagged** — that is the
observer's call, not this module's.

## 5d. The mask, fixed — six definitions, one answer

Round two of the seeds arrived as 553 marks, all tag 99, clicked on the OUTSIDE
SURFACE of the model. Two things were wrong, one in the data and one in the method.

### 5d.1 The `voxel` field on a barrier mark is corrupt

For the 27 chamber seeds, `voxel` and `model_point_mm` agree to under 0.9 mm. For
the 553 barrier marks they disagree by **p50 2.40 mm, p90 9.62 mm, max 13.56 mm**,
and no affine — not even a full 3x3 with rotation — relates them; the residual stays
near 10 mm.

`model_point_mm` for the barrier marks lands 423 outside the envelope, 124 in the
cavity mask and 6 in tissue: on or just outside the epicardium, where the observer
clicked. `voxel` lands 149 in the cavity, 321 in tissue and 83 outside.

The cause is `vhl_label_tool_3d.classify(point, reach)`, called as
`classify(point, barrier ? 10 : 3)`. For a barrier mark it searches up to 10 steps
of the 128^3 hit grid — 1.162 mm per step, so ~11.6 mm on an axis and ~20 mm into a
corner — outward from the click for a voxel flagged **cavity**, and returns the
first one found. A barrier mark is clicked on the outside of the heart, so the
nearest cavity voxel is frequently on the far side of the wall, INSIDE a chamber.
The tool then permits `kind === 'muscle'`, but only reaches that branch when no
cavity was found within reach, so in practice a mark meaning "not lumen" is
preferentially snapped INTO lumen.

**Use `model_point_mm` for tag 99. The `voxel` field is unusable.** This is the same
mistake as "the barrier label first rejected the clicks it existed for", one layer
down: the tool now accepts the click and then moves it somewhere it does not mean.

### 5d.2 A barrier that competes as a flood label is still a race

Run as delivered — barrier as a sixth flood label — the RV came out **165.6 mL**,
down from 238 but still wrapping at 67 x 94 x 126 mm. Projecting the dropped barrier
seeds onto the nearest cavity voxel brought the RV to 98.5 mL, inside the expected
60-100, and that number was **wrong for the reason this branch has already retracted
one result over**: the barrier then claimed 235.1 mL of the 437.7 mL cavity, of which
**69.1 mL had clearance greater than 3 mm** — space far too wide to be film — in 187
blobs whose largest two were 28.8 mL and 21.9 mL. It had eaten the chambers. A
boundary decided by which label arrives first is not a boundary in either direction.

### 5d.3 The mask that works: line-of-sight occlusion

The owner's rule — *if there is wall between a chamber and a mark, the mark must not
affect that chamber* — is a statement about visibility, and visibility is a per-voxel
property with no race in it:

    a free voxel is OUTSIDE  <=>  an unobstructed straight segment reaches some
                                  tag-99 mark at its model_point_mm
    chamber space = free AND NOT outside

`pipeline/vhl_mask_occlusion.py`. Each voxel is tested against its k nearest marks by
a vectorised fixed-step walk, which can only miss visibility, so the result
over-estimates chamber space and under-estimates the film — the error is signed and
in the safe direction.

It removes **31.7 mL of the 437.7**, of which only **1.74 mL** is wider than 3 mm
(largest such blob 0.62 mL). It removes the film and essentially nothing else.
**0 of 553 marks fall inside the resulting chamber space, and all 27 chamber seeds
are retained.**

| tag | mL | expected | components | bbox mm | inscribed mm |
|---|---|---|---|---|---|
| LV | 89.1 | 60-100 | 1 | 47.6 x 83.3 x 87.9 | 13.8 |
| RV | **216.9** | 60-100 | 1 | 84.4 x 112.0 x 126.3 | 17.3 |
| LA | 43.8 | 25-45 | 1 | 50.4 x 96.5 x 58.5 | 12.8 |
| RA | 37.1 | 25-45 | 1 | 67.0 x 72.8 x 67.8 | 9.9 |
| Aorta | 11.7 | 15-25 | 1 | 24.8 x 26.3 x 56.6 | 8.8 |
| PA | 0.0 | 15-25 | 0 | — | — |

Whole heart for comparison: 110.8 x 122.4 x 148.4 mm.

### 5d.4 Six independent definitions, and what they agree on

Five were built independently against the same seeds and the same flood, plus a sixth
here. Only the mask differs.

| mask | LV | RV | LA | RA | Aorta | marks inside | seeds kept |
|---|---|---|---|---|---|---|---|
| occlusion (line of sight) | 89.1 | 216.9 | 43.8 | 37.1 | 11.7 | **0** | **27/27** |
| rim watershed (epi/endo split) | 89.1 | 211.0 | 39.2 | 35.1 | 12.0 | **0** | 26/27 |
| ray parity (spherical-harmonic fit) | 81.3 | 210.2 | 35.7 | 35.0 | 7.4 | **0** | **27/27** |
| enclosure (solid angle) | 89.1 | 175.9 | 47.3 | 36.6 | 13.3 | 37 | 27/27 |
| SDF from mark normals (Hoppe) | 89.2 | 240.4 | 47.6 | 35.3 | 0.0 | 67 | 26/27 |
| seal shell (balls on marks) | 62.4 | 97.5 | 9.8 | 0.0 | 0.0 | 0 | 10/27 |

Read this table for its agreements, not its winner.

* **The LV is 89.1 mL in four independent methods, to 0.1 mL.** The left ventricle is
  a genuinely closed cavity bounded by real tissue on every side, so every definition
  finds exactly the same space. This is the strongest result on the branch.
* **The RV is 210-217 mL in all three methods that satisfy the containment rule.** It
  is not a mask artefact and not a flood artefact.
* **`enclosure` and `sdfnormals` fail the rule** — 37 and 67 marks fall inside their
  chamber space — and their RV figures should be discarded, not averaged in.
* **`sealshell` fails the opposite way.** A shell radius of 17.25 mm was needed to seal
  the gaps between marks, which is far more than the 2.5 mm 25th-percentile wall
  thickness under a mark, so the shell ate the wall: RA and aorta come out empty and
  only 10 of 27 seeds survive. Its in-range LV and RV are the residue of a destroyed
  partition, not a result. Mark spacing decides this: nearest-neighbour distance among
  the 553 marks reaches 13.7 mm, and no radius both bridges that and spares a 2.5 mm wall.

### 5d.5 The RV is the open question, and it is no longer a mask question

216.9 mL against an expected 60-100, one connected component, and it survives erosion
as a single piece all the way to 6 mm — so it is not several cavities fused through
open orifices in any way a morphological cut could separate.

Three things are measured about it, and they do not resolve to one answer:

* It is **not a wrap**. Casting 1,000 directions from the LV centroid, the first
  labelled thing met is the RV in **25.7%** of them. A right ventricle bordering a left
  across the septum and part of the free wall is exactly that. A label that had escaped
  around the organ would be near 100%. The earlier 3D preview looked like a wrap and was
  a projection artefact of the splat renderer.
* Only **18.9 mL** of it sits above the aortic seed at +48 mm on the base axis, where
  the sealing envelope bridges the gap between the great vessels, and that band has a
  median detour of 5.8 mm — the signature of a false pocket. Removing it leaves 192 mL.
* **The largest inscribed sphere in the whole model, 17.3 mm, is inside the RV label,
  not the LV label, which reaches only 13.8 mm.** In any real heart the left ventricular
  cavity holds the larger sphere. NOTES §1 recorded that 17.75 mm figure as "the right
  scale for a 14-year-old LV". It is not in the LV.

That last point is the one to take to the observer. It does not mean the names are
swapped — an LV of 217 mL is impossible for this donor and the 89.1 mL LV is the right
size and shape — but it does mean **the RV seed set bounds something larger than a right
ventricle**, and the model gives no neck at which to cut it. Nothing here is retagged:
that is the observer's call, as §5c.3 already said of the two RV seeds at great-vessel
height. Dropping those two changes the RV by 12 mL and settles nothing.

### 5d.6 Two adversarial challenges, adjudicated

Each mask was re-measured by an independent agent told to refute it. Two challenges
survived far enough to need settling with new measurements rather than argument.

**Challenge 1: "the RV is a wrapping sheet."** Raised against occlusion, enclosure and
the SDF, on the grounds that the RV bounding box is 76% / 90% / 85% of the whole heart
and its volume-to-bounding-box fill ratio is low.

**Overruled, on the detour field.** Detour is the geodesic distance from the open air
through free space minus the straight-line distance to that same air. Space outside the
organ lies against the air with only the imaginary envelope surface between, so both
distances match and the detour is zero; lumen is separated from air by myocardium, so the
straight line is one wall and the route is in through an orifice. Measured on the 553
marks it reads p50 0.0, p90 0.4, max 5.3 mm — the marks are, correctly, at zero.

Volume by detour band, and the three masks that satisfy the containment rule agree:

| mask | RV mL | < 5 mm | 5-20 | 20-50 | > 50 mm | p50 |
|---|---|---|---|---|---|---|
| occlusion | 216.9 | **6.6** | 20.3 | 61.9 | 128.1 | 60.5 |
| ray parity | 210.2 | **9.1** | 22.1 | 64.1 | 114.8 | 55.2 |
| rim watershed | 211.0 | **10.7** | 19.1 | 58.5 | 122.7 | 59.7 |

Under 5% of the RV sits at outside-the-heart depth, and roughly 60% of it needs more than
50 mm of detour. The LV has **0.0 mL** below 20 mm. A bounding box cannot distinguish a
crescentic right ventricle running from apex to pulmonary trunk from a sheet, and here it
does not: the RV is a large interior cavity, not space outside the organ. This agrees with
the ray test in §5d.5 (first-contact from the LV centroid is RV in 25.7% of directions)
and with the ray-parity agent's own six-ray enclosure audit (202.0 of 210.2 mL enclosed).

**Challenge 2: "the marks are dispensable."** Raised against ray parity by ablation — delete
the fitted surface, apply a 1.5 mm morphological opening to the old 437.7 mL space, keep
the components holding a seed, and the result reproduces.

**Half right, and the important half is wrong.** The opening alone never satisfies the
containment rule at any radius, and it costs left ventricle:

| opening | space mL | LV | RV | marks inside | seeds |
|---|---|---|---|---|---|
| none | 437.7 | 89.1 | 238.1 | 124/553 | 27/27 |
| 0.75 mm | 407.2 | 86.9 | 232.0 | 41/553 | 27/27 |
| 1.0 mm | 398.9 | 85.0 | 228.8 | 29/553 | 27/27 |
| 1.5 mm | 382.3 | 81.3 | 216.7 | 10/553 | 27/27 |
| 2.0 mm | 366.3 | 78.0 | 204.9 | 7/553 | 27/27 |
| **occlusion** | **406.0** | **89.1** | **216.9** | **0/553** | **27/27** |

The no-mark baseline reproduces round one's RV exactly at 238.1 mL, which is a useful check
that nothing else drifted. But the opening trades left ventricle for containment and never
buys containment outright: 7 of 553 marks are still inside at 2.0 mm, by which point the LV
has lost 11 mL it should not have lost. Occlusion reaches the same RV figure, keeps the LV
at 89.1 exactly, and reaches zero. **The spherical-harmonic surface is dispensable; the
observer's marks are not.**

**What neither challenge disturbs.** Every mask, including the no-mark baseline, puts the RV
between 205 and 238 mL. The right ventricle being roughly twice its expected volume is a
property of the seed set and the model, not of any mask, and §5d.5 stands.

## 6. Gates

- **`npm run check:fast`: PASS, exit code 0.** typecheck, lint, and 28 test files —
  616 passed, 2 skipped. No TypeScript, build config, or runtime file was touched, so no
  regression was expected; it was run to confirm, not assumed.
- **`anatomy.py` `derive_cardiac_frame` / `identify_valve_planes`: NOT RUN, correctly.** The
  brief gates these on a partition being produced. None was. Reporting nine checks against a
  three-region Voronoi split of unidentified regions would be reporting noise as evidence.

Recorded for whoever picks this up — the gates need more than tags 1–6:

- `identify_valve_planes` needs **separate valve-plane tags 7–10**, and derives their identity
  from which chamber *pair* each borders. It **raises** on disagreement with the published
  Rodero mapping.
- `derive_cardiac_frame` calls `apex_from_uvc`, needing a per-point `Z` apicobasal field. The
  VHL source carries no UVC.
- Both take a `TetMesh`, not a surface.

So running the gates means tetrahedralising the tagged voxels, synthesising valve-plane bands
at the chamber interfaces, and supplying a `Z` field. **A `Z` field derived from one's own
partition makes the apex check partly circular**, and any future run must say so rather than
report it as an independent pass.


## 6b. What the gates actually refuse — measured, not read

§6 lists valve-plane tags 7-10, a `Z` field and a `TetMesh`. That list is incomplete.
Throwaway `TetMesh`es were built on a shared point lattice carrying exactly the tags a
VHL partition can supply, and `anatomy.py` was CALLED — never modified — to see what it
refuses. The ladder:

| mesh carries | `identify_valve_planes` | `derive_cardiac_frame` |
|---|---|---|
| tags 1-5 only | raises: no tag borders any valve pair | raises, same |
| + valve bands 7, 8, 9 | raises: **no tag borders the pulmonary pair** | raises, same |
| + a synthesised PA (6) and band 10 | OK, all four named | raises: `no 'Z' field` |
| + a `Z` apicobasal field | OK | raises: **`no elements tagged 16`** |
| + synthesised cavae 16 and 17 | OK | runs |

So the gates need **five fabrications**, not three: valve bands 7-10, a pulmonary artery
at tag 6, a superior vena cava at 16, an inferior vena cava at 17, and a `Z` field. The
VHL source carries none of them — the PA stub is too short to seed at all (§5c.3), and
there are no caval stubs to tag.

**After fabricating all five, at most two of the nine checks measure anything.** Taking
them one at a time, against inputs that would have to be invented:

| # | check | status on a fabricated VHL mesh |
|---|---|---|
| 1 | pulmonary valve anterior to aortic valve | meaningless — the pulmonary ring sits on an invented PA |
| 2 | mitral valve left of tricuspid valve | near-circular — the bands sit at the LV/LA and RV/RA interfaces and the left axis is built from LA-RA |
| 3 | **left ventricle left of right ventricle** | **genuine** — the left axis comes from the atria, not the ventricles |
| 4 | aortic valve right of mitral valve | **partly genuine** — rests on the observer's aorta seed, which is not an axis input |
| 5 | left atrium basal to left ventricle | circular — the long axis runs from a `Z`-derived apex to the mean of four invented rings |
| 6 | right atrium basal to right ventricle | circular, same reason |
| 7 | superior vena cava basal to the valve plane | meaningless — invented SVC |
| 8 | inferior vena cava posterior to superior vena cava | meaningless — both invented |
| 9 | apex apical to every valve ring | circular — the apex comes from a `Z` field derived from this partition |

§6 already flagged check 9 as partly circular. It is worse than that: seven of the nine
are circular or meaningless once the missing structures are invented, and **running them
would produce a 9/9 pass that means almost nothing.** That is precisely the failure this
branch retracted in §5c.1.

**Recommendation: do not run the gates on a fabricated mesh.** Report check 3 and, with a
caveat, check 4, or report that the gates are not applicable to this source. A pack that
carries no pulmonary artery and no cavae cannot be validated by a frame that checks both.

## 7. Orientation

Not used, and not resolved. `pack.json` states `ORIENTATION UNVERIFIED`, and the geometry
carries no chamber labels from which anterior and patient-left could be derived. Every method
here is orientation-independent, so nothing above depends on the declared
`+y up / +z anterior / +x patient-left`.

If identification is attempted later, the frame should be *derived*, from asymmetries that do
not presuppose it:

- **LV vs RV by wall thickness** — LV free wall ≈ 3× RV (LV 8–12 mm, RV 3–5 mm in adults; one
  series reports 1.4:1). Use as an **ordinal** test only. Pediatric normative wall-thickness
  data is sparse, so the ordering is trustworthy and an absolute millimetre cut-off is not.
- **Cross-check on shape** — RV is crescentic and wraps the circular LV in short axis. A second
  opinion independent of thickness.
- **Great vessels must be named at the root, not along the vessel.** The aorta and pulmonary
  trunk spiral: the trunk is anterior-left at the base, but the ascending aorta ends up anterior
  distally. A naive "PA is the anterior one" test flips tags 5 and 6 depending on how much
  vessel the model retains.
- **Atria are not simply "up".** The heart sits obliquely, base posterosuperior and rightward.
  Split along the derived long axis, not a global one.

## 8. Recommendation

**Do not reverse the 2026-08-19 rejection on this evidence.** The rejection stands on two legs;
this experiment knocks out one and bends the other without breaking it.

- **Debris (defect a): solved.** Cleanly, cheaply, reproducibly. If this were the only defect,
  the model would be usable.
- **Per-chamber structures (defect b): not solved, but the pessimistic reading is wrong.** The
  chambers are *there*, at correct anatomical scale, as 425 mL of open lumen. What is missing is
  a way to cut them apart at the valve planes, because the model leaves every orifice open. That
  is a tractable engineering problem, not an absence of information.

**The binding constraint is identification, not splitting.** Both routes to naming a lobe fail
(§5b): donor registration is ambiguous at a 0.02 Dice margin, and this model does not carry the
LV/RV wall-thickness contrast the geometric discriminator needs. Any further splitting effort
produces more unnamed regions.

What would settle it, in order of expected value:

1. **Four human clicks as watershed markers** (§5b.4). One click inside each of LV, RV, LA, RA on
   a handful of slices. This is first by a wide margin because a marker is simultaneously a seed
   and a label, so it breaks the merge, the identification and the left-right assignment at once,
   with no registration, no orientation and no thickness contrast required. Minutes of work.
   Cost: the labels are hand-seeded provenance, not derived — acceptable for one evidence pack,
   not for a repeatable multi-source pipeline.
2. **A geodesic watershed** confined to the cavity (~40 lines of priority-flood; `skimage` is not
   in `environment.yml` and should not be added for an experiment) to flood from those markers
   while respecting the septum, rather than cutting a Euclidean plane through it.
3. **A better donor registration initialisation**, if a fully automatic route is wanted. The
   donor is a genuine 1:1 cover of tags 1–6 and the failure is purely pose search. PCA is
   degenerate on a near-ellipsoidal blob; the great-vessel tubes are the only directional
   features and matching those would pin the left-right assignment. An exhaustive coarse rotation
   search scored
   by Dice is affordable at this size and cannot stick in a local optimum. Note this is now
   *third*: it is the only route that keeps the pipeline hand-free, but (1) is far cheaper and
   more certain, and a donor registration could be validated against (1) rather than trusted on
   its own.
4. **Valve cut planes** for atrium/ventricle separation. The donor's valve leaflets and
   `fibrous-ring-of-mitral-valve` are the right shapes to fit annuli against.
5. **Only then** the tet mesh, valve tags, and the nine anatomy checks.

Two independent constraints are untouched by any of this and should be weighed first: the model
is **CC BY-NC 4.0**, and its **orientation is unverified**. A successful partition would remove
one objection out of three. If the substrate question is live, a permissively-licensed source
with per-chamber structures already modelled is a better use of the same effort.
