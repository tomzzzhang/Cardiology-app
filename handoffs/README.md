# Handoffs

A handoff is the durable state of one work item: what is true in the repository right now, what was
decided, what is blocked, and what to do next. It exists so the next agent — a fresh Claude Code
session, a Codex session, or a human picking the work back up — can act without replaying a
conversation it cannot see.

Read this file and the active work item's handoff **before** doing anything else. Then read
[`../WORKFLOW.md`](../WORKFLOW.md) for how work is dispatched, branched, and landed.

## One mutable builder handoff per work item

Each dispatched work item owns exactly **one mutable builder handoff**:

```
handoffs/<issue-number>-<slug>.md
```

```
handoffs/00-wave0.md
handoffs/01-model-pipeline.md
handoffs/02-echo-slice.md
handoffs/03-viewer-core.md
handoffs/04-view-rail.md
```

The issue names its handoff file. The work-item issue template requires it.

**A worker updates only the handoff assigned to its own issue.** There is deliberately no shared
status document: a single global handoff would put every parallel branch in conflict over the same
lines. Do not create one, do not edit another work item's handoff, and do not "helpfully" summarize
someone else's branch in yours. If you need to reference another work item, link to its handoff.

Handoffs are committed to the **active work branch**, in the same pull request as the work they
describe. They are not committed straight to `main` and not kept outside the repository.

Independent review records and a reconciliation record may sit beside that handoff under
`handoffs/reviews/`. They are immutable evidence about a particular target commit, not competing
status files, and therefore do not violate the one-mutable-handoff rule.

## Review, repair, and landing loop

Use this loop after every coherent build round. It is the durable answer to “what happens next?”

| Stage | Owner | Durable result | Next action |
|---|---|---|---|
| 1. Build and freeze | One implementation worker | Updated work-item handoff naming an exact implementation/review target SHA | Builder stops; reviewers begin |
| 2. Independent reviews | Claude and Codex, separately | One immutable review file per reviewer for that exact SHA | Reconcile only after both exist |
| 3. Reconcile | Owner, planning session, or explicitly designated reconciler | One reconciliation file listing accepted, deferred, and rejected findings and naming one implementer | Implement only the accepted list |
| 4. Repair | One implementation worker | Code changes, green checks, and an updated handoff naming a new target SHA | Reviewers verify the new target |
| 5. Verify | Claude and Codex, separately | New review files keyed to the repaired SHA | Repeat from reconciliation if needed; otherwise land |
| 6. Land | Owner or designated maintainer | Merged PR and verified deployment, when applicable | Dispatch the next work item |

Do not collapse review and implementation into one unrecorded step. A reviewer may later become the
implementer, but its independent review must be written first. It may read the other review only
after its own conclusions are fixed. Owner decisions are never silently chosen by an implementer.

### Freeze one exact target

The builder commits the coherent implementation, runs the relevant checks, pushes it, and records
that full commit SHA in the active handoff as **Implementation / review target SHA**. The builder
then stops. A later handoff-only or review-only commit can advance the branch head without changing
the frozen target. Do not refresh the target merely because documentation was appended.

Reviewers inspect the exact target SHA, not whatever happens to be the latest branch head. They may
read the latest builder handoff for context, but they must not infer implementation state from a
newer review-only commit.

### Keep the two reviews independent

Review records use:

```
handoffs/reviews/<work-item>/<target-sha>-codex.md
handoffs/reviews/<work-item>/<target-sha>-claude.md
```

Use the work-item identifier from the handoff filename and a 7–12 character unambiguous target-SHA
prefix in the filename; put the full SHA inside the file. Before fixing its conclusions, a reviewer
must not read the other review for that target. Each reviewer:

1. works read-only against the exact target;
2. independently verifies relevant code, contracts, tests, CI, privacy, and workflow boundaries;
3. writes only its own review record, never the builder handoff or another review;
4. commits and pushes that record as a review-only commit; and
5. verifies CI on the review commit, reports its path and commit SHA, and stops.

Implementation branches remain single-writer. Review-only records are the narrow exception: they
may be appended **sequentially** to the existing pull-request branch because they do not touch
implementation files. A reviewer must update from the remote immediately before adding its file;
two reviewers never push concurrently.

Published review records are immutable. A later verification gets a new file keyed to the new
target SHA. Correct a factual or formatting error with a clearly identified follow-up commit; never
rewrite another reviewer’s conclusion.

Minimum review-record fields:

```
# <Reviewer> review — <work item>

**Last Updated:** YYYY-MM-DD HH:MM ET
**Reviewer:** Claude | Codex
**Target Pull Request:** <URL>
**Target Implementation SHA:** <full SHA>
**Independent Review:** completed before reading the other review

## Verdict
## Findings, ordered by priority
## Positive verification
## Smallest recommended repair set
## Owner decisions still required
## Recommended next action
```

### Reconcile before implementation

After both review files exist, compare them and create:

```
handoffs/reviews/<work-item>/<target-sha>-reconciliation.md
```

The reconciliation is the implementation authorization for that target. It records findings as
**accepted**, **deferred with reason**, or **rejected with reason**; preserves unresolved owner
decisions as questions; names exactly one implementation owner; and states the bounded repair list
and required verification. If the owner directly authorizes implementation in the same session,
the designated implementer records that instruction in the reconciliation file before changing
implementation files.

### Resume without replaying the conversation

To determine the next step later:

1. read the active work-item handoff and its **Exact next action**;
2. note its implementation/review target SHA;
3. list `handoffs/reviews/<work-item>/` for that target; and
4. continue at the first missing artifact in the stage table above.

Two reviews but no reconciliation means **reconcile**. A reconciliation but no repaired target means
**implement**. A new repaired target without two reviews means **verify**. Two clear reviews plus
green required CI means **the owner may merge**. When evidence conflicts with a stale “Exact next
action,” reconcile the handoff before proceeding.

## The handoff describes now, not the story so far

The Markdown file states the **latest true state** of the work item. Git already retains the history
of previous rounds — that is what `git log -p handoffs/<file>.md` is for.

So: replace stale narrative rather than appending to it. Delete a "Blockers" entry that is no longer
a blocker. Rewrite "Exact next action" every round. A handoff that reads as a diary is a handoff
nobody can act on.

## Implementation-worker end-of-round requirement

Before every substantive final response or handback, the worker must:

1. **Reconcile actual state** — repository, branch, tests, CI, and pull request. Read it from `git`
   and from GitHub, not from memory of the conversation.
2. **Update its assigned handoff file** to match what was just reconciled.
3. **Separate clearly**: completed work, pending decisions, blockers, and recommended next steps.
   These are different things and collapsing them costs the next agent an hour.
4. **Commit and push** the handoff update to the same work branch and pull request.
5. **Report the handoff path, implementation/review target SHA, and resulting handoff commit SHA**
   in the final response.
6. **Stop without merging.**

A round that changed only analysis or decisions still updates the handoff, whenever the latest state
or the next action has materially changed.

## Never claim an unverified result

Do not write that a test passed, a CI job was green, a push landed, or a deployment succeeded unless
you ran it or read the result. The **Verification** table holds actual commands and their outcomes,
or actual CI job results — never the word "tested" on its own. An honest "not run this round" is
useful; a fabricated green is worse than nothing, because the next agent builds on it.

## Unresolved questions stay questions

Record an open question under **Decisions needed from owner**, phrased as a question, with the
options and what each implies. Do not resolve it silently by picking one and moving on. If you had to
proceed to avoid blocking, say which assumption you proceeded under and that it is reversible.

## Privacy and scope rules

These apply to handoffs exactly as they apply to the rest of the repository:

- **No personal names, program or institution names, availability details, or any other private
  collaborator information.** Clinical collaborators are referred to by **role label** — `fellow`,
  `attending`, "the clinical vetter" — and vetter names in pack data stay consent-gated.
- **No secrets, tokens, or credentials.**
- **No machine-specific absolute paths** — no home-directory paths from macOS, Windows, or Linux.
  Use repository-relative paths. (The Repository guardrails CI job holds the exact patterns; this
  file deliberately does not quote them, so that documenting the rule does not trip it.)
- **No references to the private planning workspace** — not its path, not its folder structure, not
  the contents of private documents that were never synced into `docs/`.
- **`docs/` is read-only.** It holds one-way, privacy-scrubbed copies of the product truth, synced by
  the planning session. Workers never edit them, and CI fails a pull request that does.

CI enforces the path and workspace-reference rules mechanically. The privacy rules it cannot check
are on you.

## Template

Copy this for a new handoff. Keep the section order — later agents skim by heading.

```
# Handoff — <work item>

**Last Updated:** YYYY-MM-DD HH:MM ET
**Work Item:** <issue number and title>
**Branch:** `<branch>`
**Pull Request:** <URL or "not opened">
**Implementation / Review Target SHA:** `<full commit SHA>`
**Status:** planning | in progress | awaiting decision | ready for review | complete

## Objective

## Completed this round

## Current implementation state

## Files changed

## Verification

| Check | Result |
|---|---|
| Typecheck | |
| Lint | |
| Unit tests | |
| Build | |
| Relevant CI | |

## Decisions made

## Decisions needed from owner

## Known limitations and deferred work

## Blockers

## Exact next action

## Scope and privacy check
```

`Last Updated` and `Implementation / Review Target SHA` are the two fields that go stale fastest.
Set both from real values. The target names the coherent implementation being handed off, not the
later commit that merely carries the handoff or review record; this avoids an impossible self-SHA
and an endless handoff-refresh cycle.
