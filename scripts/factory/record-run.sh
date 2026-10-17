#!/usr/bin/env bash
# Append one run record to runs.jsonl on the factory-log branch and write a job summary.
# Best-effort: recording must never fail the workflow. Problems become ::warning:: and exit 0.
set -uo pipefail

BRANCH=factory-log
LOGFILE=runs.jsonl
LOGDIR=""
CREATED_LOCAL=0

warn() { echo "::warning::factory run record: $*"; }

cleanup() {
  if [ -n "$LOGDIR" ]; then
    git worktree remove --force "$LOGDIR" >/dev/null 2>&1
    rm -rf "$LOGDIR"
    LOGDIR=""
  fi
  if [ "$CREATED_LOCAL" = 1 ]; then
    git branch -D "$BRANCH" >/dev/null 2>&1
    CREATED_LOCAL=0
  fi
  git worktree prune >/dev/null 2>&1
}
trap cleanup EXIT

# Returns 0 when the record is pushed, 1 to retry (rejected or transient git error), 3 to give up now.
append_once() {
  local rc
  git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" || return 1
    git worktree add --quiet --detach "$LOGDIR" "refs/remotes/origin/$BRANCH" || return 1
  elif [ "$rc" -eq 2 ]; then
    git worktree add --quiet --detach "$LOGDIR" HEAD || return 1
    CREATED_LOCAL=1
    git -C "$LOGDIR" checkout --quiet --orphan "$BRANCH" || return 1
    git -C "$LOGDIR" rm -rf --quiet . || return 1
  else
    warn "git ls-remote failed (exit $rc); not recording"
    return 3
  fi

  echo "$record" >> "$LOGDIR/$LOGFILE"
  git -C "$LOGDIR" add "$LOGFILE" || return 1
  git -C "$LOGDIR" -c user.name=factory-bot -c user.email=factory-bot@users.noreply.github.com \
    commit --quiet --no-verify --no-gpg-sign \
    -m "run ${GITHUB_RUN_ID:-local}: ${SKILL:-unknown} #${ISSUE:-?}" || return 1
  git -C "$LOGDIR" push --quiet origin "HEAD:refs/heads/$BRANCH" || return 1
  return 0
}

record="$(node scripts/factory/run-record.mjs)" || { warn "could not build the record"; exit 0; }

# Summary first, so it exists even if the push below never succeeds.
# A backtick in a value would close the code fence, so escape it (` is still valid JSON).
safe_record="$(printf '%s\n' "$record" | sed 's/`/\\u0060/g')"
{
  echo "### Factory run"
  echo '```json'
  echo "$safe_record"
  echo '```'
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}" 2>/dev/null || warn "could not write the job summary"

for attempt in 1 2 3; do
  cleanup
  LOGDIR="$(mktemp -d)"
  append_once
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "Recorded run ${GITHUB_RUN_ID:-local} on $BRANCH (attempt $attempt)"
    exit 0
  fi
  [ "$rc" -eq 3 ] && exit 0
  warn "attempt $attempt of 3 failed"
  sleep $(( attempt + RANDOM % 4 ))
done
warn "giving up after 3 attempts; run not recorded"
exit 0
