#!/usr/bin/env bash
# Print a short, READ-ONLY snapshot of live project state for an interactive session.
# Meant for a SessionStart hook (stdout goes into the session's context). Durable facts live in
# docs/factory-runbook.md; this prints only what changes: git, open PRs/issues, recent runs.
# Fail-soft: any section that cannot be read prints "(unavailable)" and the script exits 0.
# The GitHub queries run in parallel so the whole thing takes a few seconds.
set -u
export GH_PROMPT_DISABLED=1 NO_COLOR=1

cd "$(dirname "$0")/../.." 2>/dev/null || exit 0
REPO="$(git remote get-url origin 2>/dev/null | sed -E 's#.*github.com[:/]##; s#\.git$##')"

echo "# Project state (live, read-only) - $(date -u +%Y-%m-%dT%H:%MZ)"
echo "Read docs/factory-runbook.md for conventions, infra and the backlog."

echo
echo "## Git"
git fetch -q origin 2>/dev/null || echo "(fetch failed; showing local refs)"
echo "branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null)  main: $(git log -1 --format='%h %s' origin/main 2>/dev/null | cut -c1-90)"
echo "uncommitted files here: $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
wt="$(git worktree list 2>/dev/null | tail -n +2 | awk '{print $1" "$3}')"
[ -n "$wt" ] && printf 'extra worktrees (remove stale ones):\n%s\n' "$wt"

if ! command -v gh >/dev/null 2>&1 || [ -z "$REPO" ]; then
  echo
  echo "(gh not available or no origin remote: skipping GitHub sections)"
  exit 0
fi

TMP="$(mktemp -d 2>/dev/null)" || exit 0
trap 'rm -rf "$TMP"' EXIT

# Each query writes its own file; they run concurrently.
{
  gh pr list --repo "$REPO" --state open --limit 10 --json number,title,headRefName,labels \
    --jq '.[] | "#\(.number) \(.headRefName) [\(.labels|map(.name)|join(","))] \(.title[0:70])"' 2>/dev/null \
    || echo "(unavailable)"
} > "$TMP/1" &
{
  gh issue list --repo "$REPO" --state open --limit 10 --json number,title,labels \
    --jq '.[] | "#\(.number) [\(.labels|map(.name)|join(","))] \(.title[0:70])"' 2>/dev/null \
    || echo "(unavailable)"
} > "$TMP/2" &
n=3
for wf in "CI" "E2E" "Security" "Factory · build" "Neon cleanup"; do
  {
    gh run list --repo "$REPO" --workflow "$wf" --limit 12 --json conclusion,createdAt,headBranch,event \
      --jq "[.[] | select(.conclusion != \"skipped\" and .conclusion != \"\")][0] | if . then \"$wf: \(.conclusion) \(.createdAt[0:16]) (\(.event), \(.headBranch))\" else \"$wf: no runs\" end" 2>/dev/null \
      || echo "$wf: (unavailable)"
  } > "$TMP/$n" &
  n=$((n + 1))
done
{
  id="$(gh api "repos/$REPO/deployments?environment=Production&per_page=1" --jq '.[0].id' 2>/dev/null)"
  if [ -n "$id" ]; then
    gh api "repos/$REPO/deployments/$id/statuses" --jq '.[0] | "\(.state) \(.created_at[0:16]) \(.environment_url)"' 2>/dev/null || echo "(unavailable)"
  else
    echo "(unavailable)"
  fi
} > "$TMP/9" &
{
  git fetch -q origin factory-log 2>/dev/null
  git show origin/factory-log:runs.jsonl 2>/dev/null | tail -1 | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        const r = JSON.parse(s);
        const v = (x) => (x === null || x === undefined ? "n/a" : x);
        console.log(`run ${v(r.run_id)} ${v(r.mode)} ${v(r.model)} turns=${v(r.turns)} outcome=${v(r.outcome)} cost_usd=${v(r.cost_usd)} (list-price, notional)`);
      } catch { console.log("(none or unreadable)"); }
    });' 2>/dev/null || echo "(unavailable)"
} > "$TMP/10" &
wait

echo; echo "## Open PRs";    r="$(cat "$TMP/1")"; echo "${r:-none}"
echo; echo "## Open issues"; r="$(cat "$TMP/2")"; echo "${r:-none}"
echo; echo "## Latest non-skipped runs (the fix loop's own runs are in the run record below)"
cat "$TMP/3" "$TMP/4" "$TMP/5" "$TMP/6" "$TMP/7"
echo; echo "## Last agent run record (factory-log)"; cat "$TMP/10"
echo; echo "## Latest production deployment"; cat "$TMP/9"
echo
echo "Reminder: after shipping a feature, ask the owner to check Vercel for failed deployments."
exit 0
