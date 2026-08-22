# Contract: provenance UI

**Last Updated:** 2026-08-22 14:01 EDT

**Owns:** `src/provenance/**`
**Status:** contract only. Implementation is wave 2.
**Spec:** `docs/build_plan.md` v1.2 — "Architecture" (5), "Licensing plan"; `docs/mvp_scope.md` locked decision 6.

## Responsibility

The trust surface, and the licence-compliance surface. Three parts:

1. **One-line strip** at the bottom of the core screen — source, vetter role, date. Tap to expand.
2. **Draft-flag badge** wherever unvetted content is shown.
3. **Consolidated credits screen** rendering creator, source URL, licence + URL, and the modified
   note per model, in a CC-compliant "reasonable manner".

## Inputs

`pack.provenance` (per anatomy) and `pack.views[i].provenance` (per view). Both are the same
`Provenance` block; the strip shows the view's, falling back to the pack's where a field is
view-agnostic.

## Rules

1. **Provenance is shown on every view.** `docs/mvp_scope.md` definition of done requires it; a view
   with no visible provenance is a failure, not a cosmetic gap.
2. **Vetter names are consent-gated.** `vetters[i].name` is optional and absent until explicit naming
   consent is recorded. When it is absent, render the **role** label (`fellow`, `attending`). Never
   substitute any other identifier — no initials, no institution, no program name. The repository and
   `docs/` carry role labels only, and this UI must not reintroduce identity from anywhere else.
3. **Draft is visible, not implied.** `vetted.status === 'draft'` gets an explicit badge on the view
   and in the rail. Absence of a badge means vetted, so the badge cannot be suppressed for tidiness.
4. **Simulated is stated, always.** Every echo frame is labelled simulated, with provenance one tap
   away. Stylized substrate (shelled myocardium, sculpted leaflets, interface-only pericardium) is
   surfaced as stylized from `structures[i].stylized` and the `modified` note.
5. **Licence text is rendered, not summarized.** Show licence name and link the licence URL. For
   Alberta-library assets the attribution template in `docs/build_plan.md` "Licensing plan" is the
   required form; CC BY-NC-SA sources additionally note that the derivative pack is itself
   CC BY-NC-SA.
6. **NC red lines are a product constraint this UI must not soften:** no ads, no paid sponsorship
   tied to content, no paid tiers including NC content, no selling institutional access.
7. **CI is the backstop, not the UI.** `npm run check:provenance` fails the build on missing or
   placeholder attribution; this module renders what CI has already guaranteed exists, and must not
   paper over a gap with "unknown".

## Definition of done

Strip on the core screen for every view, expandable; draft badges driven by pack data; credits screen
listing every model with creator, source URL, licence + URL, and modified note; role labels wherever
a name is absent.
