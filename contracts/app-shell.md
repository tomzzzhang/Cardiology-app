# Contract: app shell

**Last Updated:** 2026-08-22 12:45 EDT

**Owns:** `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `index.html`, `vite.config.ts`
**Status:** partial. Echo and Explore modes, the model picker, deep-link params, the responsive
two-panel stage and the undismissible non-diagnostic notice are built. The provenance strip and the
full `?a=`/`?v=`/`?s=` scheme are wave 2. The **view rail was superseded** (owner decision,
2026-08-21) and is not being built as specified; how a learner picks a view is an open question and
`?view=` is the only route today. See `contracts/view-rail-sweep-scrubber.md`.
**Spec:** `docs/build_plan.md` v1.2 — "Architecture" (7), "Repo and hosting"; `docs/mvp_scope.md` "Design direction (core screen)".

## Responsibility

URL-param deep links, responsive layout, and composition of the other modules. Normal-vs-lesion
synced-camera toggle **only if nearly free** — no split-screen investment.

## One screen is the product, in one of two modes

**Echo** (the default) is 3D viewport + echo panel + view rail. **Explore** is the 3D viewport
alone: no echo panel, no probe, no probe control pad, no beam-dim control, no "Match echo", and the cutter
is forced free because there is no probe to sync to.

Explore is a **first-class mode, not a tool** *(owner decision, 2026-08-19, deliberately reversing
the earlier note that the free cutter is a tool rather than a global mode)*. The app is a free
heart-model explorer as well as an echo trainer. Echo remains the default top-level mode. Until the
learner rail exists, the learner subset retains its first-view cold path so it cannot strand a
learner with no way to choose a view. The authoring review surface instead opens at
`None — full heart`: a real nullable presentation state with the model at rest and no probe, echo
panel, beam, or cut. It is not a pack view or exported slot.

- **Desktop / hospital desktop:** viewport and echo panel side by side, view rail persistent. This
  is the active interface target.
- **Phone portrait (deferred):** the current stacked layout is retained as a prototype, but phone
  and touch UX are paused and are not contract acceptance criteria.
- **The didactics path is sacred:** open link → pick anatomy → pick view → scrub. Target is under
  15 seconds to "oh, THAT is where that plane sits". Anything that lengthens this path needs a
  reason.
- **Provenance strip** pinned at the bottom, one line, tap to expand.

## Deep links

Query params, no SPA-routing hacks — the site is static and served from a subpath on GitHub Pages.

```
?a=<anatomy>&v=<view>&s=<sweep-pos>
```

Wired today, pending that scheme: `?mode=explore` (Echo is the default), `?view=<view_id|index>`,
`?pack=<pack_id>`, `?freeze=1`, and `?polar=<scale>` — the last two developer controls, the latter
for measuring whether the echo depends on the renderer's internal sampling.

`?mode=` is written back from the **effective** mode rather than the requested one. An EXPLORE-ONLY
pack refuses Echo, so leaving `?mode=echo` in the address bar would hand out a link to a screen that
pack cannot produce.

- Params are read on load and written back as the user navigates. `replaceState`, not `pushState`:
  a mode toggle is not a navigation, and filling the back button with it would make Back mean
  something different here than everywhere else.
- A link encodes anatomy + view + camera state. This is distribution mechanics, explicitly **not** a
  notes or session-export feature (`docs/mvp_scope.md` puts those out of MVP).
- **Free-cut state is not a clinical claim and is not part of the saved view.** If free-cut state is
  ever encoded in a URL it is viewer state, and restoring it must not imply the plane is a saved
  view or inherit any review state, or alter `views[]`.

## Hosting constraints

- Fully static: **no backend, no accounts**, no server-side rendering.
- GitHub Pages serves the site under `/<repository-name>/`. The base path is supplied by the Pages
  workflow as `BASE_PATH` and read by `vite.config.ts`; runtime code resolves URLs through
  `import.meta.env.BASE_URL`. **Never hardcode either value** — local development normally runs at
  `/`, while release and Pages browser checks intentionally exercise a non-root path.
- Pack budget is ~15–20 MB per pack, so pack and asset loading is async and must not block first
  paint.

## Rules

1. **The shell composes; it does not implement.** Viewer behaviour belongs to viewer-core, echo to
   echo-renderer, view selection to the rail, attribution to provenance UI. The shell wires them.
2. **What a drag moves is legible without a mode.** *(Supersedes "the active interaction target is
   explicit in the UI", 2026-08-19.)* The requirement it served stands — a drag must never silently
   manipulate a different object — and is met positionally: every movable object is drawn, and what
   is under the pointer decides. The shell no longer owns a target indicator, because there is no
   target to indicate. It does own the **top-level mode** control and the **cutter mode** name,
   both always visible.
3. **What the shell surfaces about the probe is a claim, and it is withdrawn when it stops being
   true.** *(Supersedes "'Align free cut to echo view' is surfaced here, as a copy-only action".)*
   The one-shot bridge is gone; the cutter has an Echo plane mode instead. Where the shell does
   surface something new — the **Free probe** unlock — the echo panel withdraws the view's name and
   its draft flag the moment the probe has actually moved. Nothing here edits or de-vets a saved
   pose; see `contracts/README.md`.
4. **Simulated labelling and the non-diagnostic notice are always present**, not behind a toggle.
5. **No user-uploaded or arbitrary patient images, ever.** Curated content only — this is the
   regulatory line in `docs/mvp_scope.md` and the shell is where an upload affordance would most
   plausibly creep in.
6. **The picker is a curated work surface, not the repository inventory.** It groups each offered
   pack by capability — labelled and echo-capable against Explore-only geometry — because that
   distinction decides which modes are available. Retained research assets may stay off-list.
   Hiding one changes presentation only: it does not delete assets, change publication or licence
   state, or exempt the pack from validation and provenance gates.
7. **An offered pack that will not ship says so where it is chosen.** Every offered entry carries
   its licence state, and in development an unpublished pack is marked unpublished. The deployed
   build offers only published, non-fixture packs — offering a pruned pack would be offering a 404.
   Picker visibility and publication are independent explicit decisions.
8. **A mode the pack cannot support is refused, visibly, with the reason.** An EXPLORE-ONLY pack
   disables Echo and states why beside the control, and `?mode=echo` on such a pack lands in
   Explore. A pressable, inert control is worse than one that is visibly unavailable.

## What is actually in the repo now

Echo and Explore modes with a visible toggle; the curated model picker, grouped by pack kind, with
licence state and publication state on each offered entry; `?mode=`, `?view=`, `?pack=`, `?freeze=1`
and `?polar=` read on load, with `?mode=` and `?pack=` written back; the anatomy viewer beside the
echo panel on a wide viewport, plus an unsupported retained narrow stack; the pack-status panel;
and the non-diagnostic notice in the footer, present in both modes and not behind a toggle.

The flag-gated authoring selector additionally offers `None — full heart`. In that state the shell
uses the solo anatomy layout and withholds the echo panel; selecting a populated authoring slot
restores the two-panel presentation. This is the platform precursor to the rail's already-nullable
`currentView()`, not the deferred learner rail itself.

Switching pack is state, not a page load: the viewer's scene effect already keys on the pack and its
glTF URL, so choosing a chip rebuilds the scene and nothing else.

Not built: the view family rail, the pinned expandable provenance strip, the full
`?a=`/`?v=`/`?s=` scheme, and the normal-vs-lesion synced-camera toggle.
