# Contract: authoring mode

**Last Updated:** 2026-08-22 07:13 EDT

**Owns:** `src/authoring/**`, `scripts/ingest-authoring-export.ts`, and
`scripts/lib/authoringIngest.ts`
**Status:** implemented through the explicit authoring round trip: view-axis anchoring, monotonic
local-draft depth expansion, saved view slots, `authoring-slots/v1` export/import, and guarded
export-to-pack ingestion. The current UI uses the DRAFT view canon as a
temporary starter list, not a completeness requirement or clinical acceptance gate.

**No view defines the patient frame** *(owner decision, 2026-08-21)*. This surface used to treat the
apical four-chamber as special: saving it repointed the levelling axis, a `sets z axis` badge sat
beside the save button, and the export carried a `cardiac_frame` block. All of it is removed. An
imaging view states where a transducer goes, which is not evidence for which way is up. The
patient/body frame comes from a `body-context/v0` registration instead, and `Level` holds body `+Z`.
Old exports carrying `cardiac_frame` still import their poses; the block is parsed, reported
ignored, and discarded. `meshes.orientation` and `meshes.anatomical_frame` remain pack content with
their own recorded derivation and are still never overwritten by an ingest.
`scripts/check-frame-decoupling.ts` gates all of this repository-wide. Arbitrary working slots remain available locally, but the v1 ingest accepts only a
standard slot mapped to its existing pack view. Broader sweep and echo-tuning authoring remains to
be built. The learner bundle excludes this surface at the release boundary.
**Spec:** `docs/build_plan.md` v1.2 — "Architecture" (6); vetting checklist in `docs/view_canon.md`.

## Responsibility

Flag-gated tooling to place and tune probe poses, planes, and sweeps interactively against a loaded
pack; tune per-view echo params; and export pack JSON. Review promotion is a later integration phase,
not part of the current platform slice.

## Gating

Flag-gated as the primary platform work surface. The release learner bundle is a verified subset
with authoring absent; ordinary platform work does not wait on that release check.

## Rules

1. **Authoring mode is the only place a probe pose is authored.** It writes `views[i].probe`, and the
   plane and wedge are derived from that pose — never stored alongside it. One source of truth.
   `Place from camera` may expand the local working pose's `fan.depth_cm` to
   `max(source depth, measured minimum)`. It never shrinks the source, mutates the loaded pack, or
   runs in ordinary viewing. That draft value reaches pack content only through save, export, and
   the explicit ingest.
2. **The free anatomical cutter stays a separate object here too.** It is an inspection aid while
   authoring. Its `{N, s}` state is never promoted into `views[]`. If an author wants a view at the
   cutter's location, they author a *probe pose*; the cutter is not silently converted into one.
   `interaction.free_cut` — the pack's initial free-cut default — is the one free-cut value a pack may
   contain, and it is a viewer default, not view metadata.
3. **Export and pack validation are two explicit boundaries.** `authoring-slots/v1` is not a full
   pack. Every exported pose is validated with `ProbePose`, and the strict envelope records its pack
   id, exact source pack version, and pack-schema version. Ingestion then requires an explicit
   standard slot, existing target view, changed output pack version, exact source-revision/schema
   identity, and a `draft` target with no recorded review history. It invalidates the old
   pose-coupled placement description, then validates the complete candidate with `validatePack`
   before an optional `--write`. Preview is the default.
   The format remains the scoped `authoring-slots/v1`; during this pre-stable dev cycle it gained a
   required `pack_version`. Earlier dev-only v1 files without that identity fail closed and must be
   re-exported rather than guessed onto a revision.
4. **A saved sweep stays coupled to its probe.** Replacing a pose rigidly transports the existing
   sweep-axis direction and any explicit axis origin from the old probe frame into the new one.
   `structures_in_order` is cleared because it was measured from the old placement. Mode, range,
   and interpolation are preserved.
5. **The schema is not editable from here.** Authoring mode writes packs, never schema. Schema v0 is
   provisional; v1 is expected once the technical slice supplies evidence.
6. **Saving never promotes review state.** Later integration work may add an explicit review action
   and checklist after the review policy is decided. Current authoring writes poses and draft
   metadata only; it does not stamp `vetted`.
7. **Names remain consent-gated if review tooling is added later.** Role-only provenance is the
   default until explicit naming consent exists.
8. **Stylized geometry is declared, not hidden.** Substrate completion (shelled myocardium, sculpted
   leaflets, interface-only pericardium) sets `structures[i].stylized` and a `modified` note.
9. **Selecting a populated authoring slot applies it immediately.** `None — full heart` is the cold
   authoring default and a presentation state only: it is not a slot, is never persisted/exported,
   and shows the loaded model with no probe, echo, beam, or cut claim. Empty slots become the active
   placement target while keeping that same neutral full-heart presentation, so the selector can
   never name one view while a previous view remains on screen. A populated selection replaces the
   working pose and explains the change with one 850 ms quintic-eased clock shared by camera, wedge, cutter,
   and simulated echo. The probe origin follows an arc about the model centre, never a chord through
   the anatomy, while its beam follows interpolated endpoint aim points so the heart remains inside
   the moving fan. Intermediate planes are explicitly labelled unauthored, are never named as either
   endpoint, and cannot be saved or exported. A categorical display convention changes only while
   the echo is fully transparent. A new selection retargets from the current
   frame; direct camera input lands the selected pose exactly and stops the presentation motion.
   Recall remains available because choosing an already selected native option does not fire a
   change event, and it is the explicit way back after manual adjustment.
   Browser-local poses over a pack row are presented as **working definitions**, without an
   `overridden` suffix. The original pack pose remains untouched and can still be restored exactly;
   that storage distinction is an internal safety boundary, not the author-facing status of a view
   being defined.
   The authoring-only **Prevent auto-rotation** mode removes the camera from that shared transition:
   selecting or recalling a saved view still animates the probe, wedge, cutter, and live echo on
   the same clock, while the current anatomy orientation stays exact. Manual camera controls —
   orbit, Level, Match echo, Reset, and zoom — remain available. The toggle itself never moves the
   heart; it is session-only, defaults off, and never enters a save or export.
   When the transition lands with the cutter enabled in Echo-plane mode, the visible half is
   reconciled once against the actual offset plane and current camera. This is the automatic form
   of Reverse for view presentation; manual Reverse remains sticky during ordinary orbit and is
   reconsidered only on the next app-driven saved-view landing.
10. **Fan depth is a local pose control.** The authoring-only vertical rocker immediately left of
    the probe D-pad changes `fan.depth_cm` by 0.5 cm per press. It never moves the origin, changes an
    axis, or writes the loaded pack. Decreasing stops before the focus or the 1 cm authoring floor.
    Like every manual probe edit, a depth change leaves the selected saved pose and becomes a free,
    unvetted working plane until it is explicitly saved.

## Definition of done

For the completed slice: place and save a local draft without mutating the loaded pack; export a
strict, pose-valid slot file; explicitly ingest one standard slot into one existing draft view; and
validate the resulting full pack before writing. Clinical completeness and sign-off are later gates.
