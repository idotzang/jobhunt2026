# Job-Hunt App + AI Software Factory — Design

**Date:** 2026-10-07
**Status:** Approved in brainstorming, pending spec review

## 1. Goal

Build an **AI-first software factory** that turns GitHub tickets into production code with no human-written code, and use it to build a single-user job-hunt app (company research, interview prep, status tracking, reminders).

The factory is the primary product; the app is its proving ground. Success = within a few weeks, a live app built entirely by the factory, plus a factory that has visibly improved itself through its own ticket flow.

**Guiding principle:** ship thin, improve iteratively. Anything not listed here is a future factory ticket, not a design gap.

## 2. Constraints

- **Human input = tickets only.** The owner writes GitHub Issues and reviews/merges PRs. No steering through chat once the factory is bootstrapped.
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
PLANNER  /plan-epic → PR adding docs/specs/<epic>.md
         + creates 2–6 child issues (one PR each, acceptance criteria + proving tests)
         If epic is ambiguous: posts questions as issue comment and stops.
           │
YOU      Merge plan PR = plan approved → children labelled ai-build
           │
WORKER   /implement-ticket → branch + code + tests → PR
           │
GATES    (required status checks)
           1. Typecheck + lint     (tsc, eslint)
           2. Unit tests           (Vitest)
           3. E2E regression       (Playwright vs preview)
           4. Security             (CodeQL, npm audit, gitleaks)
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
| `plan-epic` | issue labelled `ai-plan` | Spec + child issues; ask questions on issue if ambiguous; keep `docs/architecture.md` current |
| `implement-ticket` | issue labelled `ai-build` | Code + tests → PR; fix loop on gate failures |
| `review-pr` | PR opened/synchronized | Review against ticket acceptance criteria and skills |
| `factory-retro` | PR merged or closed | Turn misbehavior evidence into skill-change PRs |

Every skill ends with the step: write a **Factory feedback** section in the PR — where this skill's instructions were unclear, wrong, or missing.

`plan-epic` borrows three habits from Superpowers (task sized to one PR; acceptance criteria + proving test per task; gap self-check) but runs headless — no interactive brainstorming, no code in plans.

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

## 6. App: walking skeleton

- Password login (env var + middleware).
- `applications` table: company, role, link, date applied.
- One page: add an application, list applications.
- Tests: one Vitest unit test; one Playwright test (login → add → see in list) — seed of the regression suite.

Later epics (written as tickets by the owner): status tracking, reminders, company research, interview prep. Research/prep will need in-app LLM calls; the API-key/cost decision for those is deferred to when those epics are written.

## 7. Bootstrap plan

The factory cannot build itself before it exists. Phases 0–2 are built in a local Claude Code session (AI-written; owner writes no code). From phase 3, tickets are the only input.

| Phase | Deliverable | Built by |
|---|---|---|
| 0 | Next.js skeleton + Neon + Vercel + password + first tests → live prod URL | Local session |
| 1 | CI gates workflow, security workflow, branch protection (required checks) | Local session |
| 2 | Claude Action workflow, `implement-ticket` skill, issue templates, thin `CLAUDE.md`; smoke test with one tiny ticket to prod | Local session + first ticket |
| 3 | `plan-epic` skill; first real epic: status tracking | Factory (tickets) |
| 4 | `review-pr` and `factory-retro` skills | Factory (`factory` tickets) |

**Owner-only manual steps** (accounts/credentials): GitHub repo (public recommended for free Actions minutes), Vercel and Neon accounts connected to the repo, `/install-github-app` in a terminal `claude` session to create the subscription token secret, choose the app password.

## 8. Deliberately out of scope (future factory tickets)

Auto-merge; coverage thresholds; performance budgets; mutation testing; staging environment; Linear integration; skill-eval gate (replay past tickets against changed skills); orchestrator + cheaper workers (Aider/OpenHands); multi-user auth; parallel agent runs.

## 9. Interview narrative

"I write tickets; the factory ships them. A planner agent writes specs and breaks epics into tasks, a worker implements behind a swappable seam, gates enforce types, tests, regression, and security, and I approve with one click from a preview URL. Agents file feedback against their own instructions, and a retro agent turns it into versioned skill changes — so the factory improves through the same ticket flow it runs on."
