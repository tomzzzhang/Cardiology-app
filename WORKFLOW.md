## Parallel workflow protocol (also `WORKFLOW.md`)

1. **Two truths.** Drive doc home = product truth (docs), single writer. GitHub repo = build truth; worker sessions touch only the repo, never Drive.
2. **One branch per session per work item** (`feat/NN-slug`); never two sessions on one branch; everything lands on `main` via PR, merged serially. Small PRs, land daily.
3. **Contracts first, then fan out.** Wave 0 is serial: scaffold, CI, pack schema (v0 provisional), module contracts, `WORKFLOW.md`. Only after wave 0 lands do workers fan out, one module each, on disjoint files. Workers never change schema or contracts; interface changes route back through the planning session. Schema v1 freeze happens after the technical slice review.
4. **Dispatch unit = GitHub issue.** Each issue: goal, explicit owned files/directories, contracts to read, definition of done, and the standing footer: "branch from main as feat/NN-slug, do not touch files outside your area, do not merge, open a PR and stop." One issue per session. If it is not pushed to a branch or written in a PR/issue, it did not happen.

Practical traps: repo OUTSIDE any Drive-synced tree; separate worktrees/clones for parallel local sessions; workers cannot read Drive — `docs/` carries the scrubbed spec copies, synced one way by the planning session; workers never edit `docs/`.
