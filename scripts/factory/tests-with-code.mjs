import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function isTestFile(path) {
  return /\.(test|spec)\.(ts|tsx|mjs)$/.test(path) || path.startsWith("e2e/");
}

export function isSourceFile(path) {
  return path.startsWith("src/") && !isTestFile(path);
}

export function checkTestsWithCode(files) {
  const source = files.filter(isSourceFile);
  const tests = files.filter(isTestFile);
  if (source.length === 0 || tests.length > 0) {
    return { ok: true, message: `ok: ${source.length} source file(s), ${tests.length} test file(s)` };
  }
  return {
    ok: false,
    message:
      `Source changed without any test changes:\n  ${source.join("\n  ")}\n` +
      `Add or update a test, or label the PR "skip-tests-check" if no test is meaningful.`,
  };
}

const PROTECTED_PREFIXES = [".github/workflows/", ".claude/skills/"];

export function checkProtectedPaths(files, { branch, hasFactoryLabel }) {
  if (!branch.startsWith("ai/") || hasFactoryLabel) return { ok: true, message: "protected-paths: ok" };
  const touched = files.filter((f) => PROTECTED_PREFIXES.some((p) => f.startsWith(p)));
  if (touched.length === 0) return { ok: true, message: "protected-paths: ok" };
  return {
    ok: false,
    message:
      `Agent PR touches factory files without the "factory" label:\n  ${touched.join("\n  ")}\n` +
      `Only the owner may add the "factory" label after reviewing.`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] ?? "origin/main";
  const files = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" }).split("\n").filter(Boolean);

  const protectedResult = checkProtectedPaths(files, {
    branch: process.env.BRANCH ?? "",
    hasFactoryLabel: process.env.FACTORY_LABEL === "true",
  });
  console.log(protectedResult.message);

  let testsOk = true;
  if (process.env.SKIP === "true") {
    console.log("tests-with-code: skipped by label");
  } else {
    const result = checkTestsWithCode(files);
    console.log(result.message);
    testsOk = result.ok;
  }
  process.exit(protectedResult.ok && testsOk ? 0 : 1);
}
