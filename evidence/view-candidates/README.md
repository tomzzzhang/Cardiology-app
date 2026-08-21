# Rodero view-coordinate candidates

**Updated:** 2026-08-20 22:49 EDT

This directory holds review evidence for **Draft Rodero view coordinates**. A candidate is a
machine-authored or manually authored probe pose, fan, and optional sweep bound to one exact source
pack revision. It is evidence for technical and later clinical review; it is not pack content and
does not change `views[].provenance.vetted`.

## Authority and claim boundary

- The candidate coordinates are technical proposals. Their authority is limited to the derivation
  and checks recorded in their immutable candidate set.
- [`docs/view_canon.md`](../../docs/view_canon.md) supplies the draft clinical vocabulary and
  guideline references. It is not evidence that any candidate pose is correct.
- [`contracts/authoring-mode.md`](../../contracts/authoring-mode.md) governs the route from a local
  pose to pack content. Saving, exporting, ingesting, or technically assessing a pose never promotes
  review status.
- A technical reviewer may report **machine-checked geometry**. A technical review is
  not clinical review and cannot mark a view `vetted`.

These records must not claim that a candidate is clinically valid, diagnostically validated,
safe for patient care, a physically reachable acoustic window, authentic pediatric anatomy, or an
accurate simulation of ultrasound appearance, motion, Doppler, or artifacts. Use wording such as
**Draft coordinate proposal** or **machine-checked geometry candidate**. Do not use unqualified
terms such as **valid**, **validated**, **vetted**, or **clinically accurate**.

## Immutable candidate sets

Once a candidate set is shared for assessment, do not edit it in place. A changed pose, fan, sweep,
source pack, coordinate frame, or derivation creates a new candidate-set id and file. Each set must
bind itself to the exact source pack id and version, source and pack-asset digests, source-pack Git
revision, coordinate-frame basis, and hashes of the generator's complete derivation-file closure.
Its internal digest covers canonical JSON with the digest field set to `null`. This makes every
assessment reproducible and prevents a review from silently following later coordinates.
Newly derived origins and basis vectors are serialized to nine decimal places so insignificant
process- or BLAS-dependent last-bit drift cannot change an immutable set. Existing pack poses are
copied exactly rather than quantized.

[`registry.json`](registry.json) independently pins both the exact file-byte digest and the
canonical-payload digest of every accepted set. Add a new entry for a new immutable set; never
change an existing entry to make an edited file pass. The Node content gate compares previously
committed registry entries and candidate bytes against every commit that changed the registry;
the first accepted set remains authoritative across later commits. Existing sets are append-only,
while new paths remain allowed. It also checks schema, Git and byte
bindings, canon coverage, and the registry locks. It deliberately does not pretend to
recompute raw-source geometry. Before a set is shared, its version-matched source-replay gate must
also pass in the named conda environment.

`candidate-set-001.json` is the first shared coordinate record and remains immutable. Visual review
showed tissue touching or crossing the B1, B4, F1, and B2 fan sides despite unused distal room.
`candidate-set-002.json` preserves every proposed imaging plane and axis, but moves each aperture
backward along its beam by a measured amount. Before depth is adjusted, every aperture is required
to leave the complete checksum-bound cardiac source at least 30 mm forward of its aperture plane.
That round number is a provisional **adult Rodero visual-layout proxy**, informed by published mean
shortest skin-to-heart distances of 31.3 +/- 11.3 mm apical and 32.1 +/- 7.9 mm parasternal in 150
standing adults ([Rahko 2008, PMID 18187292](https://pubmed.ncbi.nlm.nih.gov/18187292/)). It is not a
measurement of a chest wall the source does not contain, a patient-specific distance, a pediatric
default, or a clinical acquisition standard; the reference distance also varied with BMI. The
applied retreat is the greater of that proxy requirement and the measured fan-containment
requirement; F1 therefore remains farther away.

The fan check clips the tetrahedral source to the same +/-12 mm imaging slab and contains that
complete clipped volume inside `1 / 1.12` of either fan half-width. Depth then leaves 5 mm beyond its
farthest point. The aperture gap is distinct from the recorded minimum fan-side clearance: the
first measures forward separation from the aperture plane, while the second measures separation
from a fan edge inside the slab. B2 keeps one common shift, depth, and focus across all seven
comparison variants. B1 is an explicit same-id Draft replacement candidate; the pack's original B1
and sweep remain unchanged. These are machine geometry guarantees, not acquisition or clinical
validation. Replay both immutable generations with:

```sh
conda run -n cardiology-app python pipeline/view_candidates.py --check
conda run -n cardiology-app python pipeline/view_candidates_v2.py --check
```

Candidate files contain coordinates and derivation evidence only. They contain no review promotion
and no reviewer identity.

## Visual-review session carriers

An immutable candidate set is deliberately not mounted as runtime content. A separate
`authoring-slots/v1` carrier may extract its probe poses for visual inspection through the existing
authoring import boundary. The carrier is derived convenience data: it is not evidence, pack
content, a clinical assessment, or a selected canonical view.

[`normal-rodero/pack-0.1.1/review-session-001.authoring-slots-v1.json`](normal-rodero/pack-0.1.1/review-session-001.authoring-slots-v1.json)
maps B4 and F1 into their empty standard Draft slots and maps the seven unselected B2 variants to
`custom-1` through `custom-7`. It deliberately leaves the standard B2 slot empty and omits B1, C1,
and C2 because those exact baselines already come from the loaded Rodero pack. The carrier has no
`cardiac_frame`, sweeps, evidence checks, assessment state, or review promotion.

That first carrier is retained for comparison. The current visual-review carrier is
[`normal-rodero/pack-0.1.1/review-session-002.authoring-slots-v1.json`](normal-rodero/pack-0.1.1/review-session-002.authoring-slots-v1.json),
which carries ten margin- and aperture-gap-corrected set-002 probes: B1, B4, and F1 in their
standard slots plus the seven unselected B2 variants in `custom-1` through `custom-7`. Its B1 row
is a local saved override for visual review; C1 and C2 still come unchanged from the loaded pack.

Verify the checked carrier against the accepted immutable candidate set:

```sh
./node_modules/.bin/tsx scripts/build-view-candidate-review-session.ts \
  evidence/view-candidates/normal-rodero/pack-0.1.1/candidate-set-002.json \
  evidence/view-candidates/normal-rodero/pack-0.1.1/review-session-002.authoring-slots-v1.json \
  2026-08-21T01:42:00.000Z --check
```

`--write` creates a new carrier with exclusive-create semantics; it never overwrites an existing
review-session file.

The current authoring **Import** installs slots into browser-local IndexedDB; it is not a transient
Mount/Unmount overlay. Use a fresh localhost port or browser profile for a disposable review
session so imported slot ids cannot overwrite unrelated local authoring work. Import and Recall do
not write `pack.json`; selecting a populated slot now applies it immediately, while Recall remains
the way to restore an already selected slot after manual adjustment. The loaded pack remains the
source of runtime structures, sweeps, echo tuning, provenance, and review status.

## Separate assessment sidecars

Every assessment is a separate JSON sidecar derived from
[`assessment-template.json`](assessment-template.json). The sidecar identifies the immutable
candidate set and both its exact file-byte SHA-256 and internal canonical-payload SHA-256, records
the assessor role without a personal name, scopes every finding to an assessment axis, and keeps
`effect_on_pack_review_status` equal to `none`. Before the first real assessment is committed, its
sidecar schema and binding checker must be added to the content gate; the template alone is not a
validated assessment.

The axes are independent:

- `geometry_anatomy`: finite-sector placement, modeled structure intersections, and sweep geometry;
- `acquisition_window`: physical probe placement and acoustic-window plausibility;
- `display_orientation`: pediatric display and marker conventions;
- `educational_use`: whether the result is suitable for the stated learning task;
- `clinical_diagnostic`: formal diagnostic performance, which is not established here.

A geometry result must not imply a result on any other axis. Use `not_assessed`, `not_evaluated`,
`not_assessable`, `machine_checked`, `human_reviewed_pass`, `human_reviewed_fail`, `indeterminate`,
or `invalidated` as applicable. A technical sidecar may recommend `advance_to_clinician_review`, `hold`, or
`reject_candidate`; none of those dispositions changes a pack. Any future promotion of pack review
status requires the separately authorized clinical-review workflow and an explicit pack change.
