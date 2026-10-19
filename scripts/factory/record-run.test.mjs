import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const VERCEL_JSON = '{"git":{"deploymentEnabled":false},"ignoreCommand":"exit 0"}\n';
const GIT = ["-c", "user.name=t", "-c", "user.email=t@t"];
const root = fs.mkdtempSync(path.join(os.tmpdir(), "record-run-test-"));
const repoScripts = path.resolve(import.meta.dirname);
let n = 0;

function git(cwd, ...args) {
  return execFileSync("git", [...GIT, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function setup() {
  const dir = path.join(root, `case${++n}`);
  const origin = path.join(dir, "origin.git");
  const clone = path.join(dir, "clone");
  fs.mkdirSync(dir);
  git(dir, "init", "--bare", "--quiet", "-b", "main", origin);
  git(dir, "clone", "--quiet", origin, clone);
  git(clone, "checkout", "--quiet", "-B", "main");
  fs.mkdirSync(path.join(clone, "scripts"));
  fs.cpSync(repoScripts, path.join(clone, "scripts/factory"), { recursive: true });
  fs.writeFileSync(path.join(clone, "README.md"), "hi\n");
  git(clone, "add", "-A");
  git(clone, "commit", "--quiet", "-m", "init");
  git(clone, "push", "--quiet", "origin", "main");
  return { dir, origin, clone };
}

function run(clone, dir) {
  const env = {
    ...process.env,
    GITHUB_RUN_ID: "1",
    SKILL: "implement-ticket",
    MODE: "implement",
    ISSUE: "5",
    PR: "6",
    MODEL: "m",
    CONCLUSION: "success",
    GITHUB_STEP_SUMMARY: path.join(dir, "summary.md"),
  };
  delete env.EXECUTION_FILE;
  const r = spawnSync("bash", ["scripts/factory/record-run.sh"], { cwd: clone, env, encoding: "utf8" });
  if (r.error) throw r.error;
  return r;
}

const show = (origin, file) => git(origin, "show", `factory-log:${file}`);
const lines = (s) => s.split("\n").filter(Boolean);

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("record-run.sh", { timeout: 60_000 }, () => {
  let ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it("creates factory-log with runs.jsonl and vercel.json", () => {
    const r = run(ctx.clone, ctx.dir);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(lines(show(ctx.origin, "runs.jsonl"))).toHaveLength(1);
    expect(show(ctx.origin, "vercel.json")).toBe(VERCEL_JSON);
  });

  it("appends on the second run and keeps vercel.json", () => {
    run(ctx.clone, ctx.dir);
    const r = run(ctx.clone, ctx.dir);
    expect(r.status).toBe(0);
    expect(lines(show(ctx.origin, "runs.jsonl"))).toHaveLength(2);
    expect(show(ctx.origin, "vercel.json")).toBe(VERCEL_JSON);
  });

  it("adds vercel.json to a pre-existing branch without it, keeping the old line", () => {
    const seed = path.join(ctx.dir, "seed");
    git(ctx.dir, "clone", "--quiet", ctx.origin, seed);
    git(seed, "checkout", "--quiet", "--orphan", "factory-log");
    git(seed, "rm", "-rf", "--quiet", ".");
    fs.writeFileSync(path.join(seed, "runs.jsonl"), '{"old":true}\n');
    git(seed, "add", "runs.jsonl");
    git(seed, "commit", "--quiet", "-m", "seed");
    git(seed, "push", "--quiet", "origin", "factory-log");
    const r = run(ctx.clone, ctx.dir);
    expect(r.status).toBe(0);
    const l = lines(show(ctx.origin, "runs.jsonl"));
    expect(l).toHaveLength(2);
    expect(l[0]).toBe('{"old":true}');
    expect(show(ctx.origin, "vercel.json")).toBe(VERCEL_JSON);
  });

  it("exits 0 with a warning when origin is unreachable", () => {
    git(ctx.clone, "remote", "set-url", "origin", path.join(ctx.dir, "nonexistent.git"));
    const r = run(ctx.clone, ctx.dir);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("::warning::");
  });

  it("leaves the clone's branch, HEAD and working tree unchanged", () => {
    const before = [
      git(ctx.clone, "rev-parse", "--abbrev-ref", "HEAD"),
      git(ctx.clone, "rev-parse", "HEAD"),
      git(ctx.clone, "status", "--porcelain"),
      git(ctx.clone, "branch", "--list"),
    ];
    run(ctx.clone, ctx.dir);
    const after = [
      git(ctx.clone, "rev-parse", "--abbrev-ref", "HEAD"),
      git(ctx.clone, "rev-parse", "HEAD"),
      git(ctx.clone, "status", "--porcelain"),
      git(ctx.clone, "branch", "--list"),
    ];
    expect(after).toEqual(before);
  });
});
