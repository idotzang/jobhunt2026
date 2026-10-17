#!/usr/bin/env bash
# Append one run record to runs.jsonl on the factory-log branch and write a job summary.
set -euo pipefail

record="$(node scripts/factory/run-record.mjs)"

git config user.name "factory-bot"
git config user.email "factory-bot@users.noreply.github.com"

logdir="$(mktemp -d)"
# Drop the temp worktree on exit; otherwise factory-log stays "in use" and the next run cannot add it.
trap 'git worktree remove --force "$logdir" 2>/dev/null || true; rm -rf "$logdir"' EXIT
if git ls-remote --exit-code --heads origin factory-log >/dev/null 2>&1; then
  git fetch --quiet origin factory-log
  git worktree add --quiet "$logdir" origin/factory-log
  git -C "$logdir" checkout --quiet -B factory-log
else
  git worktree add --quiet --detach "$logdir"
  git -C "$logdir" checkout --quiet --orphan factory-log
  git -C "$logdir" rm -rf --quiet .
fi

echo "$record" >> "$logdir/runs.jsonl"
git -C "$logdir" add runs.jsonl
git -C "$logdir" commit --quiet -m "run ${GITHUB_RUN_ID:-local}: ${SKILL:-unknown} #${ISSUE:-?}"
git -C "$logdir" push --quiet origin factory-log

{
  echo "### Factory run"
  echo '```json'
  echo "$record"
  echo '```'
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
