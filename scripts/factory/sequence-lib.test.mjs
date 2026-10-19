import { describe, expect, it } from "vitest";
import {
  childIssueFromRef,
  doneIds,
  parseIndex,
  parsePlan,
  planBranchEpic,
  haltedIds,
  readyIds,
  renderChildBody,
  renderIndex,
  validatePlan,
} from "./sequence-lib.mjs";

const FENCE = "```";

function child(id, extra = {}) {
  return { id, title: `Title ${id}`, model: "sonnet", depends_on: [], ...extra };
}

function specFixture(children, { epic = 17, sections = true } = {}) {
  const plan = { epic, children };
  const parts = [
    "# Some spec",
    "",
    "Intro prose.",
    "",
    `${FENCE}factory-plan`,
    JSON.stringify(plan, null, 2),
    FENCE,
    "",
  ];
  if (sections) {
    for (const c of children) {
      parts.push(`## Child: ${c.id}`, "", `  Body for ${c.id}.  `, "", `More ${c.id}.`, "");
      parts.push("## Unrelated heading", "", "ignored", "");
    }
  }
  return parts.join("\n");
}

describe("parsePlan", () => {
  it("parses children with trimmed bodies stopping at the next heading", () => {
    const plan = parsePlan(specFixture([child("first"), child("second", { depends_on: ["first"] })]));
    expect(plan.epic).toBe(17);
    expect(plan.children).toHaveLength(2);
    expect(plan.children[0].body).toBe("Body for first.  \n\nMore first.");
    expect(plan.children[1].depends_on).toEqual(["first"]);
    expect(plan.children[1].model).toBe("sonnet");
  });
  it("throws when there is no factory-plan block", () => {
    expect(() => parsePlan("# nothing here")).toThrow(/factory-plan/);
  });
  it("throws when there are two factory-plan blocks", () => {
    const one = specFixture([child("a"), child("b")]);
    expect(() => parsePlan(`${one}\n${one}`)).toThrow(/factory-plan/);
  });
  it("throws on invalid JSON", () => {
    const md = `${FENCE}factory-plan\n{not json\n${FENCE}\n`;
    expect(() => parsePlan(md)).toThrow(/factory-plan/);
  });
  it("throws when a child section appears twice", () => {
    const md = specFixture([child("first"), child("second")]) + "\n## Child: first\n\nagain\n";
    expect(() => parsePlan(md)).toThrow(/duplicate/);
  });
  it("keeps a non-array depends_on raw", () => {
    const md = specFixture([child("first", { depends_on: "second" }), child("second")]);
    expect(parsePlan(md).children[0].depends_on).toBe("second");
  });
  it("throws when a child has no section", () => {
    const md = specFixture([child("first"), child("second")]).replace("## Child: second", "## Other: second");
    expect(() => parsePlan(md)).toThrow(/Child: second/);
  });
});

describe("validatePlan", () => {
  const ok = () => ({
    epic: 17,
    children: [
      { ...child("a"), body: "x" },
      { ...child("b", { depends_on: ["a"] }), body: "x" },
      { ...child("c", { depends_on: ["a"] }), body: "x" },
      { ...child("d", { depends_on: ["b", "c"] }), body: "x" },
    ],
  });
  const errs = (plan) => validatePlan(plan, { epic: 17 }).join("\n");

  it("accepts a valid plan", () => {
    expect(validatePlan(ok(), { epic: 17 })).toEqual([]);
  });
  it("rejects child counts outside 2-6", () => {
    const p = ok();
    expect(errs({ ...p, children: p.children.slice(0, 1) })).toContain("2-6");
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...child(`c${i}`), body: "x" }));
    expect(errs({ ...p, children: seven })).toContain("2-6");
  });
  it("rejects duplicate ids", () => {
    const p = ok();
    p.children[1].id = "a";
    expect(errs(p)).toContain("duplicate");
  });
  it("rejects invalid models", () => {
    const p = ok();
    p.children[0].model = "gpt";
    expect(errs(p)).toContain("model");
  });
  it("rejects unknown dependencies", () => {
    const p = ok();
    p.children[0].depends_on = ["zzz"];
    expect(errs(p)).toContain("unknown dependency");
  });
  it("rejects cycles", () => {
    const p = ok();
    p.children[0].depends_on = ["b"];
    expect(errs(p)).toContain("cycle");
  });
  it("rejects self dependency", () => {
    const p = ok();
    p.children[0].depends_on = ["a"];
    expect(errs(p)).toContain("cycle");
  });
  it("rejects non-array or non-string depends_on", () => {
    const p = ok();
    p.children[1].depends_on = "a";
    expect(errs(p)).toContain("depends_on");
    const q = ok();
    q.children[1].depends_on = [1];
    expect(errs(q)).toContain("depends_on");
  });
  it("rejects malformed children", () => {
    const bad = (mut) => {
      const p = ok();
      mut(p);
      return errs(p);
    };
    expect(bad((p) => (p.children[0].id = 5))).toContain("id");
    expect(bad((p) => (p.children[0].id = "Abc"))).toContain("id");
    expect(bad((p) => (p.children[0].title = ""))).toContain("title");
    expect(bad((p) => (p.children[0].title = "x".repeat(300)))).toContain("title");
    expect(bad((p) => (p.children[0] = null))).toContain("object");
    expect(bad((p) => (p.children[0].body = "x".repeat(60001)))).toContain("body");
  });
  it("rejects an epic mismatch", () => {
    expect(validatePlan(ok(), { epic: 99 }).join("\n")).toContain("epic");
  });
});

describe("refs", () => {
  it("extracts the epic from plan branches", () => {
    expect(planBranchEpic("ai/plan-17-status")).toBe(17);
    expect(planBranchEpic("ai/issue-3-x")).toBeNull();
    expect(planBranchEpic("feature/plan-1")).toBeNull();
  });
  it("handles near-miss plan refs", () => {
    expect(planBranchEpic("ai/plan-17")).toBe(17);
    expect(planBranchEpic("ai/plan-x-foo")).toBeNull();
    expect(planBranchEpic("xai/plan-1-a")).toBeNull();
    expect(planBranchEpic("")).toBeNull();
  });
  it("extracts the child issue from issue branches", () => {
    expect(childIssueFromRef("ai/issue-31-add-field")).toBe(31);
    expect(childIssueFromRef("ai/plan-17-x")).toBeNull();
  });
});

describe("rendering", () => {
  it("renders a child body with header, spec and footer", () => {
    const out = renderChildBody(
      { id: "status-field", title: "T", model: "sonnet", depends_on: [], body: "Do the thing." },
      { epic: 17, specPath: "docs/specs/status.md" },
    );
    expect(out).toMatch(/^Part of #17\n/);
    expect(out).toContain("Spec: docs/specs/status.md");
    expect(out).toContain("Do the thing.");
    expect(out.endsWith("<!-- factory-child: 17/status-field -->")).toBe(true);
  });
  it("round-trips the index", () => {
    const out = renderIndex(
      17,
      [
        { id: "a", number: 31, title: "First" },
        { id: "b", number: 32, title: "Second" },
      ],
      ["a"],
    );
    expect(out.split("\n")[0]).toBe("<!-- factory-epic-index -->");
    expect(out).toContain("- [x] #31 First");
    expect(out).toContain("- [ ] #32 Second");
    expect(parseIndex(out)).toEqual(new Map([["a", 31], ["b", 32]]));
  });
  it("renders a placeholder for an entry without a number; parseIndex skips it", () => {
    const out = renderIndex(7, [{ id: "a", title: "A", number: 5 }, { id: "b", title: "B" }], []);
    expect(out).toContain("- [ ] #? B <!-- id:b -->");
    expect(parseIndex(out)).toEqual(new Map([["a", 5]]));
  });
  it("parses a comment without the marker as empty", () => {
    expect(parseIndex("hello").size).toBe(0);
  });
});

describe("ready set", () => {
  const chain = [{ id: "a", depends_on: [] }, { id: "b", depends_on: ["a"] }];
  const index = new Map([["a", 1], ["b", 2], ["c", 3]]);
  const open = (labels = []) => ({ state: "open", labels });
  const done = { state: "closed", labels: [], stateReason: "completed" };
  const run = (children, issues, maxInFlight, justMerged) =>
    readyIds({ children, index, issues: new Map(issues), maxInFlight, justMerged });

  it("walks a chain", () => {
    expect(run(chain, [[1, open()], [2, open()]], 1)).toEqual(["a"]);
    expect(run(chain, [[1, open(["ai-build"])], [2, open()]], 1)).toEqual([]);
    expect(run(chain, [[1, done], [2, open()]], 1)).toEqual(["b"]);
  });
  it("respects free slots in plan order", () => {
    const kids = [{ id: "a", depends_on: [] }, { id: "c", depends_on: [] }];
    const issues = [[1, open(["ai-build"])], [3, open()]];
    expect(run(kids, issues, 2)).toEqual(["c"]);
    expect(run(kids, issues, 1)).toEqual([]);
  });
  it("treats justMerged as done", () => {
    expect(run(chain, [[1, open()], [2, open()]], 1, 1)).toEqual(["b"]);
    expect(doneIds(chain, index, new Map([[1, open()]]), 1)).toEqual(["a"]);
  });
  it("frees the slot of a done child still labelled ai-build", () => {
    expect(run(chain, [[1, open(["ai-build"])], [2, open()]], 1, 1)).toEqual(["b"]);
  });
  it("counts a stuck child as in flight", () => {
    expect(run(chain, [[1, open(["ai-build", "needs-human"])], [2, open()]], 1)).toEqual([]);
  });
  it("does not treat not-planned closes as done", () => {
    const np = { state: "closed", labels: [], stateReason: "not_planned" };
    const issues = [[1, np], [2, open()]];
    expect(run(chain, issues, 2)).toEqual([]);
    expect(haltedIds(chain, index, new Map(issues))).toEqual(["a"]);
  });
});
