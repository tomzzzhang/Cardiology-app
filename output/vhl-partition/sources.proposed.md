# Proposed delta — `pipeline/sources.py`

**Last Updated:** 2026-08-22 07:13 EDT

Target document: `pipeline/sources.py`, the `normal-vhl-heart0102` source entry.
Written as a proposal, not applied. **The owner applies it or discards it.**

Nothing here reverses the 2026-08-19 rejection. Two of its three grounds — CC BY-NC 4.0
licensing and unverified orientation — are untouched by this experiment, and the third is
refined rather than removed. Evidence is in `output/vhl-partition/NOTES.md`.

---

## Delta 1 — the debris count is correct but reads as more damning than it is

**Section:** `rejection=` string, the clause
`"1,026 connected components — trabecular islands and segmentation debris — render as voids through the tissue."`

**Change:** keep the figure; add what it costs to remove.

The 1,026 figure reproduces exactly on the source STL under the repository's own
`geometry.component_count`. But 1,025 of those components enclose *negative* signed volume —
they are bubbles inside the tissue, not floating islands — and they are separable by a volume
threshold with a 4,986× margin and no populated bin in between across three orders of
magnitude. Removing them costs **2.63% of triangles and 0.155% of volume** and yields a
watertight single-component mesh.

Proposed added sentence:

> Measured 2026-08-20: 1,025 of the 1,026 components enclose negative volume and are separable
> by a volume threshold at a cost of 2.63% of triangles and 0.155% of volume, leaving a
> watertight single-component surface. This defect is remediable; it is not among the reasons
> to reject.

**Why this matters:** as written, the two defects read as equally weighted. They are not. If
this were the only defect the model would be usable, and a future reader deciding whether to
revisit the source should not have to re-derive that.

## Delta 2 — "no per-chamber structures" is accurate; "nothing can be shown per chamber" overstates

**Section:** `rejection=` string, the clause
`"A single undivided tissue body: one material, one echo label, no per-chamber structures, so nothing can be shown or hidden per chamber and a sweep has no ordered structure list to read out."`

**Change:** keep the whole clause. Add one sentence distinguishing "not modelled as structures"
from "not present in the geometry".

The chambers *are* present as space — about 425 mL of connected lumen at a 17.75 mm largest
inscribed sphere, correct scale for this age. What is absent is any *cut* separating them: every
valve orifice is modelled open, so the chamber space is one connected region continuous with the
outside. Distance-transform seeding splits it into two stable ventricle-scale lobes and no
further.

Proposed added sentence:

> Measured 2026-08-20: the chamber lumens are present as geometry (~425 mL connected, 17.75 mm
> largest inscribed sphere) but not as separable structures — every valve orifice is modelled
> open, so the chamber space is one connected region. A per-chamber partition therefore needs
> valve cut planes, which is an engineering problem rather than missing information. Not
> attempted past a two-lobe ventricular split; see output/vhl-partition/NOTES.md.

**Why this matters:** the current wording supports the inference "the information is not in this
source". That inference is wrong, and it is the kind of thing that quietly forecloses a later
decision. The rejection's *conclusion* stands either way.

## Delta 3 — provenance gap, unrelated to the rejection

**Section:** `pipeline/.cache/checksums.json`, and/or the VHL entry's `notes=` list.

The VHL source STL is **absent from `checksums.json`** while every other source is present. It
appears to have been acquired outside `fetch.py`, which is plausible since Sketchfab requires an
authenticated download that `fetch.py` does not perform.

Observed digest, for whatever record the owner considers right:

- `Heart102_Tissue.stl`
- SHA-256 `5843eb9619ff9644c1ded5dd2911d9bbdfd3e5e43c8d622ff753b83272f41402`
- 40,177,184 bytes

**Why this matters:** `AGENTS.md` requires source, licence, attribution and derivation records
for third-party material, and a reproducible acquisition path is part of that. This is a real
gap in an otherwise complete chain, and it is independent of whether the model is ever used —
worth closing even if the pack stays rejected and unpublished.

**Not proposed:** adding the STL to the repository. It is CC BY-NC 4.0 and stays out, per the
uncertain-rights rule. Only the checksum record is proposed.

## Delta 4 — the bodyparts3d donor is described inaccurately

**Target:** wherever `anatomy-bodyparts3d-heart` is characterised as a label donor — the
handoff brief for this unit stated it "lacks ventricular myocardium and models lumen as solid
casts, so it can carry at most part of the labels". Both halves need correcting.

**Measured 2026-08-20 from the committed pack** (`public/packs/anatomy-bodyparts3d-heart/pack.json`,
119 structures):

1. **It does not lack ventricular myocardium.** `free-wall-of-left-ventricle`,
   `free-wall-of-right-ventricle`, `anterior-wall-of-left-ventricle`,
   `inflow-part-of-left-ventricle`, `outflow-part-of-left-ventricle`, `wall-of-left-atrium`,
   `wall-of-right-atrium`, papillary muscles and valve leaflets are all present as named parts.

2. **It carries a 1:1 cover of tags 1–6**, all flagged `blood_pool: true`:

   | tag | structure | volume |
   |---|---|---|
   | 1 LV | `cavity-of-left-ventricle` | 97.9 mL |
   | 2 RV | `cavity-of-right-ventricle` | 117.0 mL |
   | 3 LA | `cavity-of-left-atrium` | 51.9 mL |
   | 4 RA | `cavity-of-right-atrium` | 84.6 mL |
   | 5 aorta | `ascending-aorta` | 21.5 mL |
   | 6 PA | `pulmonary-trunk` | 19.2 mL |

   Plus `superior-vena-cava`, useful for registration coverage though not one of the six tags.

3. **The solid casts are an advantage for this use, not a limitation.** A cast is the shape of a
   lumen, and lumen space is what a void-based partition of a tissue-only source recovers. Cast
   against lumen is a like-for-like match; it is myocardium-against-myocardium that would be the
   hard direction.

**Why this matters:** the brief's characterisation reads as a reason to treat the donor as a
partial fallback. On the measurements it is the single most promising route to identification,
and the reason it did not work here is a **pose-search failure, not a content failure** — PCA
initialisation is degenerate on a near-ellipsoidal cavity and all four proper-rotation starts
converge within 0.05 Dice (see NOTES.md §5b.1). That is a fixable problem and worth someone's
time; "the donor cannot carry the labels" would wrongly close it off.

**Not proposed:** any change to the donor pack itself, or to its published/vetted status.
