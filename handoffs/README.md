# Handoffs

A handoff is the durable state of one work item: what is true in the repository right now, what was
decided, what is blocked, and what to do next. It exists so the next agent — a fresh Claude Code
session, a Codex session, or a human picking the work back up — can act without replaying a
conversation it cannot see.

Read this file and the active work item's handoff **before** doing anything else. Then read
[`../WORKFLOW.md`](../WORKFLOW.md) for how work is dispatched, branched, and landed.

## One file per work item

Each dispatched work item owns exactly **one** handoff file:

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

## The handoff describes now, not the story so far

The Markdown file states the **latest true state** of the work item. Git already retains the history
of previous rounds — that is what `git log -p handoffs/<file>.md` is for.

So: replace stale narrative rather than appending to it. Delete a "Blockers" entry that is no longer
a blocker. Rewrite "Exact next action" every round. A handoff that reads as a diary is a handoff
nobody can act on.

## End-of-round requirement

Before every substantive final response or handback, the worker must:

1. **Reconcile actual state** — repository, branch, tests, CI, and pull request. Read it from `git`
   and from GitHub, not from memory of the conversation.
2. **Update its assigned handoff file** to match what was just reconciled.
3. **Separate clearly**: completed work, pending decisions, blockers, and recommended next steps.
   These are different things and collapsing them costs the next agent an hour.
4. **Commit and push** the handoff update to the same work branch and pull request.
5. **Report the handoff path and the resulting commit SHA** in the final response.
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
**HEAD:** `<short commit SHA>`
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

`Last Updated` and `HEAD` are the two fields that go stale fastest — set both from real values at the
moment you commit, and note that `HEAD` names the commit *before* the handoff commit itself, since
that SHA cannot be known until the commit exists.
