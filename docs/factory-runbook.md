# Factory runbook

Operating manual for the **interactive controller session** (a human + Claude Code working on the factory itself). It is *not* read by the headless worker (that one follows `CLAUDE.md` and `.claude/skills/`). It holds durable facts only; live state (open PRs, last runs) comes from `scripts/dev/session-state.sh`, which a SessionStart hook prints when a session opens.

Design authority: `docs/superpowers/specs/2026-10-07-jobhunt-factory-design.md`. Phase 0-2 plan: `docs/superpowers/plans/2026-10-08-factory-phases-0-2.md`.

## The loop

1. Owner files an issue (templates in `.github/ISSUE_TEMPLATE/`) and adds the label `ai-build` (the approval event).
2. `factory-build.yml` runs the worker (`.claude/skills/implement-ticket`, TDD) on the owner's subscription token: branch `ai/issue-<n>-<slug>`, tests first, PR with `## What`, `## Acceptance criteria → tests`, `## Factory feedback`.
3. Gates run on the PR. On failure of an owner-authored same-repo `ai/*` PR, `factory-fix.yml` makes up to 2 automatic fix attempts (labels `fix-attempt-1/2`, marker comment `fix-attempt-sha:<sha>`), then labels `needs-human`.
4. Owner opens the preview, merges the PR. Production deploys; `prod-health` curls `/api/health`.
5. Every agent run appends one JSON line to `runs.jsonl` on the orphan branch `factory-log` (run id, skill, mode, model, turns, duration, tokens incl. cache/thinking, `cost_usd`, outcome, retries). `cost_usd` is the action's list-price estimate and is notional: the factory runs on a subscription token. Real consumption is only visible in Claude's `/usage`.

Planning branch for bigger work: owner files an epic and adds `ai-plan` -> `factory-plan.yml` opens a plan PR (`ai/plan-<epic>-<slug>`, one spec in `docs/specs/` with a machine-readable child list) -> owner discusses with `/replan` comments -> **merging the plan PR is the approval** -> `factory-sequence.yml` creates the child issues and labels only the first `ai-build` -> each child merge labels the next ready child(ren) -> after the last child merges the epic is closed.

## Workflows (`.github/workflows/`)

| File | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR, push to main | job `checks`: lint, typecheck, unit tests, tests-with-code + protected-paths gate (runs the BASE branch's copy of `scripts/factory/tests-with-code.mjs`) |
| `e2e.yml` | `deployment_status` | job `e2e-run` posts the commit **status** `e2e` (pending then success/failure); job `prod-health` on production deploys |
| `security.yml` | PR, push to main | jobs `codeql`, `npm-audit` (prod deps, high), `gitleaks` |
| `factory-build.yml` | owner adds `ai-build` | worker run, run record, redacted 7-day transcript artifact |
| `factory-fix.yml` | `workflow_run` of CI/E2E/Security failing | fix loop (see above); protected-path diff gate before any agent runs |
| `factory-plan.yml` | owner adds `ai-plan`; owner comment starting `/replan` | planner run (`plan-epic` skill): plan PR or revision |
| `factory-sequence.yml` | `ai/*` PR closed (`pull_request_target`) | plain script `scripts/factory/sequence.mjs`, no AI: on plan merge creates children; on child merge labels next ready children, closes epic after the last; unmerged child close => "paused at #n" comment |
| `neon-cleanup.yml` | PR closed; manual dispatch | deletes the PR's Neon branch `preview/<branch>`; manual sweep is dry-run by default |

## Branch protection on `main`

Required: `checks`, `e2e` (status), `codeql`, `npm-audit`, `gitleaks`, `Vercel`. Admins enforced; no force-push; no direct pushes. Merged branches are auto-deleted.

## Protected paths

PRs touching `.github/`, `.claude/`, `scripts/factory/`, `CLAUDE.md`, `AGENTS.md`, `vitest.config.mts`, `playwright.config.ts`, `eslint.config.mjs` or `vercel.json` need the PR label `factory` (owner adds after review). The worker is forbidden from touching them.

## Secrets, variables, environments (names only)

- Repo variable `FACTORY_MAX_IN_FLIGHT` (optional, default 1): children built in parallel; raising it needs a look at the single pending run in the `factory-agent` group first.
- Repo secrets: `CLAUDE_CODE_OAUTH_TOKEN` (subscription), `FACTORY_GH_TOKEN` (fine-grained PAT, must belong to the repo owner because the sequencer only trusts the epic index comment when the owner wrote it; Issues RW, Contents RW, PRs RW; Commit statuses/Actions/Checks read; **no Workflows scope**), `E2E_PASSWORD` (preview-only password, equals Vercel's Preview `APP_PASSWORD`).
- Environment `neon` (deployment branch: `main` only): `NEON_API_KEY` (project-scoped). Repo variable `NEON_PROJECT_ID`.
- Vercel env: `DATABASE_URL` (Neon integration, per-deployment DB branch for Previews), `APP_PASSWORD`, `SESSION_SECRET`.
- Never paste secret values in chat; the owner runs `gh secret set` themselves.

## Labels

`ai-build`, `ai-plan` (both must exist), `factory`, `factory-report`, `proposed`, `model:haiku|sonnet|opus` (must exist; read from the label event payload: apply BEFORE `ai-build`), `skip-tests-check`, `fix-attempt-1`, `fix-attempt-2`, `needs-human`.

## Hard-won facts

- Events caused by the default `GITHUB_TOKEN` do **not** trigger workflows. Anything that must start another workflow (e.g. a sequencer adding `ai-build`) has to act with `FACTORY_GH_TOKEN`. `factory-build.yml` additionally requires the label sender to be the repo owner and the issue author to be OWNER.
- Workflow-level `concurrency` is claimed before job `if`s; use job-level groups. A group keeps only ONE pending run: label one ticket at a time; a dropped run is recovered by removing and re-adding `ai-build`.
- Vercel reads `vercel.json` from the pushed commit, so the `factory-log` branch carries its own. The Vercel "Ignored Build Step" setting is **Automatic** (a custom command once skipped every branch).
- Neon free plan = 10 branches; one is created per preview and was never removed until `neon-cleanup.yml`. At the limit previews fail ("Branch limit reached"), `e2e` never appears and PRs cannot merge. Permanent branches: `main` (default), `dev` (local development).
- A `.gitleaksignore` entry (`<commit>:<file>:<rule>:<line>`) is the way to allow a fake test fixture; the file is not yet a protected path.
- Vercel has had a one-off platform error ("unexpected error… transient"): redeploy the failed deployment.
- Local development: Neon branch `dev` via `.env.local` (git-ignored); `npm run test:e2e` needs `APP_PASSWORD`/`E2E_PASSWORD`.

## Epics (planning and sequencing)

- `/replan` must be at the very start of an issue or PR conversation comment (epic or plan PR; not a review comment). It is refused after the plan merges. If a third agent run queues, it can be silently dropped: comment again.
- To re-plan from scratch, remove and re-add `ai-plan`.
- Plan PR closed unmerged: delete the `ai/plan-<n>-*` branch, then re-add `ai-plan`.
- Hand-edited broken plan: after merge the sequencer comments "Plan not applied" and `/replan` no longer works. Open a PR from a branch `ai/plan-<epic>-<anything>` that fixes only that spec file and merge it; the sequencer re-runs and resumes.
- Dropped or failed sequencer run: re-run the workflow (it is resumable).
- Stuck child: merge it by hand, or remove and re-add `ai-build`.
- "Sequence paused at #n" comment = that child's PR was closed unmerged.
- The plan-PR scope gate keys only on the branch name `ai/plan-<n>[-...]`.

## Controller-session conventions

- Superpowers flow: brainstorming -> writing-plans -> subagent-driven-development, one git worktree per task at `../jobhunt2026-<name>` with a `node_modules` symlink; `.superpowers/` is git-excluded scratch (ledger, briefs, reviews).
- Owner merges PRs and adds `ai-build` personally. Auto-fix (app CI monitor) is on for every PR the controller opens; auto-merge is never enabled. Vercel's "deployment ready" PR comments are noise.
- After shipping features, ask the owner to check Vercel for failed deployments (build logs are not visible to the controller).

## Backlog / known loose ends

Update this section at the end of each session (`/handoff`).

- **Phase 3 (remaining):** first live epic "Application status tracking" as the acceptance run; CI validation of plan files on `ai/plan-*` PRs; bot identity/GitHub App (planner, sequencer and worker share the owner identity); run-record PR lookup for plan runs lacks a `createdAt` filter; planner `resolve` step runs after checkout/npm ci; single-pending-run risk grows with the sequencer and `/replan`.
- **Phase 4:** `review-pr`, `factory-retro`, `factory-report` skills; then AI plan reviewer + auto-merge (spec §9).
- **Security follow-ups:** the PAT can merge PRs (only skill text and owner attention prevent it; a hard barrier needs a bot identity/GitHub App + required approval); copy the transcript redactor to `$RUNNER_TEMP` before the agent step; make `.gitleaksignore` a protected path; unprotected files that affect agent runs (`package.json`, lockfile, `.npmrc`, `tsconfig`, `next.config.*`, `.gitattributes`).
- **Quality follow-ups:** the fix loop's `e2e`-failure path has not been exercised live (only a `checks` failure); half-applied fix attempt (marker posted, label add fails) is silent; run records omit gate results; `record-run.sh` can duplicate a record if a push succeeded but reported failure.
- **App:** login has no rate limit or logout; session token is static.
