# Contract: app shell

**Owns:** `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `index.html`, `vite.config.ts`
**Status:** partial. Echo and Explore modes, deep-link params, the responsive two-panel stage and
the undismissible non-diagnostic notice are built. The view rail, the provenance strip and the full
`?a=`/`?v=`/`?s=` scheme are wave 2.
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
heart-model explorer as well as an echo trainer. Echo remains the default on a cold link with no
param, so the open-link-to-an-oriented-view path is unchanged for someone arriving cold.

- **Desktop / hospital desktop:** viewport and echo panel side by side, view rail persistent.
- **Phone portrait:** echo panel and viewport stacked. Usable, not an afterthought.
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

- Params are read on load and written back as the user navigates. `replaceState`, not `pushState`:
  a mode toggle is not a navigation, and filling the back button with it would make Back mean
  something different here than everywhere else.
- A link encodes anatomy + view + camera state. This is distribution mechanics, explicitly **not** a
  notes or session-export feature (`docs/mvp_scope.md` puts those out of MVP).
- **Free-cut state is not a clinical claim and is not part of the vetted view.** If free-cut state is
  ever encoded in a URL it is viewer state, and restoring it must not imply the plane is a vetted
  view or alter `views[]`.

## Hosting constraints

- Fully static: **no backend, no accounts**, no server-side rendering.
- GitHub Pages serves the site under `/<repository-name>/`. The base path is supplied by the Pages
  workflow as `BASE_PATH` and read by `vite.config.ts`; runtime code resolves URLs through
  `import.meta.env.BASE_URL`. **Never hardcode either value** — local dev, `vite preview`, and the
  Playwright harness all run at `/`.
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

## What is actually in the repo now

Echo and Explore modes with a visible toggle; `?mode=`, `?view=`, `?pack=`, `?freeze=1` and
`?polar=` read on load, with `?mode=` written back; the anatomy viewer beside the echo panel on a
wide viewport and stacked on a phone; the pack-status panel; and the non-diagnostic notice in the
footer, present in both modes and not behind a toggle.

Not built: the view family rail, the pinned expandable provenance strip, the full
`?a=`/`?v=`/`?s=` scheme, and the normal-vs-lesion synced-camera toggle.
