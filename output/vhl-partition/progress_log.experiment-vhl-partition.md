# Progress log — branch `experiment/vhl-partition`

**Branch:** `experiment/vhl-partition`
**Branched from `dev` at:** `294751faf124b79693cae99d9335e881189a032c`
**Last Updated:** 2026-08-22 10:33 EDT

Branch log. Interleave these entries by timestamp into the planning folder's
`progress_log.md` at merge, then delete this file.

Newest first.

---

## 2026-08-22 01:12 ET — the labeller becomes a tool, and a proposal for landing the model

**The tool is stored.** `pipeline/labeller/` — the viewer, a parameterised exporter and a
server. It had been living in a scratch directory outside the repository, which nearly cost
the work once already: the round-five and round-six lumen labels existed ONLY there, and the
committed `seed-partition-labels.npz` is byte-identical to round FOUR.

`export.py` replaces two hardcoded scratch scripts with one CLI over a grid, a tissue mask, a
lumen labelling, a wall labelling and a measured cardiac frame. It knows nothing about which
source produced them. three.js is copied from `node_modules` rather than vendored, so it
cannot drift from the pinned version, and every file it reads stays gitignored because they
are derived from a CC BY-NC source. Verified by building a fresh directory with the committed
exporter and loading it in the browser: same volume counts, same per-chamber vertex colours.

`serve.py` sends `no-store`. A stale page was twice mistaken for a labelling bug in this
session, once for long enough to send me looking for the fault in code the page had never
loaded.

**A proposal for merging, in `pack-labelled-vhl.proposed.md`.** Shape: a NEW pack
`normal-vhl-heart0102-chambers` beside the rejected one, registered in `UNPUBLISHED_PACKS`
for a licence reason and deliberately with no `substrate` key, since this artefact was not in
the wave-1a comparison.

Read against the repository's own rules rather than from memory:

* `mayBePublished` returns false for `non_commercial`, the build filter in `vite.config.ts`
  drops anything outside `PUBLISHED_PACK_IDS`, and `check-published-packs.ts` fails CI if
  `dist/` disagrees. The pack is safe to hold in Git and cannot reach Pages by any route.
* `PUBLIC_GIT_LICENSE_STATES` already admits `non_commercial` and `public_repo_eligible` is
  already true on this source, so committing derived files needs no new policy decision.
* `BloodPoolDecision.basis` allows exactly `label_match`, `label_no_match`, `source_tag`,
  `authored`. For a hand-seeded pack only `authored` is honest.
* `AnatomicalFrame` enforces an orthonormal right-handed `basis_source_to_pack` and has a
  `checks` record where a FAILING check is allowed to be recorded. The measured frame must be
  checked against that tolerance before a pack is written; it has not been.

**Three of the four rejection grounds are answered for the derived pack** - debris, per-chamber
structures, and the unverified orientation, which is now measured rather than declared. The
fourth, CC BY-NC 4.0, is untouched and is the binding one. The rejection of the ORIGINAL pack
stands exactly as written: it describes an artefact that still has those properties.

**An open registry question, flagged rather than decided.** `SOURCES` is keyed by source and
carries `pack_id` as a single field, so one source produces one pack. With the labeller now a
tool intended for more models, one source producing several labelled packs is about to be the
normal case. A `derived_packs` list on `Source` is the cleaner of the two options and it is a
schema change, so it is the owner's call.

**One correction to NOTES §6b.** Its ladder says the anatomy gates need five fabrications
including a pulmonary artery. There is now a real PA at tag 6, 20.7 mL, so that rung is gone.
Still missing: valve rings 7-10 (the tags exist now, the geometry does not), an SVC at 16, an
IVC at 17, and a `Z` field whose derivation from this partition would make the apex check
partly circular. The recommendation not to run the gates on a fabricated mesh stands.

## 2026-08-21 22:57 ET — the cleanup was eating the atrial wall it was meant to tidy

Three defects the owner saw in the viewer, all in the atria, all one cause.

**Red and green inside the right atrium.** The endocardium is labelled from the lumen it
touches, so the RA's inner surface was RA by construction - and then the cleanup took it
away. `absorb_thin` removes strips under 1.5 mm and this wall's median half-thickness is
1.34 mm, so the atrial layer IS a thin strip: it was absorbed whole and handed to whatever
lay on the other side. **871 of the RA's 7,688 mm2 of endocardium came out left-atrial (475)
or right-ventricular (340).** Smoothing over a 2 mm ball does the same thing wherever the
wall is thinner than the ball.

Fix: smoothing runs on the wall INTERIOR, and both labelled faces are restored afterwards.
The endocardium is an observation - the lumen it touches - and the epicardium is the drawn
grooves. Neither is a thing to take a majority vote over. Disagreement between the
endocardium and the wall it ends up in is now **0 mm2 for all six chambers**, from 871, 250,
694 and 515 for RA, LA, PA and aorta.

**A first hypothesis, wrong, recorded because it was plausible.** The six-neighbour vote in
`label_from_lumen` broke ties by tag NUMBER, which on a one-voxel septum hands every tied
voxel to the same chamber - LA over RA, every time. It was replaced with local support (how
much of the nearby free space belongs to each candidate), which is better and has no such
bias, but it was not the bug: **21 mm2 moved.** The improvement is kept; the diagnosis was
not the cleanup's.

**The yellow speck between red and blue.** A chamber's epicardial territory is now forced to
its single largest patch. The specks are tiny - 45 mm2 across all six labels - but a
rendered vertex takes the nearest labelled wall voxel, so a handful of voxels paints a patch
you can see.

**The outside boundary, measured rather than judged by eye.** Of 1,158 mm2 of territory
border on the epicardium, **149 mm2 sits more than 4 mm from any drawn groove**, and 86 mm2
of that is a single run at the LA/aorta/PA junction near the base. The rest is groove-held.
`where-to-draw.png` marks the unheld runs in magenta.

**The render is now the limit, not the labels.** The wall mesh is at 0.775 mm and the atrial
wall's half-thickness is 1.34 mm, so a vertex can snap across it. Measured on the exported
vertex colours:

| endocardium of | nearest labelled wall voxel | vertex normal | nearest lumen |
|---|---|---|---|
| RA | 94.7% | 86.7% | **96.0%** |
| LA | 95.0% | 93.3% | **95.2%** |
| RV | 99.0% | 98.9% | **99.0%** |
| LV | 99.1% | 98.4% | **99.3%** |

Vertex normals were tried and are WORSE: the surface is trabeculated, the normal is noisy,
and the inward test picks the wrong side often enough to lose eight points on the RA. What
works needs no normal - a vertex on the endocardium is within a voxel of the lumen it lines,
and which lumen that is was already decided by touching. The residual few percent is mesh
resolution against a wall thinner than the mesh spacing, and it is a RENDER artefact: the
labels themselves disagree nowhere.

## 2026-08-21 22:31 ET — the wall was labelled on the wrong surface; the valve-plane rule is withdrawn

**The left-atrial wall was never a missing groove.** `vhl_wall_paint.epicardium` returns
every tissue voxel with a free neighbour, and on this model that is not the epicardium.
The chambers hold 425 mL of open lumen and the wall is trabeculated throughout, so the
tissue boundary is **149,074 mm2 of which only 57,557 (38.6%) faces outside**. The rest is
endocardium and the surface of trabecular struts.

**80% of the LA's surface territory sat on that inner surface.** The flood left the atrium's
outer patch, passed through the open mitral orifice onto the left ventricular endocardium,
and ran down the trabeculae to the apex - a route that never crosses a groove, because
grooves are drawn on the outside. 82.5 of the 109.6 mL was nearer the LV lumen than any
other chamber and it reached 89 mm from LA lumen. No groove could have closed it.

`pipeline/vhl_epicardium.py`: outside is `free AND NOT chamber space`, take the component
reaching the grid border, the epicardium is the tissue facing it. No new parameter - it
rests on the chamber-space mask this branch already built.

| | LV | RV | LA | RA | Ao | PA |
|---|---|---|---|---|---|---|
| whole boundary | 68.6 | 127.1 | **109.6** | 34.2 | 9.7 | 14.8 |
| outer only | 147.1 | 138.6 | **22.7** | 34.9 | 11.5 | 9.2 |
| + endocardium from lumen | 149.9 | 137.8 | 25.1 | 32.1 | 8.6 | 10.5 |

Territory interface fell from 38,139 to 12,160 mm2 on the first step.

**The endocardium needs no drawing at all.** An inner-surface voxel is FACE-ADJACENT to the
lumen it lines, so it reads its tag straight off the lumen voxel it touches - the owner's
suggestion, and it is better than nearest-lumen because nothing is measured at a distance
and so nothing walks through the septum. `pipeline/vhl_wall_inner.py`. The wall between is
then nearest-labelled-SURFACE, an interpolation between two observed faces rather than an
extrapolation from one.

**A WITHDRAWAL.** An infinite half-space at each valve plane was applied - no atrium apical
of its own plane, no ventricle basal of it - and it is wrong in the second direction.
Measured against the groove flood it pushes **7,169 mm2 of epicardium, 12.5%, off the
grooves**, 6,263 mm2 of it atrial colour crossing the atrioventricular groove onto
ventricle. Without the rule the disagreement is 901 mm2, 1.6%. The owner saw it in a
section before the number was in hand.

The rule was never needed in the direction it was asked for: with the endocardium taking
the lumen's tag, **RA apical of the tricuspid plane is 0.0 mL and LA apical of the mitral
is 0.7 mL** - the round-six atrioventricular divide carries through for free. It only fired
the other way, on 22.9 mL of RV and 12.3 mL of LV. `index.html` already carried the reason,
from the valve-tracing work: *any plane that separates atrium from ventricle also slices the
outflow; a bounded disc does not have that problem.* An infinite plane was used anyway.

**Two more things the inner surface turned up, both measured rather than assumed:**

* **Sealed voids.** 18.39 mL of free space in **17,387 disconnected pieces**, inside the
  wall, neither chamber nor outside air - the trabecular interstices the occlusion mask
  closed off. They carry **35,881 of the 91,517 mm2 of inner surface**, so 39% of what looks
  like endocardium is not a surface anyone can draw on. Tagged 22 in the shipped volume so
  the viewer names them instead of reading them as open air.
* **Unlabelled chamber space** is only 8,942 voxels. Tagged 21, for the same reason: it was
  indistinguishable from outside air, and a mark on endocardium facing it was refused.

**Valve rings are now first-class.** Tags 7-10, numbered as `anatomy.py` numbers them, with
`VALVE_PAIR` recording which chamber pair each divides - which is the definition
`identify_valve_planes` checks. The myocardium sentinel in the shipped volume moved from 7
to 20 to clear the collision; `anatomy.py` owns 1-24, so the sentinel sits above the range.

**New tool: paint the inner surface.** Same shape as the groove painter - a boundary stroke
is a barrier, a region point names what it divides, and three region points around a Y name
three territories with no special case. One rule the outer tool does not need: a mark must
be ON the endocardium, decided from the data rather than the camera. `facing` reads the hit
voxel first and otherwise walks back along the ray until it finds what is being looked
through: a chamber tag means endocardium and says which chamber, 21 means endocardium facing
unnamed space, 22 means a sealed void, 0 means the epicardium and the mark is refused.

Two bugs found by driving it, both real: the ray could land on a **lumen cast** rather than
the wall, so a mark meant for endocardium landed on blood pool - the picker is now
restricted to the myocardium mesh; and the side test ignored the strongest signal it had,
the tag of the voxel the hit already falls in.

Verified in the browser: a mark inside the opened right ventricle reads *endocardium lining
the right ventricle* and registers; a click on the outer shell is refused and the count does
not move.

**Housekeeping.** `vhl_wall_labels.py` (nearest labelled lumen, straight-line) moved to
`pipeline/archive/` with a note on why it was superseded. A stale `http.server` from the
previous session was still bound to :8777 on IPv6 serving round-five data, with this
session's server on IPv4 - `localhost` could reach either. Killed; use `127.0.0.1:8777`.

**Recovered, and worth recording:** the previous session's scratch directory survived, and
the round-five and round-six lumen labels existed ONLY there. The committed
`seed-partition-labels.npz` is byte-identical to `round4-final-labels.npz`, so the headline
six-chamber volumes were one reboot from needing a rebuild.

## 2026-08-21 15:49 ET — round six: the atrioventricular divide enforced, and the wall drawn rather than inferred

**A real error the observer caught by eye.** Atrial lumen was sitting BELOW its own valve
plane. Measured against the traced annuli: **10.3 mL of right atrium below the tricuspid
plane, the deepest 39.1 mm below it**, and 1.1 mL of left atrium below the mitral. Both
reassigned to the ventricle.

The rule is deliberately ONE-WAY - atrium on the ventricular side becomes ventricle, never
the reverse - and unbounded by the disc radius, unlike the earlier reclassification. The
reverse direction would eat the right ventricular outflow tract, which is basal to the
tricuspid plane and legitimately ventricle. "Below the plane" is a half-space and an atrium
has no business anywhere in it.

**Round six lumen:** LV 82.1, RV 148.3, LA 37.0, RA **75.0** (from 85.4), aorta 11.6,
PA 20.7 mL. All single components.

**The wall is now drawn, not inferred.** 375 groove marks and 1,076 region points at a 5 mm
brush. The barrier covers 175,363 of 993,449 epicardial voxels; **1,376 voxels, 0.14%, were
left unreached** by the flood, so the grooves close well enough almost everywhere.

| chamber | painted wall mL | nearest-cavity mL |
|---|---|---|
| LV | 116.1 | 130.0 |
| RV | 133.5 | 128.4 |
| LA | 75.6 | 33.8 |
| RA | 28.1 | 44.4 |
| aorta | 3.5 | 10.2 |
| PA | 7.3 | 14.7 |
| unclaimed | 0.0 | 2.5 |

**LA wall at 75.6 mL is intentional, not a leak.** The observer folded the pulmonary veins
into the left atrium rather than tagging them separately - too many, too hard to resolve on
this model, and topologically continuous with the atrium anyway. Recorded so nobody later
reads it as an error and "fixes" it.

The boundaries follow the grooves now instead of the nearest cavity, and the patchiness is
gone: territories are contiguous with clean edges along the atrioventricular and
interventricular grooves. See `wall-painted-round6.png`.

**Gates.** `npm run check:fast` green, exit 0.

## 2026-08-21 15:18 ET — the wall colouring is patchy, so the grooves get drawn instead

**The observer's call, and it is right.** Assigning wall to the nearest labelled cavity
produces ragged territories, because the nearest cavity does not bound a chamber on the
OUTSIDE. The atrioventricular and interventricular grooves do, and on this specimen they are
plainly visible on the epicardium - so they should be drawn, not inferred.

**Tool.** A `Paint the wall` mode in the reviewer: `Draw groove` lays a barrier stroke along a
groove as you drag, `Name region` drops a chamber tag inside one. One mark per brush-width of
travel, so a drag lays a stroke rather than a blob. Exports `wall-paint.json` in cardiac
coordinates. Verified by driving it: strokes accumulate, region points register, undo and
clear behave.

**Consumer.** `pipeline/vhl_wall_paint.py` - the same seeded watershed used everywhere else on
this branch, moved onto a surface. Grooves are barriers, region points are seeds, the flood is
confined to the epicardial surface, and the wall beneath inherits from the surface above it.

**Confining the flood to the surface is the point.** Two voxels either side of a groove are
millimetres apart in space and a long way apart across the surface. That distinction is
exactly what a groove encodes, and it is invisible to a distance transform through the wall,
which is why the nearest-cavity version was patchy in the first place.

**Smoke-tested with synthetic marks** - eight region points per chamber sampled from the
existing wall labels and fed back as if painted, no grooves. Coordinate round trip, snapping,
flood and inheritance all work; IoU against the nearest-cavity labelling runs 0.36-0.67, which
is expected and not a defect: a surface watershed from eight points is not a nearest-cavity
assignment, and being different is the reason it was built. It has not yet seen a real mark.

## 2026-08-21 15:06 ET — a frame error, retracted; then per-chamber myocardium

**A CORRECTION, and it invalidated the previous entry's valve numbers.** The traced rims are
in CARDIAC coordinates - the viewer raycasts posed meshes - and everything downstream compared
them against `origin + (voxel + 0.5) * pitch`, which is MODEL coordinates. Settled by test:
mapped through `ROT.T` every traced point lands **0.5 mm** from the tissue surface; taken as
model coordinates, **2.5 mm** and up to 12.5 mm away.

Withdrawn: "the traced plane cuts 2929 mm2, nearly three times an annulus"; the 14-degree
refinement to 1186 mm2; the claim that the mitral search "degenerated onto a crevice" at
0 mm2; and the round-five volumes quoted from it. Radii, areas, out-of-plane rms and the
10.3-degree angle between the planes are rotation invariant and survive untouched.

**In the right frame the traces are good, and two independent measurements say so.**

| valve | orifice measured on the mesh | circle fit to the points | expected |
|---|---|---|---|
| tricuspid | 1405 mm2 | 1506 mm2 | 1000-1200 |
| mitral | 636 mm2 | 578 mm2 | 800-1000 |

Agreement to 7% and 10% between two things that share no machinery. The automatic refinement
now returns 934 and 488 mm2 - it undershoots both, hunting the narrowest local neck, which
sits below the annulus. **The observer's planes are kept.**

**Round five**, classifying inside each traced disc by side of its plane: LV 81.0, RV 138.0,
LA 38.2, RA 85.4, aorta 11.6, PA 20.7 mL. RA falls from 95.8, the right direction. The RA-RV
interface stays at 6,262 mm2, so the tricuspid still is not doing a valve's job.

**Per-chamber myocardium, the thing that makes `normal-rodero` read as a labelled heart from
outside.** `pipeline/vhl_wall_labels.py`: a piece of wall belongs to the chamber whose cavity
it encloses, so the nearest labelled lumen voxel names it. The interventricular septum comes
out split down its middle, which is the honest answer for a shared structure. Wall beyond
12 mm from any cavity is left unclaimed rather than attributed to whatever is least far away -
2.5 mL of 364.1.

| chamber | wall mL | lumen mL |
|---|---|---|
| LV | 130.0 | 81.0 |
| RV | 128.4 | 138.0 |
| LA | 33.8 | 38.2 |
| RA | 44.4 | 85.4 |
| aorta | 10.2 | 11.6 |
| PA | 14.7 | 20.7 |

**An old finding, confirmed from a new direction.** LV wall : RV wall = **1.01 : 1**, against
about 2.6 : 1 for Rodero. NOTES §5b.2 reached the same conclusion from wall THICKNESS and was
disbelieved once already; this is the same result from volume, by an unrelated route. This
model genuinely carries no left-right wall asymmetry.

**Rendering.** The wall carries a per-vertex colour attribute rather than six separate wall
meshes, which would duplicate every shared interface and roughly double the triangle count.
Two traps, both hit: a vertex sits ON the tissue boundary, so sampling the label volume at
that exact voxel reads 0 almost everywhere - snap to the nearest labelled wall voxel instead;
and three.js takes a vertex-colour attribute as LINEAR, so sRGB values written straight
through render washed out.

**Gates.** `npm run check:fast` green, exit 0.

## 2026-08-21 14:26 ET — traced annuli: the mitral severs, the tricuspid does not, and a bound is withdrawn

**The observer traced the tricuspid and mitral rims.** 14 and 20 points, saved as
`output/vhl-partition/valve-rims.observer-A.json`.

**Both planes are sound, and two checks say so that were not fitted for.** Out-of-plane rms
0.36 mm (tricuspid) and 0.51 mm (mitral) - the traced rings really are planar. The angle
between the two annular planes comes out **10.3 deg**, against 10-20 deg in a real heart, and
nothing in the fitting couples them. The mitral centre sits **+22.6 mm patient-left** and
**+18.6 mm basal** of the tricuspid, both correct in sign.

**The radii are not sound, and the reason is measurable.** The viewer reported radius as mean
distance from the centroid, which is only right if the points go all the way round. Re-fitting
as an algebraic circle in each plane:

| valve | viewer r | circle r | area | expected | arc covered | largest gap |
|---|---|---|---|---|---|---|
| tricuspid | 17.25 mm | 21.90 mm | 1506 mm2 | 1000-1200 | 173 deg | 187 deg |
| mitral | 10.50 mm | 13.56 mm | 578 mm2 | 800-1000 | 218 deg | 142 deg |

Roughly half of each ring was traced, so the fit extrapolates the rest; the two estimates
differ by 27%. Tricuspid reads large, mitral small. **Completing the arcs is the cheapest fix
available** and would settle both.

**A WITHDRAWAL.** The 08:13 entry applied an "Ebstein bound" - right-atrial lumen may not lie
more than 10 mm apical of the mitral floor - and moved 10.8 mL of RA into the RV on it. **That
bound is wrong and is retracted.** It assumed the tricuspid annulus sits at one apicobasal
height. The traced annulus is oblique: its normal carries a base component of 0.83, so the rim
descends to base **-29 mm**, and the lumen at -26 mm that the bound reassigned is ABOVE the
annulus, not below it. Round five is rebuilt from the round-four labels as they stood before
that fix.

**The mitral disc works; the tricuspid does not.** Cutting the mask at both discs and
re-flooding, the left ventricle comes out in its own connected component - the mitral orifice
is genuinely closed. The right does not separate: RA and RV seeds stay in one component, and
the shortest route between them through the cut mask is **0.8 mm**.

**Why, measured.** The residual RA-RV interface is 6,195 mm2 and it is not at the annulus:
median **12.6 mm from the traced plane**, and **29% of it beyond the disc radius**. Classifying
by the plane inside the disc moves 26 mL between the two and leaves the interface at 6,195 mm2.
The two labels interpenetrate over a broad surface well away from the valve, which no annulus
can fix.

**The likely cause, and it is the standing one.** RA is 110 mL against an expected 25-45, with
roughly 45 mL above +19 mm at great-vessel height. The label is carrying the caval stubs and
the atrial appendage, which run alongside the right ventricle - so the two labels are neighbours
far from the tricuspid because one of them is not only a right atrium. Tags 16 and 17 are in the
viewer and unused.

**Gates.** `npm run check:fast` green, exit 0.

## 2026-08-21 14:08 ET — the stencil cap was the lag; the baked face replaces it

**The stencil cap worked and has been removed.** It follows the app's own
`src/viewer/caps.ts` and it costs two extra full passes over the myocardium every
frame - back faces then front, `depthTest: false` so nothing is rejected early -
roughly **1.6 M triangles of pure overdraw** on top of a 1.24 M scene, re-run on
every frame of a drag. That was the rotation lag, and it appeared exactly when the
caps went in.

**It was also redundant, which the owner spotted: bake it instead of drawing it.**
The cut face was already a texture sampled from the label volume and drawn as ONE
quad - solid by construction, two triangles, no geometry pass. The only reason the
stencil version was still in use was that the painted face had to be turned off to
see into a chamber while tracing a rim. So the face now has a **wall-only** mode:
paint tissue, leave lumen clear. The wall reads solid and you can still see into the
chamber. Same picture, 1.6 M fewer triangles per frame.

**Interaction downgrade kept.** Pixel ratio drops to 1 while the pointer is down and
restores on release: ratio 2 on a Retina panel is four times the fragments, for a
picture nobody is studying mid-drag.

**A failed attempt, recorded because it cost the most time.** Render-on-demand -
draw only when a dirty flag is set - was tried and reverted. Too many things move
the picture for one flag to track, and a missed one is an invisible bug. Worse, the
edit that removed it took the render loop with it: a non-greedy regex spanning
newlines matched further than intended and deleted `tick()` entirely. The symptom
was a blank canvas with the backing store stuck at the default 600x300 while CSS
reported 1168x960, which is the tell that `setSize` never ran. Console was no help -
the pane kept replaying a stale `invalidate` ReferenceError from an earlier load
long after that identifier was gone from the served file, which sent me looking in
the wrong place twice. **Check the canvas backing store against its CSS size before
trusting a console message.**

**Gates.** `npm run check:fast` green, exit 0.

## 2026-08-21 13:47 ET — mesh density back down, and solid cut faces by stencil

**Density.** Full-resolution meshes were 5.36 M triangles and made the viewer lag, and they
were never what fixed the holes - stripping the 1,025 debris shells was. Meshes are back to
192^3 and **1.24 M triangles**, a 4.3x reduction. The label volume stays at 384^3: picking
and the cut face read the VOLUME, not the mesh, so precision where it matters is unchanged.

Downsampled by **max over each 2x2x2 block**, not by stride. Striding drops every second
plane, which would delete exactly the one-voxel walls it took three attempts to stop
deleting.

**Solid cut faces.** A clipped shell reads as hollow - clipping deletes fragments and leaves
the inside of the surface staring back. Now capped by the stencil algorithm from the app's own
`src/viewer/caps.ts`: render the geometry writing only stencil, back faces incrementing and
front faces decrementing with the depth test off, so away from the cut every back face is
matched and the counter returns to zero, while over the cross-section the matching front face
has been clipped away and it does not. A quad masked to `stencil != 0` paints that solid.

Two things carried over from the app's module because they are not obvious:

* **`stencil: true` on the renderer is required.** three.js has defaulted it to false since
  r163 and every cap silently renders nothing without it.
* **Myocardium only; lumen is never capped.** The app documents why and it is the same reason
  here: a chamber is a CAST, so capping it paints a solid disc across the opening and the
  chamber reads as filled. It is filled in the file and it is not filled in a heart. Leaving
  lumen open is the honest rendering, and it is exactly what "fill the non-lumen side" asks for.

The painted cut face and the stencil cap coexist: the painted face carries the chamber colours
and sits a hair in front, the stencil cap is what you see when the painted face is turned off
for tracing.

**Gates.** `npm run check:fast` green, exit 0.

## 2026-08-21 13:40 ET — the holes were the rejection's defect (a), and the fix was already on the branch

**The owner asked whether the holes are just the model. They are — and the branch solved
this on day one, in `vhl_partition.strip_debris`, which was never applied here.**

`pack.json` says it in as many words: *1,026 connected components - trabecular islands and
segmentation debris - **render as voids through the tissue***. That is defect (a) of the
2026-08-19 rejection. 1,025 of the 1,026 components are inward-wound shells sitting inside
the wall, and `voxelise` fills by RAY PARITY, which subtracts a negatively wound component.
Every bubble therefore punches a void straight through the tissue mask.

Every grid on this branch since `cache_grid.py` was built from the RAW welded mesh:

```
surface, _ = geometry.weld(read_binary_stl(...))
grid = voxelise(surface.vertices, surface.faces, 384)
```

No `analyse_debris`, no `strip_debris`. The 1,025 bubbles went straight into the voxels and
then into every surface extracted from them.

**Measured, on the stripped mesh.** 1,026 components, 1,025 inward-wound, separation ratio
4,986x; 803,542 triangles down to 782,436. Voxelising the kept component instead:

* voids filled: **9,730 voxels = 0.57 mL**
* tissue removed: **0 voxels**
* of the filled voids, sitting inside a chamber label: **0 voxels**

So no chamber volume moves and no partition number changes. The tissue surface gains 0.57 mL
of wall that was being carved out from underneath it.

**This is the third and largest of three compounding causes**, and the two before it were
real but partial: quads inverted on one axis, which lit as dark speckle; and a blur at sigma
0.6 that erased ridges (0.441) and struts (0.293) below the 0.5 threshold, now 0.4. Fixing
either alone left the surface looking broken, which is why two previous claims that it was
fixed were wrong.

**Verified by eye at six angles** after the change - apex, ventricular free wall, base from
above at two distances, the atrial mass, and anterior-superior with the aortic stump open.
Smooth wall, visible coronary grooves, no pitting.

**Worth carrying forward.** Anything that voxelises this source must strip debris first. The
partition itself was computed on the raw grid, but only ever inside `space`, which is the
complement of tissue - so the bubbles, being inside the wall, never entered it. That is luck
rather than design, and the next thing built on this grid may not be so lucky.

**Gates.** `npm run check:fast` green, exit 0.

## 2026-08-21 13:25 ET — two compounding faults in the surface extractor, and full resolution

**Both found by looking at the render, and neither by a metric.** The surface was covered in
dark rectangular speckle and in real perforations. They had separate causes and fixing one
left the other, which the first version of this entry got wrong.

**Fault one: quads on one axis were wound backwards.** Surface nets emits one quad per
sign-changing grid edge from the four cells around it, and the two in-plane axes must form a
RIGHT-handed basis with the edge direction. The cyclic rotations are (1,2), (2,0), (0,1); the
code had (1,2), **(0,2)**, (0,1), and `(x, z, y)` is left-handed, so every y-facing face was
inverted. Inverted normals light black - the speckle was not holes at all.

*Why the original check missed it.* The extractor was validated on a cube: 3,024 triangles,
Euler characteristic exactly 2. An inverted axis leaves the mesh perfectly closed, so that
test cannot see it. It is now checked on a cube AND three axis-aligned slabs, one per axis,
for zero boundary edges and a POSITIVE signed volume. The slabs are the part that matters.

**Fault two: the blur was erasing thin structure, and 0.6 was not enough.** At sigma 1.0 a
one-voxel sheet blurs to 0.399, under the 0.5 threshold, so thin sheets were deleted outright.
Dropping to 0.6 fixed sheets and the holes stayed, because a sheet is the easy case:

| sigma | plane | ridge | point |
|---|---|---|---|
| 0.4 | 0.919 | 0.845 | 0.777 |
| 0.5 | 0.787 | 0.619 | 0.487 |
| 0.6 | 0.664 | **0.441** | **0.293** |
| 0.8 | 0.499 | 0.249 | 0.124 |

A trabecular lattice is ridges and struts, not planes, and at 0.6 those fall under the
threshold and vanish. Now **0.4**, where a ridge holds 0.845 and an isolated strut 0.777.

**Also: Taubin instead of Laplacian smoothing.** Repeated Laplacian shrinks, and on a thin
sheet pulls the two sides through each other into a self-intersecting surface that speckles
however the normals are wound. The positive-then-negative pair does not shrink.

**A proxy that was worthless, recorded so it is not repeated.** Boundary-edge counting on a
100^3 test block said 3,190 open edges at every blur setting. That number means nothing here:
the block cuts through the heart, so the surface is legitimately open at the block face and
the count is dominated by it. The check that worked was looking at the thing.

**Verified by eye at four angles** - ventricular free wall, base from above, the atrial mass,
and the great-vessel stumps with aortic and caval lumen showing in their cut ends. No lattice,
no speckle.

**Full resolution.** Meshes and the label volume are now 384^3 rather than 192^3: half
resolution smoothed away the trabecular detail that distinguishes an orifice rim from a
crevice, which is exactly what is being traced. 5.36 M triangles across seven surfaces and a
56.6 MB label volume behind the cut face. All scratch, none of it in the repository.

**Presentation, following the app.** Myocardium is neutral grey and fully opaque so nothing
competes with a chamber colour on the cut face, and materials are `MeshStandardMaterial` at
roughness 0.55 and metalness 0.05 - the model `src/viewer/PackViewer.tsx` uses. The clearcoat
sheen tried earlier was wrong for this surface: it turned every trabecular ridge into a
highlight.

**Gates.** `npm run check:fast` green, exit 0.

## 2026-08-21 12:44 ET — the observer will trace the annuli; the tool now lets them

**State.** No new partition this entry. The reviewer was rebuilt to collect the one input
that neither geometry nor the seed flood can supply: the rim of each orifice.

**Why this is the right move rather than more code.** The valve-plane search in
`pipeline/vhl_valve_plane.py` settles the mitral and pulmonary cleanly - 0.00% of marks on
the wrong side - and cannot settle the tricuspid, because the right ventricular outflow
tract runs basally past that annulus, so any infinite plane separating right atrium from
right ventricle also slices the outflow. A traced rim gives a CENTRE and a RADIUS, so the
cut can be a bounded disc, which has no such problem. The same traces are what
`identify_valve_planes` has been missing since the start: it derives a valve's identity from
which chamber PAIR its plane borders, and every orifice in the tool carries that pair.

**What changed in the tool.**

* **A freely orientable cut.** The plane is now a general `{n . p = d}` rather than an
  axis-aligned slab. `Face me` swings it onto the camera direction and keeps the far half,
  so the fresh cut is the side turned towards the viewer; the three cardiac axes remain as
  presets.
* **A transparent cut face.** The painted face is on an opacity slider and drops to zero in
  tracing mode, because a rim has to be seen THROUGH.
* **No ghost.** With the face off, the remaining tissue is forced fully opaque. Front-face
  culling was tried first and is wrong here: this wall is trabeculated and full of real
  holes, so culling skeletonises it rather than solidifying it. Opacity is what removes the
  ghost; the geometry stays double sided.
* **A headlight on the camera.** The scene lights are fixed in world space, which suits the
  outside of the organ and leaves the inside of a cut black - and the inside is the whole
  point when hunting for a rim.
* **Clicks land on anatomy, not on the plane.** In tracing mode the ray is cast at the
  meshes rather than the face quad. This needed care: **three.js raycasting ignores material
  clipping planes**, so a ray happily returns a hit on the half that has been cut away and is
  not on screen. Hits on the removed side are rejected before the nearest is taken.
* **Eleven orifices, not four.** The four valves plus four pulmonary vein ostia, both cavae
  and the coronary sinus. Ranges are quoted only for the four valves, where a normal area at
  this age is something that can be stated; a vein or caval ostium gets its measured area and
  no verdict, since how much stub the specimen retains is a property of where it was trimmed.
* **Disc fit.** Least-squares plane through the traced points by inverse iteration on the
  3x3 scatter matrix, reporting centre, normal, radius, area and out-of-plane RMS. The RMS is
  the honest part: it says how planar the traced ring actually was. Exports as
  `valve-rims.json` carrying the chamber pair each orifice separates.

**Verified end to end** by driving it: four points placed on tissue fitted to r 15.6 mm,
area 762 mm2, out-of-plane rms 1.14 mm, correctly flagged small against a 1,000-1,200 mm2
tricuspid. Cut-face audit still 0 of 2,000 on every axis.

**Next, once rims come back:** cut right atrium from right ventricle inside the tricuspid
disc only, leaving the outflow untouched; then emit tags 7-10 as valve-plane bands and try
`identify_valve_planes` for the first time.

## 2026-08-21 08:13 ET — round four: the mixing was real, and anatomy names it

**State.** 4,361 further corrections. Every chamber is now a single connected component,
and the "volume within volume" the observer saw has a measured cause rather than a
description.

**It was not islands.** Disconnected pieces total 0.25 mL across all six labels, so nothing
a component filter would find. The interdigitation shows up instead as CONTACT AREA between
labels that anatomy says must not touch, or must touch only at an orifice:

| pair | contact | anatomy |
|---|---|---|
| RA-RV | **6,394 mm2** | tricuspid orifice, about 1,000-1,200 mm2 at this age |
| LV-LA | 1,468 mm2 | mitral orifice, about 800-1,000 mm2 |
| RV-PA | 363 mm2 | pulmonary orifice, about 500-600 mm2 |
| RA-PA | 192 mm2 | **should be zero** |
| LV-RV | 0 | septum intact |
| LA-RA | 0 | septum intact |

The septa are clean. The right atrium and right ventricle, however, share five times the
area a tricuspid annulus has: they interleave.

**A valve plane was tried and rejected on measurement.** `pipeline/vhl_valve_plane.py`
searches 300 orientations and every offset for the least-area plane separating two seed
sets. Mitral and pulmonary separate PERFECTLY — 0.00% of marks on the wrong side. RA/RV
does not: the best plane in any direction misclassifies **7.67%**, and forcing one drives
the cut to 3,240 mm2 when the same direction has a 1,302 mm2 minimum elsewhere. The reason
is anatomical and worth recording: **the right ventricular outflow tract continues basally
past the tricuspid annulus to the pulmonary valve**, so no single plane can separate the
right atrium from the right ventricle. The module is kept because it settles the mitral and
pulmonary planes cleanly, which is what `identify_valve_planes` will need.

**What the cross-sections showed, and the constraint that follows.** Right-atrial lumen
appeared at mid-ventricular level in short axis — impossible. On the apicobasal axis the
left atrium's floor, which is the mitral annulus, sits at **-4.0 mm**; the right atrium
reached **-34.8 mm**, 30.8 mm apical of it. A tricuspid annulus does sit apical to the
mitral, but an offset past about 10 mm is the definition of Ebstein's anomaly, and this is
a normal donor. So right-atrial lumen below -14.0 mm is not right atrium: 10.8 mL went to
the right ventricle, which is the only thing that can be there. The bound is read off the
left side of this same model rather than fitted, and the cost of every choice from 5 to
20 mm is tabulated in `../diag/anatomy_fix.py` output.

**Round four.**

| tag | mL | expected | comps | height mm | round 3 |
|---|---|---|---|---|---|
| LV | **77.8** | 60-100 | 1 | -66 .. 20 | 69.7 |
| RV | 127.7 | 60-100 | 1 | -75 .. 31 | 139.2 |
| LA | **41.5** | 25-45 | 1 | -4 .. 57 | 49.6 |
| RA | 95.8 | 25-45 | 1 | -14 .. 54 | 85.0 |
| Aorta | 11.6 | 15-25 | 1 | 10 .. 56 | 11.6 |
| PA | **20.8** | 15-25 | 1 | 16 .. 66 | 20.1 |

Three of six in range, all six single components, both septa intact.

**What is still wrong, and it is a question for the observer rather than for code.** The
right atrium is 95.8 mL against an expected 25-45, and roughly 45 mL of it sits above +19 mm
at great-vessel height. The most likely reading is that the label is carrying the caval
stubs and the atrial appendage as well as the atrium proper — all continuous lumen in a
model with no valves, and none of them separable by geometry. That is the same class of
problem as the pulmonary artery before round three: it needs a name placed by a person, not
a threshold. `anatomy.py` reserves tags 16 and 17 for the cavae and they are exactly what is
missing.

**Gates.** `npm run check:fast` green, exit 0. `pipeline/vhl_valve_plane.py` and
`pipeline/vhl_surface_nets.py` are new; `anatomy.py` and `view_candidates.py` still only read.

## 2026-08-21 07:45 ET — round three: the observer retags on the cut face, and the assignment changes

**State.** The chamber ASSIGNMENT was wrong, and it is now corrected from 6,594 marks the
observer placed directly on a cross-section. The partition machinery was right; what it was
told to find was not.

**What the corrections say, tabulated against what each voxel was labelled before.**

| marked as | marks | had been |
|---|---|---|
| **pulmonary artery** | 1,556 | **RA 99%** |
| **right atrium** | 1,488 | **RV 82%**, myocardium 11%, LA 7% |
| right ventricle | 1,075 | RA 74%, RV 26% |
| left atrium | 276 | LV 81%, LA 12% |
| not lumen | 2,199 | myocardium 35%, LA 29%, RV 25%, unlabelled 11% |

**The old right atrium was the pulmonary artery, essentially in its entirety**, and a large
part of the old right ventricle was the right atrium. Six of the 27 original round-one seeds
are overruled where they sit — four RA seeds to PA, two RV seeds to RA — and were retired
rather than allowed to fight the corrections in the flood.

This also explains §5d.5's standing anomaly without any appeal to the mask: the largest
inscribed sphere in the model sat in the "RV" label because that label was carrying the right
atrium as well.

**Noise.** The observer's 2,199 not-lumen marks are not separate pockets — 2,193 of them fall
inside the single 386.9 mL connected space, so they are thin bleeds into crevices, not stray
components, and no component-size filter reaches them. They were used instead to SCORE a
morphological opening of the space, which is the operation that removes what no ball of a
given radius fits inside:

| opening | space mL | bleeds surviving | chamber marks lost |
|---|---|---|---|
| none | 398.6 | 53.8% | 4.6% |
| 0.75 mm | 389.4 | 38.2% | 4.8% |
| **1.25 mm** | **375.1** | **18.1%** | **5.6%** |
| 2.0 mm | 357.7 | 16.4% | 7.5% |
| 2.5 mm | 347.2 | 15.7% | 8.9% |

1.25 mm is a knee, not a preference: it clears two thirds of the surviving bleeds for one
percentage point of lumen, and past it each further step buys about a point of bleed for two
to three points of lumen. The space is opened rather than the labels, because opening a label
erodes it where two labels meet — the open mitral and tricuspid orifices among them — and
would carve away lumen that is real. Marked voxels are then struck directly, and per-label
islands under 0.5 mL dropped.

**Round three.**

| tag | mL | expected | components | round two |
|---|---|---|---|---|
| LV | **69.7** | 60-100 | 1 | 89.1 |
| RV | 139.2 | 60-100 | 2 | 216.9 |
| LA | 49.6 | 25-45 | 1 | 43.8 |
| RA | 85.0 | 25-45 | 2 | 37.1 |
| Aorta | 11.6 | 15-25 | 1 | 11.7 |
| **PA** | **20.1** | 15-25 | 1 | **0.0** |
| total | 375.1 | | | 398.6 |

**The pulmonary artery exists for the first time on this branch**, at 20.1 mL and in range,
after five rounds in which no seed could be placed in it. The RV falls from 216.9 to 139.2 —
still above range, and now the RA is above range instead at 85.0, so the RV/RA boundary is the
next thing to look at rather than the mask.

**A review tool, and it is what produced all of this.** A three.js viewer over real surfaces
extracted from the label volume by surface nets (`pipeline/vhl_surface_nets.py`, written
because `skimage` is not in `environment.yml` and marching cubes is not worth adding it for),
posed in the measured cardiac frame, tissue at 0.90 opacity and lumen translucent, with a
movable clip plane on any of the three cardiac axes. The cut face is not a stencil cap: it is
sampled from the label volume, so it shows what is actually at that depth and a click on it
lands on a real voxel. Marks export in the schema `vhl_seed_partition.py` already reads.

**Two bugs found and fixed in that tool, both by measurement rather than by eye.** The cut
face was a rotated `PlaneGeometry` textured in plane coordinates, so the rotation and three.js's
`flipY` disagreed and the face came out mirrored against the body it was cutting; its corners
now come from the same function that paints each pixel. `window.auditCap()` samples the painted
face and the label volume at the same points and counts disagreements — 0 of 3,000 on each of
the three axes at three depths. And the volume's tissue sentinel was 6, which collided with the
pulmonary artery once tag 6 finally had voxels in it; tissue is 7 now.

**Gates.** `npm run check:fast` green, exit 0. Nothing outside `pipeline/` and
`output/vhl-partition/` touched; `anatomy.py` and `view_candidates.py` still only read.

## 2026-08-21 03:25 ET — the mask is fixed; the RV survives it and is now an anatomy question

**State.** The leak is closed. Chamber space is defined by line-of-sight occlusion from
the observer's outside marks rather than by a morphological envelope, and the owner's
rule holds exactly: **0 of 553 marks fall inside the chamber space, and all 27 chamber
seeds are retained.** Six independent mask definitions were built and cross-checked; the
three that satisfy the rule agree. The RV is still out of range, and it is no longer a
mask problem.

**The data bug that made round two look like a failure.** The `voxel` field on a tag-99
mark is corrupt — it disagrees with `model_point_mm` by p50 2.40 mm, p90 9.62 mm, max
13.56 mm, and no affine relates them. `vhl_label_tool_3d.classify(point, barrier ? 10 : 3)`
searches up to ten steps of the 128^3 hit grid outward from an outside-surface click for a
voxel flagged CAVITY, and returns the first one found — which is routinely on the far side
of the wall, inside a chamber. A mark meaning "not lumen" was being snapped into lumen.
`model_point_mm` records the true click and is sound. Details in NOTES.md §5d.1.

**Run as delivered: RV 165.6 mL**, down from 238, still wrapping at 67 x 94 x 126 mm
against a whole heart of 110.8 x 122.4 x 148.4. Projecting the dropped barrier seeds onto
the nearest cavity voxel gave **RV 98.5 mL, inside 60-100 — and that number was wrong.**
The barrier then held 235.1 mL of the 437.7 mL cavity, 69.1 mL of it wider than 3 mm
clearance, in blobs of 28.8 and 21.9 mL. It had eaten the chambers. Recorded rather than
reported as a pass, because it is the same shape of error as the retraction in §5c.1.

**The fix, and it is the owner's own rule.** "If there is wall between a chamber and a
mark, the mark must not affect that chamber" is a statement about visibility, and
visibility is a per-voxel property with no race in it. `pipeline/vhl_mask_occlusion.py`:
a free voxel is outside iff an unobstructed straight segment reaches some mark. It
removes **31.7 mL of 437.7, of which only 1.74 mL is wider than 3 mm** — the film, and
almost nothing else.

| tag | mL | expected | comps | bbox mm |
|---|---|---|---|---|
| LV | 89.1 | 60-100 | 1 | 47.6 x 83.3 x 87.9 |
| RV | **216.9** | 60-100 | 1 | 84.4 x 112.0 x 126.3 |
| LA | 43.8 | 25-45 | 1 | 50.4 x 96.5 x 58.5 |
| RA | 37.1 | 25-45 | 1 | 67.0 x 72.8 x 67.8 |
| Aorta | 11.7 | 15-25 | 1 | 24.8 x 26.3 x 56.6 |
| PA | 0.0 | 15-25 | 0 | no seed, expected |

**Six masks, and what they agree on.** Occlusion, a rim watershed splitting the tissue
surface into epicardium and endocardium, ray parity against a spherical-harmonic fit to
the marks, a solid-angle enclosure field, a Hoppe SDF from mark normals, and a sealing
shell of balls on the marks. **The LV is 89.1 mL in four of them, to 0.1 mL** — it is a
genuinely closed cavity, so every definition finds the same space, and that is the
strongest result on this branch. **The RV is 210-217 mL in all three that satisfy the
containment rule.** Enclosure and the SDF fail it (37 and 67 marks inside) and their
numbers are discarded rather than averaged. The seal shell fails the other way: it needed
r = 17.25 mm to bridge a mark spacing that reaches 13.7 mm, against a 25th-percentile wall
thickness of 2.5 mm, so it ate the wall — RA and aorta empty, 10 of 27 seeds left. Its
in-range LV and RV are the residue of a destroyed partition. Full table in NOTES.md §5d.4.

**The RV, measured three ways, and not resolved.** It is one component that survives
erosion to 6 mm as a single piece. It is **not** a wrap: from the LV centroid, 1,000 rays
first meet the RV in **25.7%** of directions, which is a septum plus part of a free wall;
the 3D preview that looked like a wrap was a splat-renderer projection artefact. Only
18.9 mL sits above the aortic seed where the envelope bridges the inter-vessel gap.
**But the largest inscribed sphere in the model, 17.3 mm, is inside the RV label, and the
LV label reaches only 13.8 mm** — in a real heart the left ventricular cavity holds the
larger sphere, and §1 recorded that 17.75 mm figure as LV-scale. So the RV seed set bounds
something bigger than a right ventricle, the model offers no neck to cut it at, and
**nothing has been retagged: that is the observer's call.**

**The anatomy gates: measured, and they refuse more than §6 said.** `anatomy.py` was
called, never modified, against throwaway meshes carrying exactly the tags a VHL partition
can supply. It needs **five fabrications, not three**: valve bands 7-10, a pulmonary artery
at tag 6, an SVC at 16, an IVC at 17, and a `Z` field. Without tag 6,
`identify_valve_planes` raises on the pulmonary valve; without tags 16 and 17,
`derive_cardiac_frame` raises on the cavae. **After fabricating all five, at most two of
the nine checks measure anything** — check 3 outright, check 4 with a caveat; the other
seven are circular or rest on invented structures. Running them would yield a 9/9 pass
meaning almost nothing. **They were not run.** Ladder and per-check breakdown in NOTES.md §6b.

**Two adversarial challenges, both adjudicated with new measurements (NOTES.md §5d.6).**
"The RV is a wrapping sheet" is **overruled**: only 6.6 mL of the 216.9 mL RV sits at
outside-the-heart depth on the detour field, against 128.1 mL beyond 50 mm, and the LV has
0.0 mL below 20 mm. A bounding box cannot tell a crescentic RV from a sheet. "The marks are
dispensable" is **half right**: a 1.5 mm opening with no marks at all gives RV 216.7 but
leaves 10 of 553 marks inside and costs the LV 8 mL, and no radius reaches zero — 2.0 mm
still leaves 7 inside and takes 11 mL off the LV. The fitted surface is dispensable; the
observer's marks are not. The no-mark baseline reproduces round one's RV at 238.1 mL exactly,
which checks that nothing else drifted.

**Written this session.** `pipeline/vhl_mask_occlusion.py`, `vhl_mask_rimwatershed.py`,
`vhl_mask_rayparity.py`, `vhl_mask_enclosure.py`, `vhl_mask_sdfnormals.py`,
`vhl_mask_sealshell.py` — all new modules. `output/vhl-partition/pack-orientation.proposed.md`
is the fifth proposed delta, owed since 00:30 and now written: the declared orientation is
wrong by 37.6 / 77.9 / 65.3 degrees, declared "up" points mostly posterior, and the whole
declared basis is one 77.9-degree rotation from the measured one. Proposed only; nothing
under `public/packs/` has been touched.

**Gates.** `npm run check:fast` green, exit 0. `anatomy.py` and `view_candidates.py` read
and called, never modified. No tracked file outside `pipeline/` and `output/vhl-partition/`
has been changed. Derived outputs stay compressed — the labels are 566 KB.

**Environment correction, repeated because HANDOFF.md still says otherwise.**
`~/Library/CloudStorage` is **not** blocked for the agent process on this machine; `stat`,
`head` and a full `json.load` of the Drive pack folder all succeed. The seed file was read
directly from Drive. Nothing was written there.

## 2026-08-21 01:43 ET — round-two barrier seeds run; RV leak stops, a barrier leak starts

**State.** The round-two seed file is in. It carries **553 marks, all tag 99** and no
chamber seeds, so it is the barrier coat only; the 27 round-one chamber seeds were
merged with it into `seeds.observer-A-round2.merged.json` on the owner's confirmation.
Both files are at resolution 384 on the same pack, no voxel collides, and the merge is
recorded in the file's own `provenance` field so it is not mistaken for one export.

**Run as given: RV 165.6 mL** against an expected 60-100, down from 238 but still
wrapping — bounding extent 67.0 x 93.7 x 125.5 mm against a whole-heart 110.8 x 122.4 x
148.4.

**Why it only half-worked, and it is not the observer's fault.** Only **149 of the 553**
barrier marks landed in the chamber space at all. 321 landed in tissue and 83 outside the
envelope; `flood` silently drops any seed not already in `space`, so **73% of the
observer's marks did nothing.** The marks are clicks on the epicardial *surface*, which
the labeller snaps to the nearest surface point — and that point is tissue, not the film
beside it. Every missed mark is 0.39 to 0.67 mm from space, one to two voxels. This is the
same class of bug as "the barrier label first rejected the clicks it existed for", one
layer further down: the tool now accepts the click and the partition module discards it.

**Projecting each dropped seed onto its nearest chamber-space voxel** recovers all 553.
That is a seeding fix, not a flood weighting — `flood` is untouched. It is safe: every
projected barrier seed lands at clearance <= 1.16 mm, while the lowest chamber seed sits at
1.40 mm, so no barrier mark lands inside a chamber. With it, RV is **98.5 mL, inside the
60-100 range**, single component, extent 65.1 x 79.0 x 115.4 mm.

**The partition is NOT done, and the RV number must not be read as a pass.** With the
barrier active the flood is a race in both directions, and the barrier now wins territory
it should not. Its 235.1 mL of the 437.7 mL space includes **69.1 mL at clearance greater
than 3 mm** — space too wide to be film — as 187 blobs whose largest two are **28.8 mL and
21.9 mL**. Those are chamber-sized cavities tagged "not lumen". 37% of all wide space in
the model (69.1 of 187.6 mL) is inside the barrier. Cross-sections show it directly: every
chamber label is a compact blob, but each sits inside a larger unlabelled cavity with a
white halo the barrier took. LV falls to 50.9 mL and RA to 15.6 mL, both below range, for
that reason.

**So the leak did not stop; it reversed.** The barrier reaches the chamber interiors
through the trabecular interstices exactly as the RV previously reached the outside
through the film. A boundary decided by which label arrives first is not a boundary. RV
98.5 mL is the outcome of that race and is not evidence the space is correctly defined.

**Next step is the one already written down: fix the mask.** Per HANDOFF, define chamber
space by ray parity against a smoothed epicardial surface rather than the morphological
`epicardial_envelope`, which bridges the AV groove and the gaps between vessels. The 553
barrier marks are now useful as something better than seeds: they are a 553-point sample
of the true epicardial surface, placed by a person, and they can constrain that surface
directly. New module; `vhl_seed_partition.py` keeps reproducing the recorded numbers.

**Environment correction.** `~/Library/CloudStorage` is **not** blocked for the agent
process on this machine — `stat`, `head` and a full `json.load` of the pack folder all
succeed. `~/Downloads` untested. The HANDOFF note to ask for a paste is wrong as written
and should be narrowed or dropped.

**Gates.** `npm run check:fast` not yet re-run this session; no tracked file outside
`output/vhl-partition/` has been modified. `anatomy.py` and `view_candidates.py` unread
this session and unmodified. The nine anatomy checks remain correctly unrun — the
partition they gate on is not established.

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
