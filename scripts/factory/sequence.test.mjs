import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleEvent } from "./sequence.mjs";

const REPO = "o/r";
const env = { repo: REPO, owner: "o", maxInFlight: 1 };
const SPEC = "docs/specs/status.md";

function spec(blockChildren, sections = ["a", "b"]) {
  return [
    "# Spec",
    "```factory-plan",
    JSON.stringify({ epic: 7, children: blockChildren }),
    "```",
    ...sections.flatMap((id) => [`## Child: ${id}`, `Body of ${id}`]),
  ].join("\n");
}
const good = spec([
  { id: "a", title: "First", model: "sonnet", depends_on: [] },
  { id: "b", title: "Second", model: "haiku", depends_on: ["a"] },
]);
const cyclic = spec([
  { id: "a", title: "First", model: "sonnet", depends_on: ["b"] },
  { id: "b", title: "Second", model: "haiku", depends_on: ["a"] },
]);

// In-memory GitHub. world.issues: number -> {state, stateReason, labels[], body}
function makeFakeGh(world) {
  const calls = [];
  let nextNumber = 100;
  const bodyOf = (args) => world.files[args[args.indexOf("--body-file") + 1]] ?? "";
  const gh = (args) => {
    calls.push(args);
    const [a, b] = args;
    if (a === "api" && args[1] === `repos/${REPO}/pulls/${world.pr}/files`) {
      return JSON.stringify(world.prFiles.map((filename) => ({ filename })));
    }
    if (a === "api" && /\/issues\/\d+\/comments$/.test(args[1])) {
      return JSON.stringify(world.comments);
    }
    if (a === "api" && args.includes("PATCH")) {
      const id = Number(args.find((x) => /comments\/\d+$/.test(x)).split("/").pop());
      world.comments.find((c) => c.id === id).body = world.files[args[args.indexOf("-F") + 1].replace(/^body=@/, "")];
      return "{}";
    }
    if (a === "issue" && b === "create") {
      const number = nextNumber++;
      world.issues[number] = {
        state: "OPEN",
        stateReason: null,
        labels: [{ name: args[args.indexOf("--label") + 1] }],
        body: bodyOf(args),
      };
      return `https://github.com/${REPO}/issues/${number}\n`;
    }
    if (a === "issue" && b === "view") {
      const i = world.issues[Number(args[2])];
      return JSON.stringify({ body: i.body, state: i.state, stateReason: i.stateReason, labels: i.labels });
    }
    if (a === "issue" && b === "edit") {
      world.issues[Number(args[2])].labels.push({ name: args[args.indexOf("--add-label") + 1] });
      return "";
    }
    if (a === "issue" && b === "comment") {
      world.comments.push({ id: world.comments.length + 1, body: bodyOf(args), issue: Number(args[2]) });
      return "";
    }
    if (a === "issue" && b === "close") {
      world.closed.push(Number(args[2]));
      return "";
    }
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  gh.calls = calls;
  return gh;
}

// Captures body-file contents at call time (the runner deletes its temp file afterwards).
function setup(overrides = {}, specText = good) {
  const world = { pr: 50, prFiles: [SPEC], comments: [], issues: {}, closed: [], files: {}, ...overrides };
  const fake = makeFakeGh(world);
  const gh = (args) => {
    const paths = [];
    const i = args.indexOf("--body-file");
    if (i !== -1) paths.push(args[i + 1]);
    const j = args.indexOf("-F");
    if (j !== -1) paths.push(args[j + 1].replace(/^body=@/, ""));
    for (const p of paths) world.files[p] = readFileSync(p, "utf8");
    return fake(args);
  };
  gh.calls = fake.calls;
  const readFile = (p) => {
    if (p !== SPEC) throw new Error(`no file ${p}`);
    return specText;
  };
  return { world, gh, readFile };
}

const planEvent = (over = {}) => ({
  pull_request: {
    number: 50,
    merged: true,
    merged_by: { login: "o" },
    head: { ref: "ai/plan-7-status", repo: { full_name: REPO } },
    ...over,
  },
});
const childEvent = (n, over = {}) => ({
  pull_request: {
    number: 60,
    merged: true,
    merged_by: { login: "o" },
    head: { ref: `ai/issue-${n}-x`, repo: { full_name: REPO } },
    ...over,
  },
});
const writes = (gh) =>
  gh.calls.filter((c) => (c[0] === "issue" && c[1] !== "view") || c.includes("PATCH"));
const creates = (gh) => gh.calls.filter((c) => c[0] === "issue" && c[1] === "create");
const indexComment = (world) => world.comments.find((c) => c.body.startsWith("<!-- factory-epic-index -->"));
const labelsOf = (world, n) => world.issues[n].labels.map((l) => l.name);

describe("plan merge", () => {
  it("creates children with model labels before any ai-build, labels only the first, one index", () => {
    const { world, gh, readFile } = setup();
    expect(handleEvent(planEvent(), { gh, readFile, env })).toEqual({ action: "created" });
    expect(creates(gh)).toHaveLength(2);
    for (const c of creates(gh)) expect(c).toContain("--body-file");
    expect(creates(gh)[0]).toContain("model:sonnet");
    expect(creates(gh)[1]).toContain("model:haiku");
    const firstAiBuild = gh.calls.findIndex((c) => c.includes("ai-build"));
    const lastCreate = gh.calls.map((c) => c[1]).lastIndexOf("create");
    expect(firstAiBuild).toBeGreaterThan(lastCreate);
    expect(gh.calls.filter((c) => c.includes("ai-build"))).toHaveLength(1);
    expect(labelsOf(world, 100)).toEqual(["model:sonnet", "ai-build"]);
    expect(labelsOf(world, 101)).toEqual(["model:haiku"]);
    expect(world.comments.filter((c) => c.body.startsWith("<!-- factory-epic-index -->"))).toHaveLength(1);
    expect(world.issues[100].body).toContain("<!-- factory-child: 7/a -->");
  });

  it("is idempotent: a repeated event creates nothing", () => {
    const { world, gh, readFile } = setup();
    handleEvent(planEvent(), { gh, readFile, env });
    const before = creates(gh).length;
    expect(handleEvent(planEvent(), { gh, readFile, env })).toEqual({ action: "ignored" });
    expect(creates(gh)).toHaveLength(before);
    expect(world.comments.filter((c) => c.body.startsWith("<!-- factory-epic-index -->"))).toHaveLength(1);
  });

  it("rejects a spec with no plan block", () => {
    const { world, gh, readFile } = setup({}, "# no block");
    expect(handleEvent(planEvent(), { gh, readFile, env })).toEqual({ action: "invalid-plan" });
    expect(creates(gh)).toHaveLength(0);
    expect(world.comments.some((c) => c.issue === 7)).toBe(true);
  });

  it("rejects a cyclic plan", () => {
    const { world, gh, readFile } = setup({}, cyclic);
    expect(handleEvent(planEvent(), { gh, readFile, env })).toEqual({ action: "invalid-plan" });
    expect(creates(gh)).toHaveLength(0);
    expect(world.comments.find((c) => c.issue === 7).body).toContain("cycle");
  });

  it("rejects a PR that changes no single docs/specs file", () => {
    const { gh, readFile } = setup({ prFiles: ["docs/specs/a.md", "docs/specs/b.md"] });
    expect(handleEvent(planEvent(), { gh, readFile, env })).toEqual({ action: "invalid-plan" });
    expect(creates(gh)).toHaveLength(0);
  });
});

describe("safety", () => {
  it("ignores a non-owner merge with no writes", () => {
    const { gh, readFile } = setup();
    const ev = planEvent({ merged_by: { login: "evil" } });
    expect(handleEvent(ev, { gh, readFile, env })).toEqual({ action: "ignored" });
    expect(writes(gh)).toHaveLength(0);
  });

  it("ignores a fork PR with no writes", () => {
    const { gh, readFile } = setup();
    const ev = planEvent({ head: { ref: "ai/plan-7-x", repo: { full_name: "evil/r" } } });
    expect(handleEvent(ev, { gh, readFile, env })).toEqual({ action: "ignored" });
    expect(gh.calls).toHaveLength(0);
  });
});

describe("child PRs", () => {
  function planned() {
    const s = setup();
    handleEvent(planEvent(), { gh: s.gh, readFile: s.readFile, env });
    return s;
  }

  it("advances to the dependent child while the merged child's issue is still open", () => {
    const { world, gh, readFile } = planned();
    expect(world.issues[100].state).toBe("OPEN");
    expect(handleEvent(childEvent(100), { gh, readFile, env })).toEqual({ action: "advanced" });
    expect(labelsOf(world, 101)).toContain("ai-build");
    expect(indexComment(world).body).toContain("- [x] #100");
    expect(indexComment(world).body).toContain("- [ ] #101");
  });

  it("completes and closes the epic after the last child", () => {
    const { world, gh, readFile } = planned();
    handleEvent(childEvent(100), { gh, readFile, env });
    world.issues[100].state = "CLOSED";
    world.issues[100].stateReason = "COMPLETED";
    expect(handleEvent(childEvent(101), { gh, readFile, env })).toEqual({ action: "completed" });
    expect(world.closed).toEqual([7]);
  });

  it("pauses without labeling when a child PR is closed unmerged", () => {
    const { world, gh, readFile } = planned();
    const before = gh.calls.filter((c) => c.includes("--add-label")).length;
    const ev = childEvent(100, { merged: false, merged_by: null });
    expect(handleEvent(ev, { gh, readFile, env })).toEqual({ action: "paused" });
    expect(world.comments.some((c) => c.issue === 7 && c.body.includes("paused at #100"))).toBe(true);
    expect(gh.calls.filter((c) => c.includes("--add-label"))).toHaveLength(before);
  });

  it("pauses when another child was closed without completing", () => {
    const { world, gh, readFile } = planned();
    world.issues[100].state = "CLOSED";
    world.issues[100].stateReason = "NOT_PLANNED";
    world.issues[101].labels = world.issues[101].labels.filter((l) => l.name !== "ai-build");
    world.issues[101].body = world.issues[100].body.replace("/a", "/b");
    // a merge of child 101's PR while 100 was abandoned: 101 done, 100 halted
    expect(handleEvent(childEvent(101), { gh, readFile, env })).toEqual({ action: "paused" });
    expect(world.comments.some((c) => c.issue === 7 && c.body.includes("paused at #100"))).toBe(true);
  });

  it("ignores an ordinary ticket PR", () => {
    const { world, gh, readFile } = setup({ issues: { 5: { state: "OPEN", labels: [], body: "plain ticket" } } });
    expect(handleEvent(childEvent(5), { gh, readFile, env })).toEqual({ action: "ignored" });
    expect(writes(gh)).toHaveLength(0);
    expect(world.closed).toEqual([]);
  });

  it("ignores other branch names", () => {
    const { gh, readFile } = setup();
    const ev = planEvent({ head: { ref: "feature/x", repo: { full_name: REPO } } });
    expect(handleEvent(ev, { gh, readFile, env })).toEqual({ action: "ignored" });
  });
});
