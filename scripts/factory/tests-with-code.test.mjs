import { describe, expect, it } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  checkProtectedPaths,
  checkPlanPrScope,
  checkTestsWithCode,
  isEntrypoint,
  isSourceFile,
  isTestFile,
  splitNul,
} from "./tests-with-code.mjs";

describe("isEntrypoint", () => {
  const self = fileURLToPath(new URL("./tests-with-code.mjs", import.meta.url));
  const metaUrl = pathToFileURL(self).href;

  it("matches the script's own path", () => {
    expect(isEntrypoint(self, metaUrl)).toBe(true);
  });

  it("matches despite redundant slashes (e.g. a TMPDIR with a trailing slash)", () => {
    expect(isEntrypoint(self.replace("/tests-with-code.mjs", "//tests-with-code.mjs"), metaUrl)).toBe(true);
  });

  it("does not match another script, a missing path, or no argv", () => {
    expect(isEntrypoint(new URL("./checks.mjs", import.meta.url).pathname, metaUrl)).toBe(false);
    expect(isEntrypoint("/nonexistent/x.mjs", metaUrl)).toBe(false);
    expect(isEntrypoint(undefined, metaUrl)).toBe(false);
  });
});

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

describe("splitNul", () => {
  it("splits NUL-terminated git output and drops empties", () => {
    expect(splitNul("a.ts\0src/b.ts\0\0")).toEqual(["a.ts", "src/b.ts"]);
    expect(splitNul("")).toEqual([]);
  });

  it("keeps spaces, quotes and unicode in paths intact", () => {
    expect(splitNul('src/my "file" é.ts\0src/a b.ts\0')).toEqual(['src/my "file" é.ts', "src/a b.ts"]);
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
  const touching = [
    ".github/workflows/ci.yml",
    ".claude/skills/x/SKILL.md",
    "scripts/factory/tests-with-code.mjs",
    "src/a.ts",
  ];

  it("blocks PRs without the factory label from touching protected dirs", () => {
    const result = checkProtectedPaths(touching, { hasFactoryLabel: false });
    expect(result.ok).toBe(false);
    expect(result.message).toContain(".github/workflows/ci.yml");
    expect(result.message).toContain(".claude/skills/x/SKILL.md");
    expect(result.message).toContain("scripts/factory/tests-with-code.mjs");
    expect(result.message).toContain("needs the factory label, added by the owner after review");
  });

  it("applies regardless of branch name (no ai/ exemption)", () => {
    expect(checkProtectedPaths([".github/workflows/ci.yml"], { hasFactoryLabel: false }).ok).toBe(false);
  });

  it("allows any PR with the factory label", () => {
    expect(checkProtectedPaths(touching, { hasFactoryLabel: true }).ok).toBe(true);
  });

  it("allows PRs that touch no protected paths", () => {
    expect(checkProtectedPaths(["src/a.ts", "docs/x.md"], { hasFactoryLabel: false }).ok).toBe(true);
  });

  it("does not match lookalike prefixes", () => {
    expect(checkProtectedPaths([".githubx/a.yml", "scripts/other.mjs"], { hasFactoryLabel: false }).ok).toBe(true);
  });
});

describe("checkPlanPrScope", () => {
  const ref = "ai/plan-17-status";

  it("allows plan PRs that change only docs/specs and docs/architecture.md", () => {
    expect(checkPlanPrScope(["docs/specs/status.md", "docs/architecture.md"], ref).ok).toBe(true);
  });

  it("blocks plan PRs that change anything else, naming the files", () => {
    const src = checkPlanPrScope(["src/app/page.tsx"], ref);
    expect(src.ok).toBe(false);
    expect(src.message).toContain("src/app/page.tsx");
    const wf = checkPlanPrScope([".github/workflows/x.yml"], ref);
    expect(wf.ok).toBe(false);
    expect(wf.message).toContain(".github/workflows/x.yml");
  });

  it("blocks lookalike paths", () => {
    expect(checkPlanPrScope(["docs/specs-x/a.md"], ref).ok).toBe(false);
    expect(checkPlanPrScope(["docs/architecture.md.bak"], ref).ok).toBe(false);
  });

  it("does not apply to other branches", () => {
    expect(checkPlanPrScope(["src/a.ts"], "ai/issue-3-x").ok).toBe(true);
    expect(checkPlanPrScope(["src/a.ts"], "feature/x").ok).toBe(true);
    expect(checkPlanPrScope(["src/a.ts"], undefined).ok).toBe(true);
  });
});
