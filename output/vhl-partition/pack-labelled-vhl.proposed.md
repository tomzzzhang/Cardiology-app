# Proposed — introduce the labelled heart as a SEPARATE pack

**Last Updated:** 2026-08-22 11:52 EDT

Written as a proposal, not applied. **The owner applies it or discards it.**
Nothing here reverses the 2026-08-19 rejection, and nothing here publishes
anything.

---

## 1. The recommendation, in one line

Add a new pack `normal-vhl-heart0102-chambers` beside the existing
`normal-vhl-heart0102`, registered as unpublished for a LICENCE reason and not a
substrate one, leaving the rejected pack untouched as evidence.

## 2. Why a separate pack, not a replacement

Three reasons, in order of weight.

**The existing pack is evidence.** `src/packs/published.ts` keeps the wave-1a
losers "so the comparison remains reproducible and auditable". Overwriting the
rejected pack with a labelled one destroys the artefact the 2026-08-19 verdict
was reached against, and the verdict's own wording — "one material, one echo
label, no per-chamber structures" — stops being checkable.

**The provenance is different in kind, not in degree.** Every other pack's
structure identities come from the source's own tags. These come from **one
observer's marks**: 27 chamber seeds, 553 barrier marks, ~11k corrections, two
traced valve rims, 375 groove strokes and 1,076 region points. `pack.json` has a
`modified.note` and a per-structure `blood_pool_decision.basis`, and the honest
values for a hand-seeded pack are different strings from the derived one. Mixing
them into one pack means one `modified.note` has to describe both.

**A derived pack is a normal thing for this repository to hold.** It already
ships nine packs of which two are published. Adding a tenth costs a registry
entry and a CI check that already exists.

## 3. What the pack would contain

| | |
|---|---|
| `meta.id` | `normal-vhl-heart0102-chambers` |
| `meta.display_name` | Healthy Pediatric Heart — Heart0102, chamber-labelled |
| structures | 6 lumen + 6 myocardium = 12 mesh nodes |
| `echo_volume` | `raw-u8` at 192³, labels 1–6 |
| `provenance.license*` | unchanged from the source: CC-BY-NC-4.0, `non_commercial` |
| `meshes.anatomical_frame` | **populated** — see §5 |

Current volumes, from `output/vhl-partition/seed-partition-round6.json` and
`wall-labels.npz`:

| | LV | RV | LA | RA | Aorta | PA |
|---|---|---|---|---|---|---|
| lumen mL | 82.1 | 148.3 | 37.0 | 75.0 | 11.6 | 20.7 |
| wall mL | 150.0 | 137.3 | 24.9 | 32.3 | 8.8 | 10.8 |
| expected lumen | 60–100 | 60–100 | 25–45 | 25–45 | 15–25 | 15–25 |

Every lumen is one connected component.

**The wall must be exported as six nodes, not one.** The review viewer carries a
single myocardium mesh with a per-vertex colour attribute, which is a rendering
optimisation: `packV0.ts` wants one `mesh_node` per structure so the app can show
and hide each. Splitting duplicates every shared interface and roughly doubles
the wall triangle count — that cost is the reason the viewer does not do it, and
it is the right trade in a pack.

## 4. Registry edits, precisely

**`src/packs/published.ts`** — add to `UNPUBLISHED_PACKS`, and NOT to
`PUBLISHED_PACK_IDS`:

```ts
'normal-vhl-heart0102-chambers': {
  licence:
    'CC BY-NC 4.0. Not published: a non-commercial pack binds the whole ' +
    'application to the non-commercial red lines, and that constraint is not ' +
    'accepted for the published build. Identical to the position on ' +
    'normal-vhl-heart0102, from which this pack is derived.',
},
```

Deliberately **no `substrate` key**. `NotPublished.substrate` records "why the
geometry lost the wave 1a comparison", and this pack was not in that comparison.
The two defects the comparison found are answered here; the licence is not.

**`pipeline/sources.py`** — the open question. `SOURCES` is keyed by source and
carries `pack_id` as a field, so one source produces one pack. Two options:

* a second `Source` entry sharing the acquisition fields and differing in
  `pack_id`, `rejection` and `notes` — simple, but duplicates the fetch;
* a `derived_packs` list on `Source` — cleaner, and a schema change.

**Recommend the second**, because more derived packs are coming: the labeller is
now a tool (`pipeline/labeller/`) and the intent is to use it on other models.
One source producing several labelled packs is about to be the normal case, not
the exception.

**`pack.json` fields that need honest strings**, not defaults:

* `provenance.modified.note` — must say the labels are hand-seeded, by whom, from
  how many marks, and that the six chambers are one observer's identification and
  not the source's.
* every structure's `blood_pool_decision.basis` — `authored` is the only correct
  value of the four the schema allows (`label_match`, `label_no_match`,
  `source_tag`, `authored`). The source carries no tags to read.
* `structures[].identified` — `true` is defensible for all twelve, but only
  because a person named them; the evidence string must say so.

## 5. Orientation — the one rejection ground that this changes

`normal-vhl-heart0102` ships `anatomical_frame: null` and "ORIENTATION
UNVERIFIED", because the source carries no chamber labels and the frame cannot be
derived from geometry alone. **With chambers labelled it can be, and it was.**
Measured from the observer's seeds, in the source's own coordinates:

| axis | direction | angle from the DECLARED axis |
|---|---|---|
| patient-left | `[ 0.792, -0.488, -0.366]` | 37.6° from `+x` |
| base | `[ 0.514, 0.210, 0.832]` | **77.9°** from `+y` |
| anterior | `[-0.329, -0.847, 0.417]` | 65.3° from `+z` |

Two supporting facts that were not used to build the frame: the raw LV→RV axis
and the raw ventricles→atria axis come out **89.4° apart** without being
orthogonalised, and the LA sits 42.3 mm posterior to the RA. One check fails —
the RA sits 11.4 mm patient-LEFT of the LA — and `AnatomicalFrame.checks` exists
to record exactly that; a failing check is allowed to be recorded and must not be
hidden.

`packV0.ts` enforces that `basis_source_to_pack` is orthonormal and right-handed.
**Verify the measured rows against that tolerance before writing the pack**; they
were orthogonalised, but the schema's threshold has not been checked against them.

## 6. What this does and does not change about the 2026-08-19 rejection

| ground | status |
|---|---|
| 1,026 connected components of debris | **answered** — 1,025 enclose negative volume, separable at a 4,986× margin, cost 2.63% of triangles and 0.155% of volume, leaving a watertight single component |
| no per-chamber structures | **answered for this derived pack** — six chambers, each one connected component, plus per-chamber myocardium |
| ORIENTATION UNVERIFIED | **answered for this derived pack** — §5 |
| CC BY-NC 4.0 | **unchanged, and it is the binding one** |

So the rejection of the ORIGINAL pack stands exactly as written: it describes an
artefact that still has those properties. What changes is that the defects are
now known to be remediable rather than intrinsic, and the remaining blocker on
the derived pack is licensing alone.

`mayBePublished` returns false for `non_commercial`, the production build filter
in `vite.config.ts` drops anything outside `PUBLISHED_PACK_IDS`, and
`scripts/check-published-packs.ts` fails CI if `dist/` disagrees. The pack is
therefore safe to hold in Git and unable to reach Pages by any route.
`PUBLIC_GIT_LICENSE_STATES` already admits `non_commercial`, and
`public_repo_eligible=True` is already set on this source, so committing derived
files needs no new policy decision.

## 7. Caveats the pack must carry, not bury

* **RV lumen 148.3 mL against an expected 60–100.** One connected component,
  survives erosion to 6 mm as one piece, and every mask definition tried put it
  between 205 and 238 mL before the valve work brought it down. It is not a mask
  artefact and it is not resolved.
* **RA lumen 75.0 mL against 25–45.** It carries the caval stubs and the atrial
  appendage. Tags 16 and 17 exist for the cavae and are unused.
* **LV wall : RV wall = 1.09 : 1**, against about 2.6 : 1 for `normal-rodero`.
  Three independent routes — thickness, volume, and now the drawn territories —
  agree this model carries no left-right wall asymmetry. A pack used to teach
  wall thickness would teach something false.
* **The endocardium renders about 4% wrong on the atria** — mesh spacing 0.775 mm
  against a 1.34 mm median wall half-thickness. The labels disagree nowhere; this
  is a resolution artefact of the review viewer and would not survive a
  full-resolution pack export.

## 8. The anatomy gates — the ladder has moved one rung

NOTES §6b measured what `anatomy.py` refuses, and concluded the gates need five
fabrications. **One of them is no longer fabricated**: there is now a real
pulmonary artery at tag 6, 20.7 mL, so `identify_valve_planes` no longer fails
for want of a pulmonary pair. What is still missing:

* valve rings 7–10 — the TAGS now exist (`vhl_tags.VALVES`, `VALVE_PAIR`) and the
  labeller can paint them, but no geometry has been drawn;
* an SVC at 16 and an IVC at 17 — the source has no caval stubs to tag;
* a per-point `Z` apicobasal field — and one derived from this partition makes the
  apex check partly circular.

**The recommendation stands: do not run the gates on a fabricated mesh.** Report
check 3 and, with a caveat, check 4, or report that the gates are not applicable.

## 9. Build steps, if it is approved

1. Draw the four valve rings in the labeller (tags 7–10), or decide to ship
   without them and record that the pack carries no valve planes.
2. Export twelve meshes at full resolution and a 192³ labelled
   `echo-volume.raw`, with the `mesh_to_volume` matrix, following
   `pipeline/ingest.py`'s existing pack writer rather than a new one.
3. Write `pack.json` with the strings in §4 and the frame in §5.
4. Register it per §4. Do not touch `PUBLISHED_PACK_IDS`.
5. Gate: `npm run check:fast` **and** `npm run check:content` — WORKFLOW.md
   requires the content gate for any pack, schema, source, licence or provenance
   change.

## 10. Not done here

No pack written, no registry edited, nothing merged, nothing pushed. The branch
`experiment/vhl-partition` holds the labels, the tool and the evidence; this file
is the proposal for what to do with them.
