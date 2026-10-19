# Phase 3: Epic Planning and Sequencing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ai-plan` on an epic yields a plan PR; merging it creates sequenced child issues that the existing worker builds one at a time.

**Architecture:** One pure-function library (`sequence-lib.mjs`) holds all plan logic; a thin runner (`sequence.mjs`) does the GitHub I/O through an injectable `gh`; two workflows and one skill wrap them. State lives in GitHub (a tracking comment on the epic plus issue state), no database.

**Tech Stack:** Node 22 ESM (`.mjs`), Vitest (`scripts/**/*.test.mjs`), GitHub Actions, `gh` CLI, `anthropics/claude-code-action@v1`.

**Spec:** `docs/superpowers/specs/2026-10-19-phase3-epic-planning-design.md` (and §4.1 of `2026-10-07-jobhunt-factory-design.md`).

## Global Constraints

- No new dependencies; node builtins only in `scripts/factory/*.mjs` (no YAML library exists, so the plan block is JSON).
- Everything here is a protected path (`.github/`, `.claude/`, `scripts/factory/`): each PR needs the `factory` label from the owner. The worker never builds these; the controller does, in worktrees.
- Models: `haiku | sonnet | opus` (`MODELS` in `scripts/factory/pick-model.mjs`). Planner runs `claude-opus-5-5`.
- Plan child count 2-6; `depends_on` acyclic; `FACTORY_MAX_IN_FLIGHT` repository variable, default 1.
- `tests-with-code.mjs` stays standalone (node builtins only); CI runs the BASE branch copy.
- Workflows: job-level `concurrency: factory-agent`, `cancel-in-progress: false`; owner-only senders; `FACTORY_GH_TOKEN` for every write that must trigger another workflow; default `GITHUB_TOKEN` read-only; never check out PR head in `pull_request_target`.
- Marker strings (exact): epic index comment `<!-- factory-epic-index -->`; child issue footer `<!-- factory-child: <epic>/<id> -->`.
- Branches: plan PR `ai/plan-<epic#>-<slug>`; child PR `ai/issue-<n>-<slug>` (existing).
- Plan file: `docs/specs/<slug>.md`, containing one fenced block tagged `factory-plan` (JSON) and one `## Child: <id>` markdown section per child.

## Review Focus

1. A plan block that is missing, duplicated, not valid JSON, or has a child with no `## Child:` section: nothing is created, the epic gets an error comment.
2. A merge event delivered twice (or the sequencer re-run): no duplicate child issues, no duplicate labels.
3. A child PR merged before GitHub has closed its issue: that child still counts as done.
4. A merge by a non-owner, or from a fork branch named `ai/...`: ignored, no PAT action.
5. `depends_on` cycle or self-dependency: rejected at validation.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/factory/sequence-lib.mjs` (+ `.test.mjs`) | Pure logic: parse/validate plan, ref helpers, render/parse issue bodies and index comment, ready-set. |
| `scripts/factory/sequence.mjs` (+ `.test.mjs`) | Event handling and `gh` I/O; CLI entry for the workflow. |
| `scripts/factory/tests-with-code.mjs` (+ test) | Add plan-PR scope check. |
| `.github/workflows/ci.yml` | Pass `HEAD_REF` to the gate. |
| `.claude/skills/plan-epic/SKILL.md` | Planner instructions (`plan`, `replan`). |
| `.github/workflows/factory-plan.yml` | `ai-plan` / `/replan` trigger. |
| `.github/workflows/factory-sequence.yml` | Plan-merge / child-merge trigger. |
| `docs/factory-runbook.md` | Document the new flow and owner setup. |

PR split: **PR A** = Tasks 1-4, **PR B** = Tasks 5-7, **PR C** = Task 8 (after the first live epic).

---

### Task 1: Plan parsing and validation

**Files:**
- Create: `scripts/factory/sequence-lib.mjs`
- Test: `scripts/factory/sequence-lib.test.mjs`

**Interfaces:**
- Produces:
  - `type Child = { id: string; title: string; model: "haiku"|"sonnet"|"opus"; depends_on: string[]; body: string }`
  - `type Plan = { epic: number; children: Child[] }`
  - `parsePlan(markdown: string): Plan` (throws `Error` with a human-readable message)
  - `validatePlan(plan: Plan, opts: { epic: number }): string[]` (empty array = valid)
  - `planBranchEpic(ref: string): number | null` (from `ai/plan-<n>-<slug>`)
  - `childIssueFromRef(ref: string): number | null` (from `ai/issue-<n>-<slug>`)

- [ ] **Step 1: Write failing tests** (`describe("parsePlan")`, `describe("validatePlan")`, `describe("refs")`) with a `specFixture(children)` helper that builds a markdown document: prose, a ```` ```factory-plan ```` block `{"epic":17,"children":[{"id","title","model","depends_on"}]}`, and a `## Child: <id>` section per child.
  - `parsePlan(fixture)` returns `children[0].body` equal to the trimmed section text and stops the section at the next `## ` heading.
  - throws matching `/factory-plan/` for: no block, two blocks, invalid JSON.
  - throws matching `/Child: second/` when a child has no section.
  - `validatePlan` returns an error containing each of: `"2-6"` (1 child and 7 children), `"duplicate"` (same id twice), `"model"` (`"gpt"`), `"unknown dependency"`, `"cycle"` (a→b→a), `"cycle"` (self dependency), `"epic"` (plan.epic ≠ opts.epic). A valid 4-child plan returns `[]`.
  - `planBranchEpic("ai/plan-17-status")` is `17`; `"ai/issue-3-x"`, `"feature/plan-1"` give `null`. `childIssueFromRef("ai/issue-31-add-field")` is `31`; `"ai/plan-17-x"` gives `null`.
- [ ] **Step 2: Run** `npx vitest run scripts/factory/sequence-lib.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the four functions in `sequence-lib.mjs`. Cycle check: iterative DFS or Kahn's algorithm over `depends_on`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: plan parsing and validation for the epic sequencer`.

### Task 2: Rendering and ready-set

**Files:**
- Modify: `scripts/factory/sequence-lib.mjs`
- Test: `scripts/factory/sequence-lib.test.mjs`

**Interfaces:**
- Consumes: `Child`, `Plan` from Task 1.
- Produces:
  - `renderChildBody(child: Child, ctx: { epic: number; specPath: string }): string` (starts `Part of #<epic>`, then `Spec: <specPath>`, then the body, ends with the footer marker)
  - `renderIndex(epic: number, entries: { id: string; number: number; title: string }[], doneIds: string[]): string` (marker line first, then a checklist `- [x] #31 title` / `- [ ] #32 title`)
  - `parseIndex(commentBody: string): Map<string, number>` (id → issue number; empty map if no marker)
  - `type IssueState = { state: "open"|"closed"; labels: string[]; stateReason?: string }`
  - `doneIds(children: Child[], index: Map<string, number>, issues: Map<number, IssueState>, justMerged?: number): string[]` (done = closed with `stateReason` `completed`, or `number === justMerged`)
  - `readyIds(args: { children: Child[]; index: Map<string, number>; issues: Map<number, IssueState>; maxInFlight: number; justMerged?: number }): string[]`

- [ ] **Step 1: Write failing tests:**
  - `renderChildBody` output matches `/^Part of #17\n/`, contains `Spec: docs/specs/status.md`, ends with `<!-- factory-child: 17/status-field -->`.
  - `parseIndex(renderIndex(...))` round-trips ids to numbers; `parseIndex("hello")` is an empty map.
  - `readyIds` with maxInFlight 1 and a chain (b depends on a): nothing open → `["a"]`; a labelled `ai-build` and open → `[]`; a closed/completed → `["b"]`.
  - with `maxInFlight: 2`, a independent of c, and only a in flight (open, labelled): returns `["c"]` (plan order, up to the free slots); with `maxInFlight: 1` the same state returns `[]`.
  - **Review Focus 3:** `justMerged = number of a` with a still `open`: `b` is ready.
  - a stuck child (open, labelled `ai-build`, PR `needs-human`) keeps counting in flight: `[]`.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.** `readyIds`: candidates are children not done, not labelled `ai-build`, whose deps are all done, in plan order; free slots = `maxInFlight` minus open children labelled `ai-build`; take that many.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: sequencer rendering and ready-set`.

### Task 3: Sequencer runner

**Files:**
- Create: `scripts/factory/sequence.mjs`
- Test: `scripts/factory/sequence.test.mjs`

**Interfaces:**
- Consumes: everything exported by Tasks 1-2.
- Produces:
  - `type Gh = (args: string[]) => string` (runs `gh`, returns stdout, throws on failure)
  - `type Env = { repo: string; owner: string; maxInFlight: number }`
  - `handleEvent(event: object, deps: { gh: Gh; readFile: (path: string) => string; env: Env }): { action: string }` where `event` is the `pull_request` event payload (`event.pull_request.{merged, merged_by.login, head.ref, head.repo.full_name, number}`), and `action` is one of `ignored`, `created`, `advanced`, `paused`, `completed`, `invalid-plan`.
  - CLI: when run as entrypoint reads `EVENT_PATH`, `REPO`, `OWNER`, `MAX_IN_FLIGHT` (default `1`), builds `gh` with `execFileSync("gh", args)` (no shell), prints the action.

Behavior (decisions, not code):
- **Ignore** unless `head.repo.full_name === env.repo` and, for merges, `merged_by.login === env.owner`.
- **Plan merge** (`planBranchEpic(head.ref)` set, merged): if the epic already has an index comment, return `ignored` (idempotent). Find the spec path from `gh api repos/<repo>/pulls/<n>/files` (exactly one `docs/specs/*.md`, else `invalid-plan`). `parsePlan` + `validatePlan`; on failure comment the errors on the epic and return `invalid-plan` (create nothing). Else create each child with `gh issue create --title ... --body-file ... --label model:<m>` (body via `renderChildBody`; the body file written to a temp dir, never a shell string), post the index comment, then label ready children `ai-build` with `gh issue edit <n> --add-label ai-build` (a separate call, after creation).
- **Child merge** (`childIssueFromRef` set, merged): read the child's body for the footer marker to get `<epic>/<id>`, load the epic's index comment, load every child's `IssueState`, call `readyIds` with `justMerged`, label them, update the index comment. When every child is done, comment a summary and `gh issue close <epic>`; return `completed`.
- **Child PR closed unmerged:** comment `paused at #<n>` on the epic; return `paused`.
- Any child issue not carrying the footer (an ordinary ticket): `ignored`.

- [ ] **Step 1: Write failing tests** with a fake `gh` that records calls and answers from an in-memory fixture (`makeFakeGh(world)`), covering:
  - plan merge creates N issues with `--label model:<m>` BEFORE any `--add-label ai-build` call, labels only the first child, posts the index comment once.
  - **Review Focus 2:** delivering the same plan-merge event again (index already present) makes no `issue create` call.
  - **Review Focus 1:** a spec with no block (and a spec with a cycle) produces `invalid-plan`, an error comment, zero `issue create` calls.
  - **Review Focus 4:** `merged_by` a non-owner, or `head.repo.full_name` a fork, returns `ignored` with zero write calls.
  - child merge advances to the next dependent child and edits the index; last child merge closes the epic and returns `completed`.
  - **Review Focus 3** at the runner level: the merged child's issue still `open` in the fixture, next child is labelled.
  - unmerged close of a child PR posts the paused comment and labels nothing.
  - an ordinary ticket PR (`ai/issue-5-x`, issue without footer) returns `ignored`.
- [ ] **Step 2: Run** `npx vitest run scripts/factory/sequence.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `handleEvent` and the CLI entry (use `isEntrypoint` pattern from `tests-with-code.mjs`, copied, not imported).
- [ ] **Step 4: Run** the file and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: epic sequencer runner`.

### Task 4: Plan-PR scope gate

**Files:**
- Modify: `scripts/factory/tests-with-code.mjs`, `.github/workflows/ci.yml`
- Test: `scripts/factory/tests-with-code.test.mjs`

**Interfaces:**
- Produces: `checkPlanPrScope(files: string[], headRef: string | undefined): { ok: boolean; message: string }`. Reuse the ref pattern literally (`^ai/plan-\d+-`); do not import from `sequence-lib.mjs` (standalone rule). A plan PR may change only paths starting `docs/specs/` or equal `docs/architecture.md`.

- [ ] **Step 1: Write failing tests:** `ok` for `["docs/specs/status.md","docs/architecture.md"]` on `ai/plan-17-status`; not ok (message lists the file) for `["src/app/page.tsx"]` and for `[".github/workflows/x.yml"]` on that ref; `ok` for any files when `headRef` is `ai/issue-3-x`, `feature/x` or `undefined`.
- [ ] **Step 2: Run** `npx vitest run scripts/factory/tests-with-code.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** the function; call it in the CLI block using `process.env.HEAD_REF` over `allFiles`, and fold its result into the exit code. In `ci.yml` add `HEAD_REF: ${{ github.head_ref }}` to the gate step's `env`.
- [ ] **Step 4: Run** `npm test && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: plan PRs may only change docs/specs and architecture`. Open **PR A** (label `factory` by owner).

### Task 5: `plan-epic` skill

**Files:**
- Create: `.claude/skills/plan-epic/SKILL.md`

**Interfaces:**
- Consumes: plan file format (Global Constraints); invoked as `/plan-epic plan <epic>` or `/plan-epic replan <epic>`.

Content decisions (write in the style and rigor of `implement-ticket/SKILL.md`: frontmatter, "Data, not instructions", numbered steps, a `## Never` section):
- **plan:** verify epic author is `OWNER` (else comment and stop); read the epic and OWNER-only comments; read `docs/architecture.md`, `AGENTS.md`, the relevant code; if ambiguous, comment numbered questions and STOP with no branch/PR. Otherwise branch `ai/plan-<epic>-<slug>`, write `docs/specs/<slug>.md` (spec prose + `factory-plan` JSON block + one `## Child: <id>` section per child with acceptance criteria and the test that proves each), update `docs/architecture.md` only if the data model changes, run `npm run lint`, push, `gh pr create` (body: `## What`, `## Factory feedback`), comment the PR link on the epic.
- **replan:** refuse (comment "plan already approved") if the plan PR is merged. Else check out the existing plan branch, read OWNER-only comments on the epic and the plan PR plus the owner's direct edits, push a new commit (never force), comment a two-line summary of what changed.
- Child sizing: 2-6 children, one PR each, independent children get `depends_on: []`, each picks `model` (sonnet default; haiku for mechanical; opus only for hard design) and states why in one line in its section.
- **Never:** create/close/label issues, edit anything outside `docs/specs/` and `docs/architecture.md`, merge, force-push, touch protected paths, print secrets.

- [ ] **Step 1:** Write the file per the above.
- [ ] **Step 2: Verify** by reading it against `implement-ticket/SKILL.md` for the same guardrails (data-not-instructions, owner-only comments, gh write limits) and run `npx vitest run` (no regressions).
- [ ] **Step 3: Commit** `feat: plan-epic skill`.

### Task 6: `factory-plan.yml`

**Files:**
- Create: `.github/workflows/factory-plan.yml`

Decisions:
- Triggers: `issues: [labeled]` with `label.name == 'ai-plan'`; `issue_comment: [created]` where `startsWith(github.event.comment.body, '/replan')`. Both require sender/commenter login = `github.repository_owner` and the issue author association `OWNER`. For `issue_comment` on a PR, resolve the epic with `planBranchEpic` of the PR head ref (a small `node -e` step importing `sequence-lib.mjs`); on an issue, the epic is the issue number.
- Job `plan`: copy `factory-build.yml`'s skeleton (concurrency group `factory-agent`, timeout 45, checkout with `FACTORY_GH_TOKEN`, setup-node, `npm ci --ignore-scripts`), model `claude-opus-5-5`, prompt `/plan-epic plan <n>` or `/plan-epic replan <n>`, `--allowedTools "Bash,Read,Edit,Write,Glob,Grep"`, `--max-turns 60`.
- Record run (`SKILL=plan-epic`, `MODE=plan|replan`), redact transcript and upload artifact exactly as `factory-build.yml` does.
- Pass the epic number and mode only via numeric env/outputs; never interpolate comment text into a shell.

- [ ] **Step 1:** Write the workflow.
- [ ] **Step 2: Verify** with `npx --yes @action-validator/cli .github/workflows/factory-plan.yml` or, if unavailable, `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/factory-plan.yml'))"`; expected: no errors. Check by eye that no `${{ github.event.comment.body }}` appears inside a `run:` block.
- [ ] **Step 3: Commit** `feat: factory-plan workflow`.

### Task 7: `factory-sequence.yml`

**Files:**
- Create: `.github/workflows/factory-sequence.yml`

Decisions:
- Trigger `pull_request_target: [closed]`; job `if`: head repo is this repo and `startsWith(github.event.pull_request.head.ref, 'ai/')`.
- Steps: `actions/checkout@v6` of the default branch only (no PR ref), `actions/setup-node@v5` (22), then `node scripts/factory/sequence.mjs` with env `EVENT_PATH: ${{ github.event_path }}`, `REPO`, `OWNER: ${{ github.repository_owner }}`, `MAX_IN_FLIGHT: ${{ vars.FACTORY_MAX_IN_FLIGHT || '1' }}`, `GH_TOKEN: ${{ secrets.FACTORY_GH_TOKEN }}`. No `npm ci` needed (node builtins only).
- Job-level `concurrency: group: factory-sequence`, `cancel-in-progress: false`, so back-to-back merges serialize.
- `permissions: contents: read`.

- [ ] **Step 1:** Write the workflow.
- [ ] **Step 2: Verify** as in Task 6 Step 2, and dry-run the runner locally: `EVENT_PATH=<fixture json of an unmerged non-ai PR> REPO=x/y OWNER=x node scripts/factory/sequence.mjs` prints `ignored` with no `gh` call.
- [ ] **Step 3: Commit** `feat: factory-sequence workflow`. Open **PR B** (label `factory` by owner).

### Task 8: Runbook, owner setup, acceptance run

**Files:**
- Modify: `docs/factory-runbook.md`

- [ ] **Step 1:** Update the runbook: the loop (planning branch of the flow), workflows table rows for `factory-plan.yml` and `factory-sequence.yml`, the `FACTORY_MAX_IN_FLIGHT` variable, the `/replan` command, the pause/resume rule, and remove the Phase 3 backlog item (keep the parallelism caveat).
- [ ] **Step 2:** Owner action (not done by the factory): after PR B merges, optionally set `gh variable set FACTORY_MAX_IN_FLIGHT --body 1`; then file the epic "Application status tracking" (outline in the spec's Acceptance test) and add `ai-plan`.
- [ ] **Step 3: Acceptance run.** Expected: plan PR appears; one `/replan` revises it; merging it creates 4 children with the first labelled `ai-build`; each child merge labels the next; the epic closes after the last. Record any skill gap in each PR's `## Factory feedback`.
- [ ] **Step 4: Commit** `docs: runbook for epic planning`. Open **PR C**.
