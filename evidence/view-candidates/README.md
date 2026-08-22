# Rodero view-coordinate candidates

**Last Updated:** 2026-08-22 14:01 EDT

This directory holds review evidence for **Draft Rodero view coordinates**. A candidate is a
machine-authored or manually authored probe pose, fan, and optional sweep bound to one exact source
pack revision. It is evidence for technical and later clinical review; it is not pack content and
does not change `views[].provenance.vetted`.

## Authority and claim boundary

- The candidate coordinates are technical proposals. Their authority is limited to the derivation
  and checks recorded in the current generated candidate set.
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

## Editable generated candidate sets

Candidate-set files are working generated evidence, not permanent review records. An intentional
change to a pose, fan, sweep, derivation, or machine check may regenerate and replace the current
file in place. Keeping a stable id and path makes the authoring-review workflow easy to repeat; it
does not give old bytes continuing authority. Every generated set still binds itself to the exact
source pack id and version, source and pack-asset digests, source-pack Git revision,
coordinate-frame basis, and hashes of the generator's complete derivation-file closure. Its
internal digest covers canonical JSON with the digest field set to `null`. Newly derived origins
and basis vectors are serialized to nine decimal places so insignificant process- or
BLAS-dependent last-bit drift does not churn the file. Existing pack poses are copied exactly
rather than quantized.

[`registry.json`](registry.json) is a separate **current-digest registry**. It pins the exact
file-byte digest and canonical-payload digest expected for each generated set in the checkout. It
also pins `evidence_revision`, the ancestor commit containing those immutable set bytes and the
derivation-file closure they record. A regeneration must update the set and its registry entry
together. For live evidence, the Node content gate checks derivation files in the checkout. For a
superseded set, it proves both source-pack and evidence revisions are ancestors, requires the
historical evidence bytes to match the registry and current immutable file, and checks derivation
files at `evidence_revision`; a later `sources.py` edit therefore cannot rot truthful historical
evidence. The gate does not recompute raw-source geometry. The version-matched Python `--check`
remains the source replay boundary and must pass before current coordinates are shared for
assessment. Assessment sidecars bind exact candidate digests, so an old assessment cannot silently
follow regenerated coordinates.

`candidate-set-001.json` is the earlier generated comparison baseline. Visual review of that
generation showed tissue touching or crossing the B1, B4, F1, and B2 fan sides despite unused
distal room. `candidate-set-002.json` is the current working generation. It preserves each proposed
imaging plane and axis while moving apertures backward along their beams and extending focus/depth
only as measured.

For B1, B4, F1, and the seven unselected B2 variants, set 002 requires the complete tetrahedral
source clipped to the same +/-12 mm imaging slab to fit inside `1 / 1.12` of either fan half-width;
depth then leaves 5 mm beyond the farthest admitted point. B2 keeps one common shift, depth, and
focus across all seven comparison variants. B1 is an explicit same-id Draft replacement
candidate. The loaded pack and its B1 sweep remain unchanged.

C1 and C2 deliberately use a narrower **distance-only** policy. Each aperture moves backward by
about 22 mm until the complete checksum-bound source is at least 30 mm forward of the reference
aperture plane. Their authored 70-degree probe heads, beam axes, lateral axes, and imaging planes
remain unchanged. Focus moves with the aperture to preserve the world-space focus, and depth grows
only enough to retain a 5 mm distal guard. The resulting C1 and C2 fans do not contain the complete
lateral heart envelope; the generated checks record that miss without treating it as a distance
failure. Choosing different probe heads or wider fields of view is explicit later work.

The C1 tilt check holds the corrected aperture fixed. Physical source separation remains at least
30 mm and all source geometry stays forward and within depth throughout the tilt, although forward
projection onto the tilted beam can fall below 30 mm. The C2 translation axis is orthogonal to the
beam and lateral axes, so its full translation preserves the 30 mm forward separation while depth
is checked across the swept corridor. `authoring-slots/v1` carries only each corrected fixed pose;
it does not transport or replace the loaded pack's sweeps.

The 30 mm round number is a provisional **adult Rodero visual-layout proxy**, informed by published
mean shortest skin-to-heart distances of 31.3 +/- 11.3 mm apical and 32.1 +/- 7.9 mm parasternal in
150 standing adults ([Rahko 2008, PMID 18187292](https://pubmed.ncbi.nlm.nih.gov/18187292/)). It is
not a measurement of a chest wall the source does not contain, a patient-specific distance, a
pediatric default, or a clinical acquisition standard; the reference distance also varied with
BMI. The aperture gap is distinct from fan-side clearance: one measures forward separation from
the aperture plane, while the other measures separation from a fan edge inside the slab. These are
machine geometry checks, not acquisition or clinical validation. Replay both current generations
with:

```sh
conda run -n cardiology-app python pipeline/view_candidates.py --check
conda run -n cardiology-app python pipeline/view_candidates_v2.py --check
```

Candidate files contain coordinates and derivation evidence only. They contain no review promotion
and no reviewer identity.

## These sets are SUPERSEDED, and that is not the same as stale

The corrected poses these sets proposed were **adopted into the pack on 2026-08-22** (owner
decision). `normal-rodero` moved to v0.1.2 and then, after the apertures were migrated to the
reference chest wall, to v0.1.3. The sets still describe pack **0.1.1** at revision `770d5d2a`, and
they are byte-unchanged.

That is the proposal succeeding, not the evidence rotting, and the checker was changed to say so.
`check-view-candidates` used to require the CHECKED-OUT pack to still hash to the pinned digest,
which meant a project could never act on its own evidence without deleting it. A superseded set is
now validated against the pack **at its bound git revision**, read from git, with ancestry and
digest as the integrity proof, and the gate prints:

```
superseded: describes pack 0.1.1 at 770d5d2aa65f; the checkout is 0.1.3.
```

**Do not regenerate these sets to "fix" the binding.** `pipeline/view_candidates_v2.py` reads the
pack's CURRENT view poses as its `original_probe`, so re-running it after an ingest re-applies the
same correction to an already-corrected pose. The 22 mm retreat these sets propose would become
roughly 44 mm. If a genuinely new candidate set is needed, it has to start from a pack revision
whose poses have not already had the correction applied.

## Visual-review session carriers

A generated candidate set is deliberately not mounted as runtime content. A separate
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
which carries twelve set-002 probes: the B1, C1, C2, B4, and F1 Draft proposals in their standard
slots plus the seven unselected B2 variants in `custom-1` through `custom-7`. Its B1, C1, and C2
rows are browser-local saved overrides for visual review. The carrier contains no sweeps, so the
loaded pack remains the only source for sweep definitions.

Verify the checked carrier against the current registered candidate set:

```sh
./node_modules/.bin/tsx scripts/build-view-candidate-review-session.ts \
  evidence/view-candidates/normal-rodero/pack-0.1.1/candidate-set-002.json \
  evidence/view-candidates/normal-rodero/pack-0.1.1/review-session-002.authoring-slots-v1.json \
  2026-08-21T01:42:00.000Z --check
```

Running the command without a mode previews the carrier on stdout. `--write` validates the input
and atomically writes or replaces the named review-session file; `--check` requires the checked
file to match exactly. The writer refuses output outside the repository, refuses to overwrite its
candidate-set input, and accepts only the expected `review-session-NNN.authoring-slots-v1.json`
filename pattern.

The current authoring **Import** installs slots into browser-local IndexedDB; it is not a transient
Mount/Unmount overlay. Use a fresh localhost port or browser profile for a disposable review
session so imported slot ids cannot overwrite unrelated local authoring work. Import and Recall do
not write `pack.json`; selecting a populated slot now applies it immediately, while Recall remains
the way to restore an already selected slot after manual adjustment. The loaded pack remains the
source of runtime structures, sweeps, echo tuning, provenance, and review status.

Import copies the carrier into browser-local storage. After regenerating or replacing a carrier,
refreshing the page is not enough: import that carrier again (or use a fresh browser profile/port)
to see its current coordinates.

## Separate assessment sidecars

Every assessment is a separate JSON sidecar derived from
[`assessment-template.json`](assessment-template.json). The sidecar identifies the candidate set
and both its exact file-byte SHA-256 and internal canonical-payload SHA-256, records
the assessor role without a personal name, scopes every finding to an assessment axis, and keeps
`effect_on_pack_review_status` equal to `none`. Before the first real assessment is committed, its
sidecar schema and binding checker must be added to the content gate; the template alone is not a
validated assessment. If a candidate is regenerated, a prior sidecar remains evidence about the
older exact bytes and is not an assessment of the current registered set.

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
