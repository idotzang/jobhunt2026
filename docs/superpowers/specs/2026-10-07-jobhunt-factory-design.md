# Job-Hunt App + AI Software Factory — Design

**Date:** 2026-10-07
**Status:** Approved in brainstorming, pending spec review

## 1. Goal

Build an **AI-first software factory** that turns GitHub tickets into production code with no human-written code, and use it to build a single-user job-hunt app (company research, interview prep, status tracking, reminders).

The factory is the primary product; the app is its proving ground. Success = within a few weeks, a live app built entirely by the factory, plus a factory that has visibly improved itself through its own ticket flow.

**Guiding principle:** ship thin, improve iteratively. Anything not listed here is a future factory ticket, not a design gap.

## 2. Constraints

- **Human input = tickets and approvals only.** Phase 1 of the factory's life: the owner writes epics, approves plans + tickets (by merging the plan PR), and merges code PRs. No steering through chat once the factory is bootstrapped.
- **Long-term goal: automate the approvals too.** Plan review and merge review are later replaced by AI reviewers + auto-merge. Every human approval is therefore a single discrete GitHub event (a merge) so it can later be performed by a bot without redesigning the flow.
- **Single user.** No multi-user auth.
- **Cost-aware.** Agents run on the owner's Claude subscription (`CLAUDE_CODE_OAUTH_TOKEN`, generated via `claude setup-token` / `/install-github-app`), not an API key. One agent run at a time; turn caps on every run.
- **Human-triggered only.** Every agent run is triggered by a human action (label, comment, merge, close) — no cron-driven agents. Keeps usage predictable and on the conservative side of subscription terms.

## 3. Stack

| Concern | Choice |
|---|---|
| App | Next.js (TypeScript), App Router |
| Database | Neon Postgres (branch per PR preview) |
| Hosting | Vercel (preview deploy per PR, prod deploy on merge to `main`) |
| Auth | Single password in env var, checked in middleware |
| Unit tests | Vitest |
| E2E / regression | Playwright, run against the Vercel preview URL |
| Tracker | GitHub Issues + labels |
| Agent runtime | `anthropics/claude-code-action@v1` in GitHub Actions |

## 4. Factory architecture

### 4.1 Flow

```
YOU      Epic issue (WHAT / WHY / Done when / Out of scope)   label: ai-plan
           │
PLANNER  /plan-epic → PR adding docs/specs/<epic>.md, which contains the spec
         AND 2–6 drafted child tickets (one PR each, acceptance criteria + proving tests).
         No issues are created yet. If epic is ambiguous: posts questions as
         issue comment and stops.
           │
YOU      Review plan PR (edit/comment on spec and tickets) → merge
         = plan AND tickets approved in one review
           │
SCRIPT   (plain workflow, no AI) on plan merge: creates the child issues from
         the spec file and labels ONLY the first one ai-build.
         Each time a child's PR merges, the next child is labelled ai-build.
         → children run sequentially, each on top of the previous one's code.
           │
WORKER   /implement-ticket (TDD, see §4.5) → branch + tests + code → PR
           │
GATES    (required status checks)
           1. Typecheck + lint     (tsc, eslint)
           2. Unit tests           (Vitest)
           3. E2E regression       (Playwright vs preview)
           4. Security             (CodeQL, npm audit, gitleaks)
           5. Tests-with-code      (source changes must include test changes)
         On failure: worker reads failure, pushes fix (max 2 retries),
         then comments on the issue asking for help.
           │
REVIEWER /review-pr → review comments on PR
           │
YOU      Open preview URL, one-click merge
           │
DEPLOY   Vercel → production; issue auto-closes
           │
RETRO    /factory-retro on PR merged/closed (see §5)
```

Small tickets may skip planning: label `ai-build` directly.

### 4.2 Labels

- `ai-plan` — run planner on this epic
- `ai-build` — run worker on this ticket
- `model:haiku` / `model:sonnet` / `model:opus` — optional model override (default: sonnet)
- `factory` — ticket concerns the factory itself (skills, workflows, gates)
- `factory-report` — run the factory-report analysis (§6.1)

### 4.3 Worker seam

"Implement a ticket" is a single replaceable step with a fixed contract: **in** = issue text + repo; **out** = branch with commits + opened PR linked to the issue. Day one the worker is Claude Code. Future: Claude orchestrates, a cheaper worker (e.g. Aider + cheaper model) implements. Only this step changes; gates, review, deploy are untouched.

### 4.4 Repo as memory

Agents have no memory between runs. Everything they need lives in the repo:

- `CLAUDE.md` — **thin**, ~5 lines: what the app is, "all work follows a skill in `.claude/skills/`", "skills are expected to improve", "report skill problems in a *Factory feedback* PR section; never silently work around them".
- `.claude/skills/<name>/SKILL.md` — agent roles; the factory's source of truth.
- `docs/architecture.md` — one-page map (data model, modules); maintained by the planner.
- `docs/specs/*.md` — one spec per epic, linked from child issues.
- `.github/ISSUE_TEMPLATE/` — epic and task templates enforcing outcome-level tickets.

### 4.5 Skills

| Skill | Trigger | Responsibility |
|---|---|---|
| `plan-epic` | issue labelled `ai-plan` | Spec + drafted child tickets in one plan PR; ask questions on issue if ambiguous; keep `docs/architecture.md` current |
| `implement-ticket` | issue labelled `ai-build` | TDD: failing test → code → refactor → PR; fix loop on gate failures |
| `review-pr` | PR opened/synchronized | Review against ticket acceptance criteria and skills |
| `factory-retro` | PR merged or closed | Turn misbehavior evidence into skill-change PRs |
| `factory-report` | issue labelled `factory-report` | Analyze the run log; report trends; propose `factory` tickets (§6) |

Every skill ends with the step: write a **Factory feedback** section in the PR — where this skill's instructions were unclear, wrong, or missing.

`plan-epic` borrows three habits from Superpowers (task sized to one PR; acceptance criteria + proving test per task; gap self-check) but runs headless — no interactive brainstorming, no code in plans.

**`implement-ticket` is TDD**, modelled on Superpowers' test-driven-development skill:
1. For each acceptance criterion, write the test first and run it — it must fail for the expected reason (commit: `test: …`).
2. Write the minimal code to pass; run it green (commit: `feat: …` / `fix: …`).
3. Refactor with tests green.
4. Run the full suite locally before opening the PR.

The commit sequence makes red→green visible in PR history. A cheap shell gate (**tests-with-code**) fails any PR that changes app source without changing tests.

## 5. Self-improvement loop (skill-based)

**Evidence sources** (all attached to the PR):
1. Objective: gate failures, fix-loop retries, turn-limit exhaustion.
2. Human: requested changes, review comments, PR closed unmerged.
3. Agent self-report: the *Factory feedback* section.

**Retro flow:**
1. On PR merged/closed, a shell pre-check (no AI) looks for any evidence above. None → exit at zero cost.
2. Otherwise `/factory-retro` attributes the problem to a skill and opens a **PR editing that `SKILL.md`**, citing evidence (links to PRs/comments).
3. Owner merges or rejects, same one-click flow as code.

Factory changes beyond skills (new gates, workflow changes) are filed as `factory` tickets and built by the factory.

## 6. Observability

### 6.1 Factory

The factory must be able to research its own behavior. Every agent run leaves a record:

- **Run record** — one JSON line per agent run, appended to `runs.jsonl` on a dedicated `factory-log` branch (git-native, permanent, readable by agents). Fields: `run_id`, `timestamp`, `skill`, `issue`, `pr`, `model`, `turns`, `duration_s`, token usage (when the action reports it), `outcome` (`pr_opened` / `fixed` / `asked_human` / `turn_limit` / `failed`), `retries`, gate results. Built by a plain workflow step from the action's execution output — no AI.
- **Transcripts** — the full agent transcript for each run uploaded as a GitHub Actions artifact (retained per GitHub's artifact retention).
- **Job summary** — a short human-readable summary on each workflow run page.
- **Research** — `factory-report` skill (human-triggered via a `factory-report` issue) reads `runs.jsonl` and recent retro PRs and posts: success rate per skill, retries and turns per ticket, recurring Factory-feedback themes, model mix. It proposes `factory` tickets; it does not change anything itself.
- `factory-retro` also reads the run record of the PR it is examining.

### 6.2 App

- **Structured logging** — JSON logs (pino) with a request ID on every request; errors logged with context. Viewed in Vercel runtime logs.
- **Health** — `/api/health` endpoint (app + DB connectivity), checked by a post-deploy step after each production deploy; failure opens an issue.
- Error tracking service (e.g. Sentry) is an early `factory` ticket, not day one.

## 7. App: walking skeleton

- Password login (env var + middleware).
- `applications` table: company, role, link, date applied.
- One page: add an application, list applications.
- Structured logging + `/api/health` (§6.2).
- Tests: one Vitest unit test; one Playwright test (login → add → see in list) — seed of the regression suite.

Later epics (written as tickets by the owner): status tracking, reminders, company research, interview prep. Research/prep will need in-app LLM calls; the API-key/cost decision for those is deferred to when those epics are written.

## 8. Bootstrap plan

The factory cannot build itself before it exists. Phases 0–2 are built in a local Claude Code session (AI-written; owner writes no code). From phase 3, tickets are the only input.

| Phase | Deliverable | Built by |
|---|---|---|
| 0 | Next.js skeleton + Neon + Vercel + password + logging + health + first tests → live prod URL | Local session |
| 1 | CI gates workflow, security workflow, tests-with-code gate, branch protection (required checks) | Local session |
| 2 | Claude Action workflow, TDD `implement-ticket` skill, run-record logging to `factory-log`, issue templates, thin `CLAUDE.md`; smoke test with one tiny ticket to prod | Local session + first ticket |
| 3 | `plan-epic` skill + child-issue creation/sequencing workflow; first real epic: status tracking | Factory (tickets) |
| 4 | `review-pr`, `factory-retro`, `factory-report` skills | Factory (`factory` tickets) |

**Owner-only manual steps** (accounts/credentials): GitHub repo (public recommended for free Actions minutes), Vercel and Neon accounts connected to the repo, `/install-github-app` in a terminal `claude` session to create the subscription token secret, choose the app password.

## 9. Deliberately out of scope (future factory tickets)

**Next factory phase (the stated long-term goal):** AI plan reviewer replacing human plan approval; auto-merge when gates + AI review pass. Enabled once run-log data shows the gates are trustworthy.

Other: coverage thresholds; error tracking service; performance budgets; mutation testing; staging environment; Linear integration; skill-eval gate (replay past tickets against changed skills); orchestrator + cheaper workers (Aider/OpenHands); multi-user auth; parallel agent runs.

## 10. Interview narrative

"I write tickets; the factory ships them. A planner agent writes specs and breaks epics into tasks, a worker implements behind a swappable seam, gates enforce types, tests, regression, and security, and I approve with one click from a preview URL. Agents file feedback against their own instructions, and a retro agent turns it into versioned skill changes — so the factory improves through the same ticket flow it runs on."
