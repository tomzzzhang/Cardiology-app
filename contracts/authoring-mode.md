# Contract: authoring mode

**Owns:** `src/authoring/**`
**Status:** contract only, except for the PROBE PLACEMENT slice — view-axis anchoring, the
derived standoff, the centre button, and saved view slots with export — pulled forward and
landed 2026-08-19 at the owner's decision. The slice also carries the CLINICAL VIEW CANON as the
slot list (all of `docs/view_canon.md`, empty where a pack has authored nothing) and derives the
model's cardiac axes from the apical four-chamber pose, reporting and EXPORTING them rather than
writing `meshes.orientation` or `meshes.anatomical_frame`, which stay pack content with their own
recorded derivation. Nothing else here is built. The gating rule below is
NOT relaxed by the slice: it is off by default, unreachable from the learner UI, and no learner
path became editable because it exists (`scripts/check-authoring-absent.ts` asserts the built
bundle carries none of it). The rest lands after wave 2.
**Spec:** `docs/build_plan.md` v1.2 — "Architecture" (6); vetting checklist in `docs/view_canon.md`.

## Responsibility

Flag-gated tooling to place and tune probe poses, planes, and sweeps interactively against a loaded
pack; tune per-view echo params; and export pack JSON. Vetting sign-off stamps the vetters list and
clears the draft flag.

## Gating

Off by default and not reachable from the learner UI. It is a build/flag-gated surface, and nothing
in the learner path may become editable because authoring mode exists.

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
5. **Sign-off is a deliberate act with a checklist.** It stamps `vetted.vetters[]`, `vetted.status`,
   and `vetted.last_reviewed`, and it clears the draft flag. It cannot be inferred from "the author
   saved something". The checklist is the seven-item list in `docs/view_canon.md` "Vetting checklist".
6. **Names are consent-gated at the point of entry.** `vetters[i].name` is written only when explicit
   naming consent has been recorded; otherwise the role label alone is stored. Authoring mode must
   not require a name to complete sign-off.
7. **Stylized geometry is declared, not hidden.** Substrate completion (shelled myocardium, sculpted
   leaflets, interface-only pericardium) sets `structures[i].stylized` and a `modified` note.

## Definition of done

Place/tune probe poses, planes, and sweeps against a loaded pack; tune per-view echo params; export
schema-valid pack JSON; run a per-view sign-off that stamps provenance and clears the draft flag.
