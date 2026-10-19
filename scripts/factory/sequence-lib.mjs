const VALID_MODELS = ["haiku", "sonnet", "opus"];
const PLAN_BLOCK = /^```factory-plan[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;

function childSection(markdown, id) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## Child: ${id}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

export function parsePlan(markdown) {
  const blocks = [...String(markdown).matchAll(PLAN_BLOCK)];
  if (blocks.length !== 1) {
    throw new Error(`expected exactly one factory-plan block, found ${blocks.length}`);
  }
  let raw;
  try {
    raw = JSON.parse(blocks[0][1]);
  } catch (err) {
    throw new Error(`factory-plan block is not valid JSON: ${err.message}`);
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.children)) {
    throw new Error("factory-plan block must be an object with a children array");
  }
  const children = raw.children.map((c) => {
    const body = childSection(markdown, c?.id);
    if (body === null) throw new Error(`missing section "## Child: ${c?.id}"`);
    return {
      id: c.id,
      title: c.title,
      model: c.model,
      depends_on: Array.isArray(c.depends_on) ? c.depends_on : [],
      body,
    };
  });
  return { epic: raw.epic, children };
}

export function validatePlan(plan, opts) {
  const errors = [];
  if (plan.epic !== opts.epic) {
    errors.push(`epic mismatch: plan says ${plan.epic}, expected ${opts.epic}`);
  }
  const children = Array.isArray(plan.children) ? plan.children : [];
  if (children.length < 2 || children.length > 6) {
    errors.push(`child count must be 2-6, got ${children.length}`);
  }
  const ids = new Set();
  for (const c of children) {
    if (ids.has(c.id)) errors.push(`duplicate child id: ${c.id}`);
    ids.add(c.id);
    if (!VALID_MODELS.includes(c.model)) {
      errors.push(`child ${c.id}: invalid model "${c.model}" (use haiku, sonnet or opus)`);
    }
  }
  let depsOk = true;
  for (const c of children) {
    for (const d of c.depends_on ?? []) {
      if (!ids.has(d)) {
        errors.push(`child ${c.id}: unknown dependency "${d}"`);
        depsOk = false;
      }
    }
  }
  if (depsOk && hasCycle(children)) errors.push("dependency cycle detected");
  return errors;
}

// Kahn's algorithm: a cycle exists if not every node can be removed.
function hasCycle(children) {
  const indegree = new Map(children.map((c) => [c.id, 0]));
  const dependents = new Map(children.map((c) => [c.id, []]));
  for (const c of children) {
    for (const d of c.depends_on ?? []) {
      indegree.set(c.id, indegree.get(c.id) + 1);
      dependents.get(d).push(c.id);
    }
  }
  const queue = [...indegree].filter(([, n]) => n === 0).map(([id]) => id);
  let removed = 0;
  while (queue.length) {
    const id = queue.pop();
    removed++;
    for (const next of dependents.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return removed !== indegree.size;
}

function refNumber(ref, kind) {
  const m = new RegExp(`^ai/${kind}-(\\d+)(?:-|$)`).exec(String(ref ?? ""));
  return m ? Number(m[1]) : null;
}

export function planBranchEpic(ref) {
  return refNumber(ref, "plan");
}

export function childIssueFromRef(ref) {
  return refNumber(ref, "issue");
}

const INDEX_MARKER = "<!-- factory-epic-index -->";

export function renderChildBody(child, ctx) {
  return [
    `Part of #${ctx.epic}`,
    "",
    `Spec: ${ctx.specPath}`,
    "",
    child.body,
    "",
    `<!-- factory-child: ${ctx.epic}/${child.id} -->`,
  ].join("\n");
}

export function renderIndex(epic, entries, doneIds) {
  const done = new Set(doneIds);
  const lines = entries.map(
    (e) => `- [${done.has(e.id) ? "x" : " "}] #${e.number ?? "?"} ${String(e.title).replace(/\s+/g, " ").trim()} <!-- id:${e.id} -->`,
  );
  return [INDEX_MARKER, `Plan for #${epic}`, "", ...lines].join("\n");
}

export function parseIndex(commentBody) {
  const map = new Map();
  const lines = String(commentBody ?? "").split(/\r?\n/);
  if (lines[0]?.trim() !== INDEX_MARKER) return map;
  for (const line of lines) {
    const m = /^- \[[ xX]\] #(\d+) .*<!-- id:(.+?) -->\s*$/.exec(line);
    if (m) map.set(m[2], Number(m[1]));
  }
  return map;
}

function isCompleted(issue) {
  return (
    issue?.state === "closed" && String(issue.stateReason ?? "").toLowerCase() === "completed"
  );
}

export function doneIds(children, index, issues, justMerged) {
  return children
    .filter((c) => {
      const n = index.get(c.id);
      return n !== undefined && (n === justMerged || isCompleted(issues.get(n)));
    })
    .map((c) => c.id);
}

function isInFlight(issue) {
  return issue?.state === "open" && issue.labels.includes("ai-build");
}

export function haltedIds(children, index, issues, justMerged) {
  const done = new Set(doneIds(children, index, issues, justMerged));
  return children
    .filter((c) => !done.has(c.id) && issues.get(index.get(c.id))?.state === "closed")
    .map((c) => c.id);
}

export function readyIds({ children, index, issues, maxInFlight, justMerged }) {
  const done = new Set(doneIds(children, index, issues, justMerged));
  const stateOf = (c) => issues.get(index.get(c.id));
  const inFlight = children.filter((c) => !done.has(c.id) && isInFlight(stateOf(c))).length;
  const slots = Math.max(0, maxInFlight - inFlight);
  return children
    .filter(
      (c) =>
        !done.has(c.id) &&
        !isInFlight(stateOf(c)) &&
        stateOf(c)?.state !== "closed" &&
        (c.depends_on ?? []).every((d) => done.has(d)),
    )
    .slice(0, slots)
    .map((c) => c.id);
}
