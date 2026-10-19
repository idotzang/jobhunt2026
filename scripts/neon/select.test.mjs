import { describe, expect, it } from "vitest";
import { previewBranchName, selectForPr, selectOrphans } from "./select.mjs";

const b = (name, extra = {}) => ({
  id: `br-${name}`,
  name,
  default: false,
  protected: false,
  ...extra,
});

describe("previewBranchName", () => {
  it("prefixes the head ref", () => {
    expect(previewBranchName("ai/issue-5-x")).toBe("preview/ai/issue-5-x");
  });
  it.each([
    "a/../b",
    "a\nb",
    "/lead",
    "trail/",
    "",
    "a".repeat(300),
    "a;rm -rf",
    "a b",
    "$(x)",
    "a`b`",
    "a|b",
    "a&b",
    "a'b",
    '"a"',
    "..",
  ])("throws for %j", (ref) => {
    expect(() => previewBranchName(ref)).toThrow();
  });
  it("throws for non-strings", () => {
    expect(() => previewBranchName(undefined)).toThrow();
    expect(() => previewBranchName(null)).toThrow();
    expect(() => previewBranchName(5)).toThrow();
  });
  it("accepts 200 chars", () => {
    expect(() => previewBranchName("a".repeat(200))).not.toThrow();
  });
});

describe("selectForPr", () => {
  it("selects the exact preview branch", () => {
    const branches = [b("main", { default: true }), b("dev"), b("preview/ai/issue-5")];
    expect(selectForPr(branches, "ai/issue-5").map((x) => x.name)).toEqual(["preview/ai/issue-5"]);
  });
  it("does not prefix/substring match", () => {
    const branches = [b("preview/ai/issue-50"), b("preview/ai/issue-5-x"), b("xpreview/ai/issue-5")];
    expect(selectForPr(branches, "ai/issue-5")).toEqual([]);
  });
  it("never selects default or protected branches", () => {
    expect(selectForPr([b("preview/x", { default: true })], "x")).toEqual([]);
    expect(selectForPr([b("preview/x", { protected: true })], "x")).toEqual([]);
  });
  it("never selects main or dev", () => {
    const branches = [b("main"), b("dev")];
    expect(selectForPr(branches, "main")).toEqual([]);
    expect(selectForPr(branches, "dev")).toEqual([]);
  });
  it("returns at most one", () => {
    const branches = [b("preview/x", { id: "1" }), b("preview/x", { id: "2" })];
    expect(selectForPr(branches, "x")).toHaveLength(1);
  });
  it("throws on invalid head ref and handles empty input", () => {
    expect(() => selectForPr([], "..")).toThrow();
    expect(selectForPr([], "x")).toEqual([]);
  });
});

describe("selectOrphans", () => {
  const branches = [
    b("main", { default: true }),
    b("dev"),
    b("preview/live-one"),
    b("preview/gone"),
    b("preview/ai/gone-too"),
    b("other/gone"),
    b("preview/prot", { protected: true }),
    b("preview/def", { default: true }),
  ];
  it("selects preview branches whose git ref is not live", () => {
    const got = selectOrphans(branches, new Set(["live-one"])).map((x) => x.name);
    expect(got).toEqual(["preview/gone", "preview/ai/gone-too"]);
  });
  it("accepts an array of live refs", () => {
    const got = selectOrphans(branches, ["live-one", "gone", "ai/gone-too"]);
    expect(got).toEqual([]);
  });
  it("never selects main/dev even if not live", () => {
    const got = selectOrphans([b("main"), b("dev")], []);
    expect(got).toEqual([]);
  });
  it("handles empty inputs", () => {
    expect(selectOrphans([], [])).toEqual([]);
  });
});
