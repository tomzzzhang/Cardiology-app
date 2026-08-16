# Contract: app shell

**Owns:** `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `index.html`, `vite.config.ts`
**Status:** wave 0 ships a deliberately minimal placeholder. The real shell is wave 2.
**Spec:** `docs/build_plan.md` v1.2 — "Architecture" (7), "Repo and hosting"; `docs/mvp_scope.md` "Design direction (core screen)".

## Responsibility

URL-param deep links, responsive layout, and composition of the other modules. Normal-vs-lesion
synced-camera toggle **only if nearly free** — no split-screen investment.

## One screen is the product

3D viewport + echo panel + view rail.

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

- Params are read on load and written back as the user navigates.
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
2. **The active interaction target is explicit in the UI** — heart/camera, free cut, or echo view —
   because a drag must never silently manipulate a different object. The shell owns that indicator.
3. **"Align free cut to echo view" is surfaced here, as a copy-only action.** It never edits or
   de-vets the saved echo pose.
4. **Simulated labelling and the non-diagnostic notice are always present**, not behind a toggle.
5. **No user-uploaded or arbitrary patient images, ever.** Curated content only — this is the
   regulatory line in `docs/mvp_scope.md` and the shell is where an upload affordance would most
   plausibly creep in.

## Wave 0 scope (what is actually in the repo now)

Renders the hello-world viewer and reports whether the stub pack loaded and validated against schema
v0. No rail, no echo panel, no deep links, no provenance strip. That is intentional: wave 0's job is
`main` → Pages → a viewer that builds.
