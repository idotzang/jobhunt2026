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
