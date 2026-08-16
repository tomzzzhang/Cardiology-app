#!/usr/bin/env bash
#
# CI gate: `docs/` is read-only for workers, with one narrow sync route.
#
# `docs/` holds one-way, privacy-scrubbed copies of the product truth. Workers
# never edit them. The planning session does need a route to sync a later
# revision — schema v1, for one — so there is exactly one, and it is narrow
# enough that a code change cannot ride along inside it.
#
# Called by .github/workflows/ci.yml on pull requests. Lives in a script rather
# than inline YAML so tests/unit/docsGuard.test.ts can exercise every branch
# against real git history.
#
# Environment:
#   BASE_SHA  the pull request's base commit
#   HEAD_REF  the pull request's head branch name
#
# Exit 0 to allow, 1 to fail the build.
set -euo pipefail

: "${BASE_SHA:?BASE_SHA is required}"
: "${HEAD_REF:?HEAD_REF is required}"

# docs/ arrives once, from the planning session. Until it exists on the base
# commit, this is that initial sync and the guard stands down — but only for
# ADDITIONS. A stand-down lasting the whole life of the sync pull request would
# let a later commit on the same branch edit the freshly synced copies with the
# guard still green.
if ! git cat-file -e "$BASE_SHA:docs" 2>/dev/null; then
  if git log --diff-filter=MDR --format=%H "$BASE_SHA"..HEAD -- docs/ | grep -q .; then
    echo "::error::This pull request modifies or deletes docs/ content it also introduces."
    echo "The initial sync may only ADD the privacy-scrubbed copies."
    git --no-pager log --diff-filter=MDR --oneline "$BASE_SHA"..HEAD -- docs/
    exit 1
  fi
  echo "docs/ does not exist on the base commit — initial sync, additions only."
  exit 0
fi

if ! git diff --name-only "$BASE_SHA"...HEAD -- docs/ | grep -q .; then
  echo "docs/ unchanged."
  exit 0
fi

# The sanctioned planning-session sync route: a `docs/sync-*` branch whose pull
# request changes NOTHING outside docs/. Both halves are required — the branch
# name states the intent, and the docs-only check is what actually prevents a
# code change from being smuggled in under that intent.
case "$HEAD_REF" in
  docs/sync-*)
    outside=$(git diff --name-only "$BASE_SHA"...HEAD -- . ':(exclude)docs/')
    if [ -n "$outside" ]; then
      echo "::error::A docs sync pull request may change nothing outside docs/."
      echo "Move these changes to their own pull request:"
      echo "$outside"
      exit 1
    fi
    echo "Sanctioned planning-session docs sync on '$HEAD_REF' — docs-only, allowed."
    git --no-pager diff --name-only "$BASE_SHA"...HEAD -- docs/
    exit 0
    ;;
esac

echo "::error::This PR changes docs/. Those are one-way, privacy-scrubbed copies"
echo "synced from the planning session; workers never edit them."
echo "A planning-session sync belongs on a 'docs/sync-*' branch that changes only docs/."
git --no-pager diff --name-only "$BASE_SHA"...HEAD -- docs/
exit 1
