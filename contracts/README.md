# Module contracts

One page per engine module, per `docs/build_plan.md` v1.2 ("Architecture: engine + content packs").

**These files are contracts, not documentation.** Workers read them and code against them. Workers do
not change them, and do not change the schema. Interface changes route back through the planning
session and are logged there — see [`../WORKFLOW.md`](../WORKFLOW.md).

| Module | Contract | Wave |
| --- | --- | --- |
| pack-loader | [`pack-loader.md`](pack-loader.md) | 0 (implemented), revisit at schema v1 |
| viewer-core | [`viewer-core.md`](viewer-core.md) | 1c |
| echo-renderer | [`echo-renderer.md`](echo-renderer.md) | 1b |
| view rail + sweep scrubber | [`view-rail-sweep-scrubber.md`](view-rail-sweep-scrubber.md) | 1d |
| provenance UI | [`provenance-ui.md`](provenance-ui.md) | 2 |
| authoring mode | [`authoring-mode.md`](authoring-mode.md) | after wave 2 |
| app shell | [`app-shell.md`](app-shell.md) | 0 (placeholder), 2 (real) |

## The boundary every contract has to respect

`docs/build_plan.md` v1.2 pins one separation, and most of these contracts exist to hold it:

> The free anatomical cutter and the vetted echo wedge are **different objects on different data
> paths.** They may coincide visually. They never merge.

| | Free anatomical cutter | Vetted echo wedge |
| --- | --- | --- |
| What it is | Infinite oriented plane `{N, s}` relative to pivot `C` | Finite sector derived from a saved probe pose |
| Where it lives | Runtime inspection state; seeded from optional `interaction.free_cut` | `views[].probe` in the pack |
| Who moves it | The learner, freely | The view rail and sweep scrubber only |
| Clinical claim | None | Vetted, provenance-stamped |
| Serialized into `views[]` | **Never** | It *is* the view |

The only permitted link is one-way and copy-only: **Align free cut to echo view** copies the selected
echo plane into the free cutter. Subsequent free movement breaks the association and never modifies
the vetted view. Moving the free cutter never synthesizes, relabels, or re-renders an echo image.
