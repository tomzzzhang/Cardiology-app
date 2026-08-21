# Rodero view-coordinate candidates

**Updated:** 2026-08-20 20:36 EDT

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
recompute raw-source geometry. Before a set is shared, the source-replay gate
`pipeline/view_candidates.py --check` must also pass in the named conda environment.

Candidate files contain coordinates and derivation evidence only. They contain no review promotion
and no reviewer identity.

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
