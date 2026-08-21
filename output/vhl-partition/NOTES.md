# VHL heart0102 partition experiment — technical findings

**Last Updated:** 2026-08-20 22:20 EDT

Branch `experiment/vhl-partition`, cut from `dev` at `294751faf124b79693cae99d9335e881189a032c`.

Scope: test whether the two defects recorded in the 2026-08-19 substrate rejection of
`normal-vhl-heart0102` are solvable. Those defects were (a) 1,026 connected components of
debris and (b) no per-chamber structures.

**Headline: (a) is solvable at negligible cost. (b) is not solved here, but it is not
impossible either — the chambers are present as open space and split cleanly into two
ventricle-scale lobes. A six-tag partition needs valve cut planes this experiment does not
have.** Nothing here reverses the rejection; see the recommendation at the bottom.

---

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

**A 2% margin cannot distinguish a left–right mirror, and a mirror swaps LV and RV.** Labels
transferred on this basis would look entirely plausible and be a coin flip. Not done.

Mean nearest-neighbour distance of 1.63 mm is *not* evidence of a good fit here — the target is
dense, so donor points land near *some* target point regardless of whether the correspondence is
anatomically right. Dice is the honest measure.

Contributing: the donor is an adult, the subject is 14; the VHL cavity (425 mL) includes
pulmonary veins and caval lumen that the six donor casts (392 mL total) do not cover, which caps
achievable Dice below 1 even for a perfect registration.

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
left-right mirror **simultaneously** — because a marker is both a seed and a label. It needs no
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
   and a label, so it breaks the merge, the identification and the left–right mirror at once,
   with no registration, no orientation and no thickness contrast required. Minutes of work.
   Cost: the labels are hand-seeded provenance, not derived — acceptable for one evidence pack,
   not for a repeatable multi-source pipeline.
2. **A geodesic watershed** confined to the cavity (~40 lines of priority-flood; `skimage` is not
   in `environment.yml` and should not be added for an experiment) to flood from those markers
   while respecting the septum, rather than cutting a Euclidean plane through it.
3. **A better donor registration initialisation**, if a fully automatic route is wanted. The
   donor is a genuine 1:1 cover of tags 1–6 and the failure is purely pose search. PCA is
   degenerate on a near-ellipsoidal blob; the great-vessel tubes are the only directional
   features and matching those would pin handedness. An exhaustive coarse rotation search scored
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
