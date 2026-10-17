import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Standalone on purpose: CI runs a copy of this file from the base branch, so it may
// import only node builtins.

// import.meta.url is the real path (macOS /var -> /private/var), so resolve argv[1] the
// same way. Fails closed: if argv[1] cannot be resolved, this is not the entrypoint.
export function isEntrypoint(argv1, metaUrl) {
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

export function splitNul(output) {
  return output.split("\0").filter(Boolean);
}

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

const PROTECTED_PREFIXES = [".github/", ".claude/", "scripts/factory/"];

export function checkProtectedPaths(files, { hasFactoryLabel }) {
  if (hasFactoryLabel) return { ok: true, message: "protected-paths: ok" };
  const touched = files.filter((f) => PROTECTED_PREFIXES.some((p) => f.startsWith(p)));
  if (touched.length === 0) return { ok: true, message: "protected-paths: ok" };
  return {
    ok: false,
    message:
      `PR touches protected paths:\n  ${touched.join("\n  ")}\n` +
      `This PR needs the factory label, added by the owner after review.`,
  };
}

function git(args) {
  return splitNul(execFileSync("git", args, { encoding: "utf8" }));
}

if (isEntrypoint(process.argv[1], import.meta.url)) {
  const base = process.argv[2] ?? "origin/main";
  // --no-renames: a rename shows as delete + add, so the old path is still protected.
  // -z: NUL-separated, unquoted paths.
  const allFiles = git(["diff", "-z", "--name-only", "--no-renames", `${base}...HEAD`]);
  // Deleted test files must not count as test changes.
  const nonDeleted = git(["diff", "-z", "--name-only", "--no-renames", "--diff-filter=d", `${base}...HEAD`]);

  const protectedResult = checkProtectedPaths(allFiles, {
    hasFactoryLabel: process.env.FACTORY_LABEL === "true",
  });
  console.log(protectedResult.message);

  let testsOk = true;
  if (process.env.SKIP === "true") {
    console.log("tests-with-code: skipped by label");
  } else {
    const result = checkTestsWithCode(nonDeleted);
    console.log(result.message);
    testsOk = result.ok;
  }
  process.exit(protectedResult.ok && testsOk ? 0 : 1);
}
