# Module contracts

**Updated:** 2026-08-19 06:27 EDT

One page per engine module, from `docs/build_plan.md` ("Architecture: engine + content packs").
They describe the interface and behaviour each module owes the rest of the system.

Change a contract deliberately, with evidence, updating tests and documentation in the same
commit. Do not change one silently, and do not let an implementation drift away from one without
saying so.

| Module | Contract | Status |
| --- | --- | --- |
| pack-loader | [`pack-loader.md`](pack-loader.md) | implemented; revisit at schema v1 |
| viewer-core | [`viewer-core.md`](viewer-core.md) | implemented for the slice: free orbit (no polar clamp), framing, direct-manipulation cut handles on a rendered rectangle, echo-synced and free cutter modes, solid stencil caps, ghost cutaway, probe indicator, probe control pad, beam-dim highlight, animated match-echo camera. Outstanding: pinch-zoom and two-finger pan, per-structure show/hide, labels, measurement |
| echo-renderer | [`echo-renderer.md`](echo-renderer.md) | implemented: scan, separable PSF, display passes over the labelled volume, per-view tuning, simulated labelling. Outstanding: motion, secondary rays, per-view `echo_tuning` authored rather than defaulted |
| view rail + sweep scrubber | [`view-rail-sweep-scrubber.md`](view-rail-sweep-scrubber.md) | not built — wave 1d. One sweep slider and the probe control pad stand in; views are reachable only by `?view=` |
| provenance UI | [`provenance-ui.md`](provenance-ui.md) | partial: the echo panel carries the simulated badge, the draft flag and the licence line. The pinned expandable strip is not built |
| authoring mode | [`authoring-mode.md`](authoring-mode.md) | not built |
| app shell | [`app-shell.md`](app-shell.md) | partial: Echo/Explore modes, `?mode=`/`?view=`/`?pack=` deep links, responsive two-panel stage, the undismissible non-diagnostic notice. Outstanding: the view rail, the provenance strip, the full `?a=`/`?v=`/`?s=` scheme |

## The boundary every contract has to respect

`docs/build_plan.md` pins one separation, and most of these contracts exist to hold it:

> The free anatomical cutter and the vetted echo wedge are **different objects on different data
> paths.** They may coincide visually. They never merge.

| | Free anatomical cutter | Vetted echo wedge |
| --- | --- | --- |
| What it is | Infinite oriented plane `{N, s}` relative to pivot `C` | Finite sector derived from a saved probe pose |
| Where it lives | Runtime inspection state; seeded from optional `interaction.free_cut` | `views[].probe` in the pack |
| Who moves it | The learner, freely | The sweep, through the scrubber or the probe control pad; or the learner directly, once the probe is explicitly unlocked |
| Clinical claim | None | Reviewed, provenance-stamped |
| Serialized into `views[]` | **Never** | It *is* the view |

## What the link is, now that the build has been used

The original rule here was that the only permitted link is a one-shot, copy-only **Align free cut
to echo view**. The owner has used the build and replaced it (2026-08-19). What holds now:

- **Data flows probe → cutter, and never the reverse.** The cutter has an **Echo plane** mode in
  which it continuously follows the selected view's imaging plane as the sweep scrubs, and a
  **Free** mode in which it is the learner's and claims no relationship to the view. Which is in
  force is named on screen at all times, rather than being a claim that silently decays the first
  time the plane is nudged.
- **Moving the cutter never synthesizes, relabels, or re-renders an echo image.** There is no code
  path from `{N, s}` into the echo renderer.
- **Nothing a learner can reach writes to `views[]`.**

### The probe unlock, and what pays for it

The probe can be turned by hand, off the selected view's saved sweep track (owner decision,
2026-08-19). Every other control keeps the probe pinned — every reachable pose is
`frameAt(probe, sweep, t)` for `t` in [0, 1] — and that constraint is what lets the echo panel put
a view's name on an image. The unlock is an explicit exception, and it is paid for by **labelling
rather than by hiding**:

- the echo still renders, because seeing what a plane images is the point of being able to move it;
- the moment the probe has *actually* moved, the panel withdraws the view's name and its draft flag
  and says the plane is unvetted — actually moved, not merely unlocked, since a learner can turn
  the toggle on and never drag;
- the sweep slider is disabled and says so;
- the pad's four extra controls appear, and each is a named anatomical motion rather than a drag;
- locking again **discards** the free pose rather than merging it, so the probe returns to
  `frameAt(probe, sweep, t)` exactly;
- the free pose is runtime state. It cannot be written into `views[]`, and it dies with the session;
- the probe cannot be slid across the chest, only along its own beam, and even that stops before the
  aperture reaches tissue. Which window a view uses is authored content; how far the transducer
  stands off it is not.

Rendering an arbitrary plane under a vetted view's name remains forbidden. That is the failure the
pack's refusal to author A3 and A4 exists to avoid, and unlocking the probe does not licence it.
