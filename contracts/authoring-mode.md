# Contract: authoring mode

**Owns:** `src/authoring/**`
**Status:** contract only, except for the PROBE PLACEMENT slice — view-axis anchoring, the
derived standoff, the centre button, and saved view slots with export — pulled forward and
landed 2026-08-19 at the owner's decision. The current UI uses the DRAFT view canon as a temporary
starter list, not a completeness requirement or clinical acceptance gate, and derives the
model's cardiac axes from the apical four-chamber pose, reporting and EXPORTING them rather than
writing `meshes.orientation` or `meshes.anatomical_frame`, which stay pack content with their own
recorded derivation. Arbitrary working slots remain available. Nothing else here is built. The
learner bundle excludes this surface at the release boundary; that is not a restriction on ordinary
authoring-platform checkpoints. The rest lands after integration.
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
2. **The free anatomical cutter stays a separate object here too.** It is an inspection aid while
   authoring. Its `{N, s}` state is never promoted into `views[]`. If an author wants a view at the
   cutter's location, they author a *probe pose*; the cutter is not silently converted into one.
   `interaction.free_cut` — the pack's initial free-cut default — is the one free-cut value a pack may
   contain, and it is a viewer default, not view metadata.
3. **Export must round-trip through the schema.** Exported JSON is validated with `validatePack`
   before it is offered for download. An export that does not validate is a bug and must not be
   written.
4. **The schema is not editable from here.** Authoring mode writes packs, never schema. Schema v0 is
   provisional; v1 is expected once the technical slice supplies evidence.
5. **Saving never promotes review state.** Later integration work may add an explicit review action
   and checklist after the review policy is decided. Current authoring writes poses and draft
   metadata only; it does not stamp `vetted`.
6. **Names remain consent-gated if review tooling is added later.** Role-only provenance is the
   default until explicit naming consent exists.
7. **Stylized geometry is declared, not hidden.** Substrate completion (shelled myocardium, sculpted
   leaflets, interface-only pericardium) sets `structures[i].stylized` and a `modified` note.

## Definition of done

Place/tune arbitrary probe poses, planes, and sweeps against a loaded pack; preserve pack-authored
values; and export schema-valid draft data. Clinical completeness and sign-off are later gates.
