import { describe, expect, it } from "vitest";
import { run } from "./cleanup.mjs";

const KEY = "napi_SECRET_KEY_123";
const br = (name, extra = {}) => ({ id: `br-${name.replace(/[^a-z0-9]/gi, "-")}`, name, default: false, protected: false, ...extra });
const resp = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

function setup({ projects, branches, deleteStatus = 200, deleteBody = {} }) {
  const calls = [];
  const lines = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method ?? "GET";
    calls.push({ url: String(url), method, headers: opts.headers });
    const u = new URL(url);
    if (method === "GET" && u.pathname.endsWith("/projects")) {
      return resp(200, typeof projects === "function" ? projects(u) : { projects });
    }
    if (method === "GET" && u.pathname.endsWith("/branches")) return resp(200, { branches });
    if (method === "DELETE") return resp(deleteStatus, deleteBody);
    return resp(500, "unexpected");
  };
  return { calls, lines, fetchImpl, log: (m) => lines.push(m) };
}
const deletes = (s) => s.calls.filter((c) => c.method === "DELETE");
const baseEnv = { NEON_API_KEY: KEY };
const proj = [{ id: "p1", name: "neon-cinereous-coin" }, { id: "p2", name: "other" }];
const branches = [br("main", { default: true }), br("dev"), br("preview/ai/issue-5"), br("preview/ai/issue-50")];

describe("pr mode", () => {
  it("deletes exactly one branch", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(0);
    expect(deletes(s).map((c) => c.url)).toEqual([
      "https://console.neon.tech/api/v2/projects/p1/branches/br-preview-ai-issue-5",
    ]);
    expect(s.lines).toContain("deleted preview/ai/issue-5");
  });
  it("sends the key only as a bearer header", async () => {
    const s = setup({ projects: proj, branches });
    await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log });
    for (const c of s.calls) {
      expect(c.url).not.toContain(KEY);
      expect(c.headers.Authorization).toBe(`Bearer ${KEY}`);
    }
  });
  it("no matching branch is a success with no deletes", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "nope" }, fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(0);
    expect(deletes(s)).toHaveLength(0);
  });
  it("invalid HEAD_REF fails without any request", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "a/../b" }, fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(1);
    expect(s.calls).toHaveLength(0);
  });
  it("missing key fails", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "pr", env: { HEAD_REF: "x" }, fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(1);
    expect(s.calls).toHaveLength(0);
  });
  it("tolerates 404 on delete", async () => {
    const s = setup({ projects: proj, branches, deleteStatus: 404 });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(0);
  });
  it("500 on delete fails and never logs the key", async () => {
    const s = setup({ projects: proj, branches, deleteStatus: 500, deleteBody: `boom ${KEY}` });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(1);
    expect(s.lines.join("\n")).toContain("500");
    expect(s.lines.join("\n")).not.toContain(KEY);
  });
});

describe("project resolution", () => {
  it("fails when project not found", async () => {
    const s = setup({ projects: [{ id: "p2", name: "other" }], branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(1);
    expect(deletes(s)).toHaveLength(0);
  });
  it("fails when project name is ambiguous", async () => {
    const s = setup({ projects: [...proj, { id: "p3", name: "neon-cinereous-coin" }], branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(1);
    expect(deletes(s)).toHaveLength(0);
  });
  it("honours NEON_PROJECT_NAME", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5", NEON_PROJECT_NAME: "other" }, fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(0);
    expect(s.calls.some((c) => c.url.includes("/projects/p2/branches"))).toBe(true);
  });
  it("follows cursor pagination", async () => {
    const s = setup({
      projects: (u) =>
        u.searchParams.get("cursor") === "c1"
          ? { projects: [{ id: "p1", name: "neon-cinereous-coin" }], pagination: {} }
          : { projects: [{ id: "p2", name: "other" }], pagination: { next: "c1" } },
      branches,
    });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(0);
    expect(s.calls[0].url).toContain("limit=100");
    expect(deletes(s)).toHaveLength(1);
  });
});

describe("sweep mode", () => {
  const env = (extra) => ({ ...baseEnv, LIVE_REFS: "main\nai/issue-5\n", ...extra });
  it("defaults to dry run: no DELETE", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "sweep", env: env(), fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(0);
    expect(deletes(s)).toHaveLength(0);
    expect(s.lines).toContain("would delete preview/ai/issue-50");
  });
  it("DRY_RUN=false deletes orphans only", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "sweep", env: env({ DRY_RUN: "false" }), fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(0);
    expect(deletes(s)).toHaveLength(1);
    expect(deletes(s)[0].url).toContain("br-preview-ai-issue-50");
  });
  it("empty LIVE_REFS aborts", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "sweep", env: env({ LIVE_REFS: "\n \n", DRY_RUN: "false" }), fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(1);
    expect(s.calls).toHaveLength(0);
  });
  it("aborts when more than 10 would be deleted", async () => {
    const many = [br("main", { default: true }), ...Array.from({ length: 11 }, (_, i) => br(`preview/b${i}`)), br("dev"), br("preview/keep1"), br("preview/keep2")];
    const s = setup({ projects: proj, branches: many });
    const code = await run({ mode: "sweep", env: env({ DRY_RUN: "false" }), fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(1);
    expect(deletes(s)).toHaveLength(0);
  });
  it("aborts when selection would be every branch", async () => {
    const only = [br("preview/a"), br("preview/b")];
    const s = setup({ projects: proj, branches: only });
    const code = await run({ mode: "sweep", env: env({ DRY_RUN: "false" }), fetchImpl: s.fetchImpl, log: s.log });
    expect(code).toBe(1);
    expect(deletes(s)).toHaveLength(0);
  });
  it("unknown mode fails", async () => {
    const s = setup({ projects: proj, branches });
    expect(await run({ mode: "bogus", env: baseEnv, fetchImpl: s.fetchImpl, log: s.log })).toBe(1);
  });
});
