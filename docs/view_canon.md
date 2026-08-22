# View canon — pediatric TTE views and sweeps

**Last Updated:** 2026-08-22 10:33 EDT

> **Clinical view/sweep specification.** Clinical collaborators are referred to by role, not name. The backing research report lives in the owner's planning folder.

**STATUS: DRAFT — NOT YET VETTED.** Every view below carries the draft flag until the clinical vetter and an imaging attending sign off (vetting checklist at the bottom). Anchored on the 2024 ASE comprehensive pediatric TTE guideline.

## What this doc is

The structured, machine-encodable canon of standard pediatric TTE views and sweeps, plus per-lesion essential views for the MVP anatomies (Normal, ASD module, d-TGA) and queued DORV. It feeds: the content-pack schema (view/sweep definitions), the engine's display rules, per-view simulated-echo targets, and the vetting checklist. `mvp_scope.md` sets the floor: every anatomy ships ALL standard views plus scrubbable sweeps; per-lesion emphasis is metadata assigned at vetting, never hardcoded.

## Authority and conventions

- Primary source: ASE 2024 pediatric TTE guideline (Lopez L, Saurers DL, Barker PCA, et al., J Am Soc Echocardiogr 2024;37(2):119-170; PMID 38309834) — Table 9 (probe poses), Table 8 (sweep/clip protocol), Table 11 (dextrocardia); illustrated sweep definitions carried forward from Lai 2006. Level of evidence C (expert consensus); the guideline does not mandate view order.
- Probe pose encoding: placement landmark + indicator direction as a clock position on the chest (12 = head, 3 = patient left, 6 = feet, 9 = patient right). Clock positions are INITIAL poses, not full sweep kinematics (the guideline's own simplification).
- Display rules (engine render flags):
  - Anatomically correct orientation: superior/anterior at top, rightward structures on screen-LEFT.
  - Subcostal and apical families render vertex-DOWN (apex-down) — pediatric convention, unlike most adult labs.
  - PLAX exception: apex always on screen-left (holds in levocardia and dextrocardia).
  - Apex-up/apex-down is a user toggle (2023 ASE pediatric cardiac POCUS statement permits either by local practice); pediatric default as above.
  - Dextrocardia = alternate indicator profile (Table 11), stored per pack, default off in MVP.
- Plane encoding: the cut plane is DERIVED from the pack's full probe pose (see `docs/build_plan.md` schema: probe origin, beam/lateral axes, fan geometry). A sweep is a swept pose: `{mode, axis, range, interpolation, ordered structure list crossed}`.
- The learner's free anatomical cutter is a separate runtime inspection object (`{N, s}` in `docs/build_plan.md`), not a view definition. **Align free cut to echo view** copies geometry into the cutter without modifying the saved draft definition.

## Per-view schema (feeds pack schema)

```
{ family, view_id, name, aliases[], placement_landmark, indicator_clock,
  probe: {origin, beam_axis, lateral_axis, fan{angle_deg, depth_cm, focus_cm},
          display{vertex, flip_lr, marker_side}},
  sweep?: { mode, axis, range, interpolation, structures_in_order[] },
  structures[], measurements[], lesion_attachments[],
  show_hide_preset, echo_tuning, real_clip_slot, emphasis (vetting-set),
  provenance {vetters[], date, draft_flag} }
```

## The taxonomy

### Family A — Subcostal (subxiphoid). Patient supine, knees flexed. Vertex-down.

- **A1. Coronal situs view** — abdomen between xiphoid and navel; indicator 3:00. Transverse plane: spine, IVC (anterior-right of spine), descending aorta (left of spine), liver, stomach → abdominal situs + cardiac position. No sweep; anchoring plane.
- **A2. Sagittal IVC/DAo view** — same placement; indicator 12:00. Longitudinal IVC→RA connection; abdominal aorta. (Azygos prominence behind DAo → interrupted IVC teaching point.)
- *(**A3 and A4 are NOT authored in the Rodero Normal pack, and the reason is structural.** The subcostal family is defined by the beam entering from below the diaphragm — that is what puts the atrial septum near-perpendicular to it, which is A3's whole teaching payload. "Below" is a body axis, and a heart-only mesh carries no spine, diaphragm or chest wall: three defensible proxies for body superior-inferior disagree by up to 46 degrees on this substrate. A guessed placement renders a plausible sector whose stated claim is false, which is worse than an absent view. A4's bicaval PLANE is derivable here — the caval stubs and the right atrium are all measured landmarks — so **F1, the right parasternal bicaval, is the honest route to that content** on this substrate. Unblocked by a torso-bearing substrate or by a clinician placing the window.)*
- **A3. Coronal (long-axis) view + sweep** — below xiphoid; indicator 3:00. Sweep posterior→anterior: atrial septum + pulmonary veins to LA → LV long axis, AoV, ascending aorta (SVC right of AAo, MPA left) → RV inflow/outflow + pulmonary valve. Structures: coronary sinus, atrial septum (near-perpendicular to beam — best atrial-septal window), AV connections, LVOT, RVOT, anterior muscular septum, VA connections. Protocol clips: 2D+color IVC→RVOT; focused low-Nyquist atrial-septal sweep.
- **A4. Sagittal (short-axis) view + sweep** — below xiphoid; indicator 6:00. Reference = bicaval (SVC + intrahepatic IVC → RA; atrial septum between RA and LA). Sweep rightward→leftward: bicaval → ventricular base/AV valves with AoV in cross-section → LV/MV cross-section + RVOT/PV → midmuscular septum, LV papillary muscles, apex. Key: RUPV courses inferior to RPA, posterior to SVC, into LA. Protocol clips: bicaval→apex sweep; atrial-septal low-Nyquist sweep; RUPV clip; RVOT clip ± PW/CW.
- **A5. Right anterior oblique (RAO)** — canonical name; aliases "TET view", SEROV, subcostal RV-3-chamber. From coronal, rotate counterclockwise; indicator 2:00. RV inflow + RV outflow in one plane + en-face AoV; shows conal (infundibular) septum deviation. Lesion attachments: TOF/conotruncal, DCRV; perimembranous VSD (TV–AoV fibrous continuity).
- **A6. Left anterior oblique (LAO)** — from coronal, rotate clockwise; indicator 5:00. En-face AV valves, atrial septum, LVOT. Lesion attachment: AVSD (common AV valve en face, balance assessment).

### Family B — Apical. Left lateral decubitus. Vertex-down.

- **B1. Four-chamber + sweeps** — cardiac apex, lateral; indicator 3:00. *(First draft encoding shipped in the Rodero Normal pack, `b1-apical-four-chamber`: pose derived from the measured cardiac frame — apex from the source's universal ventricular coordinates, plane through the apex and both AV ring centroids. Unvetted. The substrate has valve RINGS but no leaflets, so leaflet motion, the crux offset as read from leaflet insertion, and TR-jet measurements are not demonstrable on it yet; `structures_in_order` is now MEASURED — the structures whose geometry the fan intersects, in the order the sweep first reaches them, restricted to structures that have names. That is arithmetic over the geometry, not the canon's list of what a clinician would call out, and the pack's provenance says which of the two it is.)* Reference: four chambers, TV and MV offset at crux. Sweeps: posterior tilt (coronary sinus; IVC/hepatics→RA); anterior tilt (LVOT/RVOT, semilunar valves — the "five-chamber"); low-Nyquist ventricular-septal color sweep posteroinferior→anterosuperior (muscular VSDs). Structures/measures: TV/MV, TR jet → RVSP, septum, LV size/function, LA, ≥1 pulmonary vein.
- **B2. Five-chamber** — anterior angulation of B1: LVOT, AoV, proximal aorta (also SVC-type sinus venosus window).
- **B3. Two-chamber** — indicator 2:00. LV function; biplane LA volume + Simpson's with B1.
- **B4. Three-chamber (apical long-axis)** — indicator 11:00. Mitral-to-aortic fibrous continuity, LVOT, AoV morphology/gradients.
- **B5. RV-focused** — probe moved medially; indicator 3:00. RV size/function (TAPSE, FAC, RV GLS).

### Family C — Left parasternal. Left lateral decubitus. Vertex-up.

- **C1. PLAX + sweep** *(First draft encoding shipped in the Rodero Normal pack, `c1-parasternal-long-axis`: the plane through the measured apex, mitral ring and aortic ring — the LV long axis together with the aortic root — entered from the measured ANTERIOR axis. Unvetted. The apex is required to lie in the PLANE but not inside the sector, since foreshortening it is a property of the window rather than a defect. No leaflets, so MV/AoV morphology and root measurements are not demonstrable; the aortic wall is one tagged tube, so annulus/root/STJ cannot be distinguished.)* — mid left sternal border; indicator 10:00. Reference: LV long axis, apex screen-LEFT (the standing exception), MV–AoV continuity. Sweep: reference → rightward/inferoapical tilt = RV inflow variant (RA, TV, TR CW) → back → leftward/superior tilt = RV outflow variant (RVOT, PV, MPA). Structures/measures: MV/AoV morphology; AoV annulus, root, STJ, AAo diameters; RCA origin; dilated coronary sinus in posterior AV groove (→ LSVC flag).
- **C2. PSAX multi-level sweep** *(First draft encoding shipped in the Rodero Normal pack, `c2-parasternal-short-axis`: the plane perpendicular to the measured long axis, TRANSLATED along it from the aortic ring's level to 88% of the way to the apex — the canon's multi-level protocol as one slider. Unvetted. The levels are reachable but most of what they are named for is not on this substrate: no trileaflet AoV to see en face, no "fish-mouth" mitral orifice, no papillary muscles, no coronaries. What it does show is the chamber cross-sections and the septum, level by level.)* — indicator 2:00 (left shoulder). Protocol: AoV → apex → back to AoV → main + branch PAs. Levels, base→apex: (1) great-vessel/AoV level: trileaflet AoV en face ("Mercedes"), RVOT wrap-around, PV, MPA + bifurcation, LMCA→LAD/Cx and proximal RCA; (2) MV level ("fish-mouth"); (3) papillary-muscle level (M-mode/function level); (4) apex. Septal color sweep across all levels (VSD screen). Measures: PV annulus, MPA, branch PAs, coronary diameters.

### Family D — High left parasternal.

- **D1. Ductal view (sagittal) + sweep** — high left sternal border; indicator 12:00. Sweep right→left: ascending aorta long axis → MPA → proximal LPA → descending aorta. PDA sits at the LPA→DAo transition (good Doppler angle); profiles isthmus + posterior coarctation shelf (best CoA window when suprasternal is poor). Lesion attachments: PDA, coarctation.
- **D2. Transverse** — 90° clockwise from D1; indicator 3:00. Branch PAs (MPA→RPA/LPA); pulmonary veins/RUPV.

### Family E — Suprasternal. Supine, neck extended.

- **E1. Long-axis** — suprasternal notch; indicator ~12:00. Full arch ("candy cane") + head/neck branches (normal left arch: innominate → RCC + RSC). Measures: proximal/distal transverse arch, isthmus; PW/CW distal arch → DAo.
- **E2. Short-axis + sweeps** — indicator 3:00. Reference: AAo cross-section, SVC right, left innominate vein anterior, RPA posterior. Sweeps: superior + color (arch sidedness/branching); leftward of the innominate vein + color (exclude LSVC/vertical vein); inferior tilt + color = **"crab view"** (all four pulmonary veins → LA). Pitfalls to encode as teaching notes: RMPV ≠ RUPV; LA appendage ≠ LUPV. Lesion attachments: TAPVR/PAPVR, arch anomalies.

### Family F — Right parasternal. RIGHT lateral decubitus, right arm up.

- **F1. Sagittal (bicaval)** — right sternal border; indicator 12:00. SVC + IVC → RA, atrial septum near-perpendicular to beam. THE sinus-venosus-exclusion view (overriding SVC vs RA/LA); right pulmonary veins; also the highest-gradient aortic-stenosis Doppler window. Lesion attachments: sinus venosus ASD, PAPVR.
- **F2. Transverse** — high right sternal border; indicator 3:00. RUPV → LA below RPA level.

## Per-lesion essential views

### Normal heart (MVP pack 1)
The deliverable IS the full canon: all views A1–F2 with every listed sweep scrubbable. This pack is the substrate for the ASD sculpt and the reference for "mastering normal first."

### Secundum ASD (MVP pack 2a)
| Rim | Best view |
|---|---|
| Anterior / retro-aortic (aortic) | PSAX at AoV level (C2 level 1) — an en-face intricacy the clinical vetter flagged |
| Posterior | Apical 4C (B1) + PSAX |
| Anteroinferior (AV-valve) | Apical 4C |
| Superior (SVC) + inferior (IVC) | Subcostal coronal (A3) + sagittal/bicaval (A4); right parasternal (F1) as alternative window |

Teaching content: defect sized in orthogonal subcostal planes; deficient retro-aortic rim is common (~40%+ of cases); device rule of thumb ≥5 mm rims except aortic; RA/RV dilation on B1 as the volume-overload trigger; shunt direction on low-Nyquist color/PW.

### Sinus venosus ASD + RUPV PAPVR (MVP pack 2b)
- SVC-type defect: A4 (subcostal bicaval), F1 (right parasternal bicaval), B2 (5C) — communication at the upper-right LA/SVC junction above the true septum; overriding SVC.
- PAPVR (RUPV → SVC/SVC-RA junction): A4 (RUPV under RPA, behind SVC), F2, E2 right-sided sweep.
- Consequences: RA/RV dilation (B1). Note: ~90% of sinus venosus defects carry PAPVR — matches the module's chosen canonical variant.
- (IVC-type exists — encode as teaching note only in v1; canonical variant is SVC-type per the one-variant policy.)

### d-TGA (MVP pack 3)
| Must demonstrate | View(s) |
|---|---|
| VA discordance (PA from LV — posterior artery bifurcates; Ao from RV) | A3 outflow sweep, apical + PLAX |
| Parallel great arteries (no crossover) | C1 (PLAX), subcostal |
| Aorta anterior-rightward of PV ("two circles") | C2 level 1 |
| Coronary pattern (pre-arterial-switch) | C2 at aortic root, low-Nyquist color; PLAX for high origins; Leiden convention labels |
| Atrial-level mixing; restrictive septum → BAS urgency | A3 + A4 atrial-septal sweeps |
| VSD screen; posterior malalignment → LVOTO | C2 + C1 + subcostal low-Nyquist |
| Arch/PDA | E1/E2 + D1 |

Convention decision to flag at vetting: Leiden coronary nomenclature uses two viewing perspectives (imaging vs surgical); pick one and state it in-app.

### DORV, subpulmonary VSD / Taussig-Bing (queued pack 4)
| Must demonstrate | View(s) |
|---|---|
| Subpulmonary VSD, committed to PV | A4 base→apex sweep (THE window), C2, B1 anterior angulation |
| >50% commitment of both arteries to RV ("50% rule") | Subcostal short-axis preferred (long-axis tangent moves with cardiac motion), C2 |
| Bilateral conus; ABSENT pulmonary–mitral continuity (the TGA+VSD discriminator) | C1 + A4 |
| Side-by-side semilunar valves, Ao rightward | C2 |
| Arch obstruction association (CoA/IAA common) | E1/E2 + D1 |
| Coronaries pre-repair | C2 |

## Vetting checklist (per view, per anatomy — seed for the authoring-mode sign-off)

1. Probe pose plausible (placement landmark + indicator clock)?
2. Probe pose, derived plane, and finite wedge on the 3D model actually match the named view?
3. Reference-frame structure list complete, correctly labeled, nothing anachronistic for the lesion?
4. Sweep: correct axis, direction, start/end, and structure order?
5. Display orientation correct (vertex rule, rightward-to-screen-left, PLAX exception)?
6. Simulated echo: grey-level ordering, dropout/shadowing behavior, sector geometry — verdict "good enough to learn reading from" (pass/fail per `mvp_scope.md`)?
7. Per-lesion emphasis assignment; any missing lesion-specific view?

Sign-off stamps the vetters list into the pack provenance block and clears the draft flag.

## Known gaps / to verify at vetting

- Clock poses are simplified initial orientations; sweep kinematics come from the Lai 2006 figure descriptions and need attending sanity-check against real practice.
- "TET view" naming: ASE "subcostal RAO" is canonical; colloquials stored as aliases.
- ASD rim nomenclature varies across sources (aortic/retro-aortic; superoposterior/SVC); table follows the imaging-review consensus; do not conflate with TEE rim-angle maps.
- Lai/Snider textbook figure-level cross-checks pending; verify chapter/figure specifics against the physical books during vetting.
- Optional alignment: the 27-view pediatric AI ontology (PMID 36049595) as canonical label set if we ever want interop with published view classifiers.
