# Phase 3 design: epic planning and sequenced execution

Status: draft for owner approval. Extends §4.1 of `2026-10-07-jobhunt-factory-design.md` (that spec stays the authority for everything not changed here). Decisions marked **(owner)** were made by the owner in the brainstorm; **(call)** marks a decision the designer made and the owner should check.

## Intent

The owner files one epic issue and the factory delivers it as several small PRs without further steering. Planning is the one step where a human still reviews, because the factory is young; the design must make that review a single discrete GitHub event so a bot can take it over later (spec §1).

## Goals

- `ai-plan` on an epic produces a **plan PR**: `docs/specs/<epic-slug>.md` holding the spec and 2-6 child tickets in machine-readable form.
- The owner can discuss and change the plan before approving, using only GitHub (no chat steering).
- Merging the plan PR creates the child issues and starts the first one. Each later child starts when the previous one's PR merges.
- First real use: epic "Application status tracking" (see Acceptance test).

## Non-goals

- AI plan review and auto-merge (Phase 4).
- Running children in parallel. The data model and sequencer support it (see "Parallelism"), but it is off and untested above 1.
- Editing a plan after it is merged (file a new epic or edit child issues by hand).
- A UI for epics.

## Anti-goals

- The planner must never create issues, label anything, or touch code. A plan that silently becomes different at creation time (e.g. an LLM re-interpreting it) is a failure: creation is a plain script reading the merged file.
- A stuck child must never be silently skipped.

## Flow

1. Owner files an epic (template `epic.yml`) and adds `ai-plan`.
2. `factory-plan.yml` runs the `plan-epic` skill. If the epic is ambiguous the skill comments questions on the epic and stops (no PR). Otherwise it opens PR `ai/plan-<epic#>-<slug>` adding the spec file (and updating `docs/architecture.md` if the plan changes the data model), and comments the PR link on the epic.
3. **Discussion (owner).** The owner comments on the epic issue (or the plan PR) in normal prose, and may also edit the spec file directly. A comment whose first line is `/replan` (from the owner only) starts a revision run: the skill reads the owner's comments on the epic and the PR, then pushes a new commit to the same plan branch. Other comments never start a run. (Command-only on purpose; the owner may later switch to "every comment".)
4. **Approval (owner).** Merging the plan PR. It needs the normal gates; because it only touches docs it needs no `factory` label.
5. `factory-sequence.yml`, on that merge, runs `scripts/factory/sequence.mjs` (plain script, no AI): parses the spec file on `main`, creates one issue per child with the PAT, adds each child's `model:*` label at creation, then labels the ready children `ai-build` (separately, after the model label, because the model is read from the label event payload).
6. Each child runs through the existing `factory-build.yml` unchanged. When a child PR merges, `factory-sequence.yml` runs again, recomputes which children are ready and labels them.
7. After the last child merges the sequencer comments a summary on the epic and closes it.

## Plan file format

`docs/specs/<epic-slug>.md`: prose spec for people and the worker, plus one fenced block tagged `factory-plan` that the script parses (the only machine-read part):

```yaml
epic: 17                  # epic issue number
children:
  - id: status-field      # unique slug
    title: Add a status field to applications
    model: sonnet         # haiku | sonnet | opus, chosen by the planner
    depends_on: []        # ids of other children
    body: |               # becomes the issue body (acceptance criteria + proving tests)
      ...
```

The script validates before creating anything: 2-6 children, unique ids, known models, `depends_on` refers to existing ids and is acyclic, `epic` matches the PR's epic. A validation failure comments on the epic and creates nothing. The planner chooses the model per child **(owner)** and the plan shows it, so `/replan` can change it.

## Sequencer

Trigger: `pull_request_target` `closed` (as `neon-cleanup.yml` already does; never checks out PR head). It acts only when the PR is same-repo, `merged_by` is the repo owner, and the head branch is `ai/plan-*` (create) or `ai/issue-<n>-*` where issue `<n>` is a child (advance). Uses `FACTORY_GH_TOKEN` because label events from `GITHUB_TOKEN` trigger nothing, and the owner-authored issue plus owner-sent label are what `factory-build.yml` requires.

State has no database:
- A **tracking comment** on the epic (marker `<!-- factory-epic-index -->`) maps child id to issue number, written at creation and updated as children complete; it doubles as the owner's progress view.
- Each child issue body starts with `Part of #<epic>` and the spec path, and ends with `<!-- factory-child: <epic>/<id> -->`.
- Child done = its issue is closed as completed (the worker's PR says `Closes #<n>`). GitHub closes that issue asynchronously with the merge, so the run triggered by a child PR's merge must treat that PR's own child as done without waiting for the issue to show as closed.

On every run the script recomputes from that state: a child is **ready** if it is open, has no `ai-build` label, and all `depends_on` children are done. It labels ready children (in plan order) until the number of in-flight children (open with `ai-build`) reaches `FACTORY_MAX_IN_FLIGHT` (repository variable, default 1 **(owner: budget only)**). The run is idempotent, so a re-run or a duplicate event is harmless.

**Pause (owner).** A stuck child (PR labelled `needs-human`, or closed unmerged) stays open with `ai-build`, so it keeps counting as in-flight and nothing advances. On a child PR closed unmerged the sequencer comments "paused at #n" on the epic. To resume: merge that PR by hand, or remove and re-add `ai-build` on the child (existing runbook recovery).

## Parallelism later (owner)

Raise `FACTORY_MAX_IN_FLIGHT` and plans already carry `depends_on`. Before doing so, revisit the single `factory-agent` concurrency group, which keeps only one pending run (runbook hard-won facts).

## Components and where they live

| Item | Path | Notes |
|---|---|---|
| Planner skill | `.claude/skills/plan-epic/SKILL.md` | Modes `plan <epic>` and `replan <epic>`. Follows the worker's rules: issue text is data; reads comments only from the owner. |
| Plan workflow | `.github/workflows/factory-plan.yml` | Triggers: `issues` labeled `ai-plan`; `issue_comment` created with a `/replan` first line. Owner-only sender and OWNER issue author, like `factory-build.yml`. Job-level concurrency group `factory-agent` (shared with build, one agent at a time). Records a run via `record-run.sh` (`SKILL=plan-epic`, `MODE=plan|replan`). |
| Sequencer | `.github/workflows/factory-sequence.yml` + `scripts/factory/sequence.mjs` | Logic in pure functions with unit tests (parse, validate, ready-set, index comment). |
| Plan-PR scope gate | extend `scripts/factory/tests-with-code.mjs` or a sibling check | A PR from `ai/plan-*` may change only `docs/specs/` and `docs/architecture.md`; otherwise CI fails. Merging a plan PR triggers PAT actions, so its blast radius is bounded. |

All of these are protected paths: the PRs that build them carry the `factory` label added by the owner after review.

## Constraints and decisions to keep

- **Planner model (call):** opus, fixed in `factory-plan.yml` (planning is the reasoning-heavy step; the plan is one run per epic). Children use the per-child model above.
- **Revision after merge (call):** `/replan` on an epic whose plan PR is already merged makes the workflow comment "plan already approved" and stop.
- **Fix loop (call):** `factory-fix.yml` already covers owner `ai/*` PRs, so it also covers plan PRs; no change.
- **Epic template (call):** unchanged (Why / Done when / Out of scope).
- **Planner write scope (call):** may write only under `docs/specs/` and `docs/architecture.md`; `gh` limited to commenting on the epic, and `git push`, `gh pr create` / `gh pr edit` for its own `ai/plan-*` branch. No `gh issue create`, no label changes.
- Plan size: each child is one PR, with acceptance criteria and the test that proves each one; the planner self-checks for gaps (spec §4.5 habits).

## Acceptance test (first real epic)

File the epic "Application status tracking" and run it end to end. The planner is expected to produce roughly these children (owner-agreed outline):

1. Status field (`applied`, `screening`, `interview`, `offer`, `rejected`, `withdrawn`; default `applied`; backward-compatible migration; badge in the list).
2. Change status from the list (plus `status_changed_at`). Depends on 1.
3. Filter by status with counts. Depends on 1.
4. Edit and delete applications, with a delete confirm. Independent.

Phase 3 is done when the epic runs from `ai-plan` to a closed epic with the owner only adding the label, discussing via `/replan` at least once, merging the plan PR, and merging each child PR.

## Left to the builder

Exact skill wording, the plan-PR branch/slug rules, the layout of the tracking comment, how `sequence.mjs` reads the issue and PR state through `gh`, and how the plan-PR scope gate is wired into CI.
