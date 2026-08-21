# Proposed delta — `pipeline/sources.py`

**Last Updated:** 2026-08-20 22:25 EDT

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
