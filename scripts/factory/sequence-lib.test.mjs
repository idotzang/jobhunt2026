import { describe, expect, it } from "vitest";
import { childIssueFromRef, parsePlan, planBranchEpic, validatePlan } from "./sequence-lib.mjs";

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
  it("extracts the child issue from issue branches", () => {
    expect(childIssueFromRef("ai/issue-31-add-field")).toBe(31);
    expect(childIssueFromRef("ai/plan-17-x")).toBeNull();
  });
});
