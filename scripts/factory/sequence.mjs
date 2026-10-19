import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  childIssueFromRef,
  doneIds,
  haltedIds,
  parseIndex,
  parsePlan,
  planBranchEpic,
  readyIds,
  renderChildBody,
  renderIndex,
  validatePlan,
} from "./sequence-lib.mjs";

// import.meta.url is the real path (macOS /var -> /private/var), so resolve argv[1] the
// same way. Fails closed: if argv[1] cannot be resolved, this is not the entrypoint.
function isEntrypoint(argv1, metaUrl) {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

const INDEX_MARKER = "<!-- factory-epic-index -->";
const SPEC_PATH = /^docs\/specs\/[^/]+\.md$/;

export function handleEvent(event, { gh, readFile, env }) {
  const pr = event?.pull_request;
  const ignored = { action: "ignored" };
  if (!pr || pr.head?.repo?.full_name !== env.repo) return ignored;
  if (pr.merged && pr.merged_by?.login !== env.owner) return ignored;

  const R = ["--repo", env.repo];
  const json = (args) => JSON.parse(gh(args));
  const withFile = (text, fn) => {
    const dir = mkdtempSync(join(tmpdir(), "sequence-"));
    try {
      const file = join(dir, "body.md");
      writeFileSync(file, text);
      return fn(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const comment = (n, text) =>
    withFile(text, (f) => gh(["issue", "comment", String(n), ...R, "--body-file", f]));
  const findIndex = (epic) => {
    const pages = json(["api", `repos/${env.repo}/issues/${epic}/comments`, "--paginate", "--slurp"]);
    return pages.flat().find((c) => String(c.body ?? "").split(/\r?\n/)[0].trim() === INDEX_MARKER);
  };
  const addLabel = (n, label) => gh(["issue", "edit", String(n), ...R, "--add-label", label]);

  const planEpic = planBranchEpic(pr.head.ref);
  if (planEpic !== null && pr.merged) return onPlanMerge(planEpic);
  const childNumber = childIssueFromRef(pr.head.ref);
  if (childNumber !== null) return onChildClosed(childNumber);
  return ignored;

  function loadIssues(children, index) {
    const issues = new Map();
    for (const c of children) {
      const num = index.get(c.id);
      if (num === undefined) continue;
      const v = json(["issue", "view", String(num), ...R, "--json", "state,stateReason,labels"]);
      issues.set(num, {
        state: String(v.state).toLowerCase(),
        stateReason: v.stateReason,
        labels: (v.labels ?? []).map((l) => l.name ?? l),
      });
    }
    return issues;
  }

  function patchIndex(commentId, text) {
    withFile(text, (f) =>
      gh(["api", "-X", "PATCH", `repos/${env.repo}/issues/comments/${commentId}`, "-F", `body=@${f}`]),
    );
  }

  // Resumable: the index comment is posted first (children without numbers), then
  // updated after every creation. A re-run creates only the children still missing.
  function onPlanMerge(epic) {
    const invalid = (msg) => {
      comment(epic, `Plan not applied, nothing was created:\n\n${msg}`);
      return { action: "invalid-plan" };
    };
    let indexComment = findIndex(epic);
    const files = json(["api", `repos/${env.repo}/pulls/${pr.number}/files`, "--paginate", "--slurp"])
      .flat()
      .map((f) => f.filename)
      .filter((f) => SPEC_PATH.test(f));
    if (files.length !== 1) return invalid(`expected exactly one docs/specs/*.md in the plan PR, found ${files.length}`);
    const specPath = files[0];
    let plan;
    try {
      plan = parsePlan(readFile(specPath));
    } catch (err) {
      return invalid(`- ${err.message}`);
    }
    const errors = validatePlan(plan, { epic });
    if (errors.length) return invalid(errors.map((e) => `- ${e}`).join("\n"));

    const existing = indexComment ? parseIndex(indexComment.body) : new Map();
    const entries = plan.children.map((c) => ({ id: c.id, title: c.title, number: existing.get(c.id) }));
    if (!indexComment) {
      const out = comment(epic, renderIndex(epic, entries, []));
      const id = /issuecomment-(\d+)/.exec(out)?.[1];
      indexComment = id ? { id: Number(id) } : findIndex(epic);
    }
    for (const [i, child] of plan.children.entries()) {
      if (entries[i].number !== undefined) continue;
      const body = renderChildBody(child, { epic, specPath });
      const out = withFile(body, (f) =>
        gh(["issue", "create", ...R, "--title", child.title, "--body-file", f, "--label", `model:${child.model}`]),
      );
      entries[i].number = Number(/(\d+)\s*$/.exec(out)[1]);
      patchIndex(indexComment.id, renderIndex(epic, entries, []));
    }
    const index = new Map(entries.map((e) => [e.id, e.number]));
    const issues = loadIssues(plan.children, index);
    for (const id of readyIds({ children: plan.children, index, issues, maxInFlight: env.maxInFlight })) {
      addLabel(index.get(id), "ai-build");
    }
    patchIndex(indexComment.id, renderIndex(epic, entries, doneIds(plan.children, index, issues)));
    return { action: "created" };
  }

  function onChildClosed(n) {
    const issue = json(["issue", "view", String(n), ...R, "--json", "body"]);
    const m = /<!-- factory-child: (\d+)\/(.+?) -->/.exec(issue.body ?? "");
    const spec = /^Spec: (\S+)$/m.exec(issue.body ?? "");
    if (!m || !spec || !SPEC_PATH.test(spec[1])) return ignored;
    const epic = Number(m[1]);
    if (!pr.merged) {
      comment(epic, `Sequence paused at #${n}: its PR was closed without merging.`);
      return { action: "paused" };
    }
    const indexComment = findIndex(epic);
    if (!indexComment) return ignored;
    let plan;
    try {
      plan = parsePlan(readFile(spec[1]));
    } catch {
      return ignored;
    }
    const index = parseIndex(indexComment.body);
    const issues = loadIssues(plan.children, index);
    const done = doneIds(plan.children, index, issues, n);
    const entries = plan.children.map((c) => ({ id: c.id, title: c.title, number: index.get(c.id) }));
    const rendered = renderIndex(epic, entries, done);
    const saveIndex = () => patchIndex(indexComment.id, rendered);

    const halted = haltedIds(plan.children, index, issues, n);
    if (halted.length) {
      saveIndex();
      comment(epic, `Sequence paused at #${index.get(halted[0])}: closed without completing.`);
      return { action: "paused" };
    }
    if (done.length === plan.children.length) {
      saveIndex();
      comment(epic, `All ${done.length} children are merged. Closing the epic.`);
      gh(["issue", "close", String(epic), ...R]);
      return { action: "completed" };
    }
    saveIndex();
    for (const id of readyIds({ children: plan.children, index, issues, maxInFlight: env.maxInFlight, justMerged: n })) {
      addLabel(index.get(id), "ai-build");
    }
    return { action: "advanced" };
  }
}

if (isEntrypoint(process.argv[1], import.meta.url)) {
  const event = JSON.parse(readFileSync(process.env.EVENT_PATH, "utf8"));
  const env = {
    repo: process.env.REPO,
    owner: process.env.OWNER,
    maxInFlight: Number(process.env.MAX_IN_FLIGHT ?? "1") || 1,
  };
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });
  const { action } = handleEvent(event, { gh, readFile: (p) => readFileSync(p, "utf8"), env });
  console.log(action);
}
