import { describe, expect, it } from "vitest";
import { checkProtectedPaths, checkTestsWithCode, isSourceFile, isTestFile } from "./tests-with-code.mjs";

describe("file classification", () => {
  it("recognises test files", () => {
    expect(isTestFile("src/lib/auth.test.ts")).toBe(true);
    expect(isTestFile("e2e/applications.spec.ts")).toBe(true);
    expect(isTestFile("scripts/factory/x.test.mjs")).toBe(true);
    expect(isTestFile("src/lib/auth.ts")).toBe(false);
  });

  it("treats non-test files under src/ as source", () => {
    expect(isSourceFile("src/lib/auth.ts")).toBe(true);
    expect(isSourceFile("src/lib/auth.test.ts")).toBe(false);
    expect(isSourceFile("docs/specs/x.md")).toBe(false);
  });
});

describe("checkTestsWithCode", () => {
  it("passes when source changes come with test changes", () => {
    expect(checkTestsWithCode(["src/a.ts", "src/a.test.ts"]).ok).toBe(true);
  });

  it("passes when no source changed", () => {
    expect(checkTestsWithCode(["README.md", ".github/workflows/ci.yml"]).ok).toBe(true);
  });

  it("fails when source changed without tests, naming the files", () => {
    const result = checkTestsWithCode(["src/a.ts", "src/b.tsx"]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("src/a.ts");
    expect(result.message).toContain("skip-tests-check");
  });
});

describe("checkProtectedPaths", () => {
  const touching = [".github/workflows/ci.yml", ".claude/skills/x/SKILL.md", "src/a.ts"];

  it("blocks agent branches from touching workflows or skills", () => {
    const result = checkProtectedPaths(touching, { branch: "ai/issue-3-x", hasFactoryLabel: false });
    expect(result.ok).toBe(false);
    expect(result.message).toContain(".github/workflows/ci.yml");
    expect(result.message).toContain(".claude/skills/x/SKILL.md");
  });

  it("allows agent branches with the factory label", () => {
    expect(checkProtectedPaths(touching, { branch: "ai/issue-3-x", hasFactoryLabel: true }).ok).toBe(true);
  });

  it("does not restrict non-agent branches", () => {
    expect(checkProtectedPaths(touching, { branch: "factory/worker", hasFactoryLabel: false }).ok).toBe(true);
  });

  it("allows agent branches that touch neither", () => {
    expect(checkProtectedPaths(["src/a.ts"], { branch: "ai/issue-3-x", hasFactoryLabel: false }).ok).toBe(true);
  });
});
