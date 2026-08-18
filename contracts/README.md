# Module contracts

**Updated:** 2026-08-18

One page per engine module, from `docs/build_plan.md` ("Architecture: engine + content packs").
They describe the interface and behaviour each module owes the rest of the system.

Change a contract deliberately, with evidence, updating tests and documentation in the same
commit. Do not change one silently, and do not let an implementation drift away from one without
saying so.

| Module | Contract | Status |
| --- | --- | --- |
| pack-loader | [`pack-loader.md`](pack-loader.md) | implemented; revisit at schema v1 |
| viewer-core | [`viewer-core.md`](viewer-core.md) | not built |
| echo-renderer | [`echo-renderer.md`](echo-renderer.md) | not built |
| view rail + sweep scrubber | [`view-rail-sweep-scrubber.md`](view-rail-sweep-scrubber.md) | not built |
| provenance UI | [`provenance-ui.md`](provenance-ui.md) | not built |
| authoring mode | [`authoring-mode.md`](authoring-mode.md) | not built |
| app shell | [`app-shell.md`](app-shell.md) | placeholder only |

## The boundary every contract has to respect

`docs/build_plan.md` pins one separation, and most of these contracts exist to hold it:

> The free anatomical cutter and the vetted echo wedge are **different objects on different data
> paths.** They may coincide visually. They never merge.

| | Free anatomical cutter | Vetted echo wedge |
| --- | --- | --- |
| What it is | Infinite oriented plane `{N, s}` relative to pivot `C` | Finite sector derived from a saved probe pose |
| Where it lives | Runtime inspection state; seeded from optional `interaction.free_cut` | `views[].probe` in the pack |
| Who moves it | The learner, freely | The view rail and sweep scrubber only |
| Clinical claim | None | Reviewed, provenance-stamped |
| Serialized into `views[]` | **Never** | It *is* the view |

The only permitted link is one-way and copy-only: **Align free cut to echo view** copies the
selected echo plane into the free cutter. Subsequent free movement breaks the association and
never modifies the saved view. Moving the free cutter never synthesizes, relabels, or re-renders
an echo image.
