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

function setup({ projects, branches, deleteStatus = 200, deleteBody = {}, deleteStatuses, projectsStatus = 200, branchesStatus = 200, retryAfter }) {
  const calls = [];
  const lines = [];
  const sleeps = [];
  const queue = deleteStatuses ? [...deleteStatuses] : null;
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method ?? "GET";
    calls.push({ url: String(url), method, headers: opts.headers, signal: opts.signal });
    const u = new URL(url);
    if (method === "GET" && u.pathname.endsWith("/projects")) {
      if (projectsStatus !== 200) return resp(projectsStatus, "nope");
      return resp(200, typeof projects === "function" ? projects(u) : { projects });
    }
    if (method === "GET" && u.pathname.endsWith("/branches")) {
      return branchesStatus !== 200 ? resp(branchesStatus, "nope") : resp(200, { branches });
    }
    if (method === "DELETE") {
      const st = queue ? (queue.length > 1 ? queue.shift() : queue[0]) : deleteStatus;
      const r = resp(st, deleteBody);
      if (retryAfter !== undefined) r.headers = { get: (h) => (h.toLowerCase() === "retry-after" ? String(retryAfter) : null) };
      return r;
    }
    return resp(500, "unexpected");
  };
  return { calls, lines, sleeps, fetchImpl, log: (m) => lines.push(m), sleep: async (ms) => { sleeps.push(ms); } };
}
const deletes = (s) => s.calls.filter((c) => c.method === "DELETE");
const baseEnv = { NEON_API_KEY: KEY };
const proj = [{ id: "p1", name: "neon-cinereous-coin" }, { id: "p2", name: "other" }];
const branches = [br("main", { default: true }), br("dev"), br("preview/ai/issue-5"), br("preview/ai/issue-50")];

describe("pr mode", () => {
  it("deletes exactly one branch", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(0);
    expect(deletes(s).map((c) => c.url)).toEqual([
      "https://console.neon.tech/api/v2/projects/p1/branches/br-preview-ai-issue-5",
    ]);
    expect(s.lines).toContain("deleted preview/ai/issue-5");
  });
  it("sends the key only as a bearer header", async () => {
    const s = setup({ projects: proj, branches });
    await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    for (const c of s.calls) {
      expect(c.url).not.toContain(KEY);
      expect(c.headers.Authorization).toBe(`Bearer ${KEY}`);
    }
  });
  it("no matching branch is a success with no deletes", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "nope" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(0);
    expect(deletes(s)).toHaveLength(0);
  });
  it.each(["a/../b", "a\nb", "", "a b", "x".repeat(300)])("unsupported HEAD_REF %j is skipped with exit 0 and no request", async (ref) => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: ref }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(0);
    expect(s.lines).toContain("skipped: unsupported ref");
    expect(s.calls).toHaveLength(0);
  });
  it("missing HEAD_REF is skipped", async () => {
    const s = setup({ projects: proj, branches });
    expect(await run({ mode: "pr", env: baseEnv, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep })).toBe(0);
    expect(s.lines).toContain("skipped: unsupported ref");
  });
  it("logs which preview branch it is looking for", async () => {
    const s = setup({ projects: proj, branches });
    await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(s.lines).toContain("looking for preview/ai/issue-5");
  });
  it("case variants never match: head ref MAIN, Preview/x, PREVIEW/x", async () => {
    const bs = [br("main", { default: true }), br("dev"), br("Preview/x"), br("PREVIEW/x"), br("preview/other")];
    for (const ref of ["MAIN", "x", "main"]) {
      const s = setup({ projects: proj, branches: bs });
      const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: ref }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
      expect(code).toBe(0);
      expect(deletes(s)).toHaveLength(0);
    }
  });
  it("every fetch has a timeout signal", async () => {
    const s = setup({ projects: proj, branches });
    await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    for (const c of s.calls) expect(c.signal).toBeInstanceOf(AbortSignal);
  });
  it("missing key fails", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "pr", env: { HEAD_REF: "x" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(1);
    expect(s.calls).toHaveLength(0);
  });
  it("tolerates 404 on delete", async () => {
    const s = setup({ projects: proj, branches, deleteStatus: 404 });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(0);
  });
  it("500 on delete fails and never logs the key (after 4 attempts)", async () => {
    const s = setup({ projects: proj, branches, deleteStatus: 500, deleteBody: `boom ${KEY}` });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(1);
    expect(s.lines.join("\n")).toContain("500");
    expect(s.lines.join("\n")).not.toContain(KEY);
    expect(deletes(s)).toHaveLength(4);
  });
});

describe("retries", () => {
  const prEnv = { ...baseEnv, HEAD_REF: "ai/issue-5" };
  it.each([423, 429, 503])("retries %i then succeeds, backing off 1s,2s", async (st) => {
    const s = setup({ projects: proj, branches, deleteStatuses: [st, st, 200] });
    const code = await run({ mode: "pr", env: prEnv, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(0);
    expect(deletes(s)).toHaveLength(3);
    expect(s.sleeps).toEqual([1000, 2000]);
  });
  it("gives up after 4 attempts with delays 1s,2s,4s", async () => {
    const s = setup({ projects: proj, branches, deleteStatuses: [429] });
    const code = await run({ mode: "pr", env: prEnv, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(1);
    expect(deletes(s)).toHaveLength(4);
    expect(s.sleeps).toEqual([1000, 2000, 4000]);
  });
  it("does not retry 400 or 404", async () => {
    const s = setup({ projects: proj, branches, deleteStatuses: [400] });
    expect(await run({ mode: "pr", env: prEnv, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep })).toBe(1);
    expect(deletes(s)).toHaveLength(1);
    expect(s.sleeps).toEqual([]);
  });
  it("honours Retry-After, capped at 10s", async () => {
    const s = setup({ projects: proj, branches, deleteStatuses: [429, 429, 200], retryAfter: 3 });
    await run({ mode: "pr", env: prEnv, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(s.sleeps).toEqual([3000, 3000]);
    const t = setup({ projects: proj, branches, deleteStatuses: [429, 200], retryAfter: 999 });
    await run({ mode: "pr", env: prEnv, fetchImpl: t.fetchImpl, log: t.log, sleep: t.sleep });
    expect(t.sleeps).toEqual([10000]);
  });
  it("retries GET calls too", async () => {
    let n = 0;
    const s = setup({ projects: proj, branches });
    const inner = s.fetchImpl;
    const fetchImpl = async (url, o) => (new URL(url).pathname.endsWith("/projects") && n++ < 1 ? resp(503, "x") : inner(url, o));
    const code = await run({ mode: "pr", env: prEnv, fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(0);
    expect(s.sleeps).toEqual([1000]);
  });
});

describe("project resolution", () => {
  it("fails when project not found", async () => {
    const s = setup({ projects: [{ id: "p2", name: "other" }], branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(1);
    expect(deletes(s)).toHaveLength(0);
  });
  it("fails when project name is ambiguous", async () => {
    const s = setup({ projects: [...proj, { id: "p3", name: "neon-cinereous-coin" }], branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(1);
    expect(deletes(s)).toHaveLength(0);
  });
  it("aborts on non-2xx list projects before any DELETE", async () => {
    const s = setup({ projects: proj, branches, projectsStatus: 401 });
    expect(await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep })).toBe(1);
    expect(s.lines.join("\n")).toContain("list projects failed: HTTP 401");
    expect(deletes(s)).toHaveLength(0);
  });
  it("aborts on non-2xx list branches before any DELETE", async () => {
    const s = setup({ projects: proj, branches, branchesStatus: 403 });
    expect(await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep })).toBe(1);
    expect(s.lines.join("\n")).toContain("list branches failed: HTTP 403");
    expect(deletes(s)).toHaveLength(0);
  });
  it("rejects an invalid project id", async () => {
    const s = setup({ projects: [{ id: "p1/../x", name: "neon-cinereous-coin" }], branches });
    expect(await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep })).toBe(1);
    expect(s.lines.join("\n")).toContain("unexpected project id");
    expect(s.calls.filter((c) => c.url.includes("/branches"))).toHaveLength(0);
  });
  it("rejects hostile branch ids without any DELETE", async () => {
    for (const id of ["br-x/../..", "br-x?force=1"]) {
      const bs = [br("main", { default: true }), br("dev"), br("preview/ai/issue-5", { id }), br("preview/z")];
      const s = setup({ projects: proj, branches: bs });
      expect(await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep })).toBe(1);
      expect(s.lines.join("\n")).toContain("unexpected branch id");
      expect(deletes(s)).toHaveLength(0);
    }
  });
  it.each([
    ["pagination.next", "next"],
    ["pagination.cursor", "cursor"],
  ])("follows %s", async (_n, field) => {
    const s = setup({
      projects: (u) =>
        u.searchParams.get("cursor") === "c1"
          ? { projects: [{ id: "p1", name: "neon-cinereous-coin" }], pagination: {} }
          : { projects: [{ id: "p2", name: "other" }], pagination: { [field]: "c1" } },
      branches,
    });
    expect(await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep })).toBe(0);
    expect(deletes(s)).toHaveLength(1);
  });
  it("stops on a repeated cursor (no infinite loop)", async () => {
    const s = setup({ projects: () => ({ projects: [{ id: "p2", name: "other" }], pagination: { next: "same" } }), branches });
    expect(await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep })).toBe(1);
    expect(s.calls.filter((c) => c.url.includes("/projects?")).length).toBeLessThanOrEqual(3);
  });
  it("stops on an empty page", async () => {
    const s = setup({ projects: () => ({ projects: [], pagination: { next: "more" } }), branches });
    expect(await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep })).toBe(1);
    expect(s.calls.filter((c) => c.url.includes("/projects?"))).toHaveLength(1);
  });
  it("honours NEON_PROJECT_NAME", async () => {
    const s = setup({ projects: proj, branches });
    const code = await run({ mode: "pr", env: { ...baseEnv, HEAD_REF: "ai/issue-5", NEON_PROJECT_NAME: "other" }, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep });
    expect(code).toBe(0);
    expect(s.calls.some((c) => c.url.includes("/projects/p2/branches"))).toBe(true);
  });
});

describe("sweep mode", () => {
  const REFS_PATH = "/tmp/refs.txt";
  const mkFs = (content) => {
    const summary = [];
    return {
      summary,
      fs: {
        readFileSync: (p) => {
          if (p !== REFS_PATH || content === null) throw new Error("ENOENT");
          return content;
        },
        appendFileSync: (p, t) => summary.push([p, t]),
      },
    };
  };
  const env = (extra) => ({ ...baseEnv, LIVE_REFS_FILE: REFS_PATH, GITHUB_STEP_SUMMARY: "/tmp/summary.md", ...extra });
  const go = (s, e, content = "main\nai/issue-5\n") => {
    const f = mkFs(content);
    return run({ mode: "sweep", env: e, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep, fs: f.fs }).then((code) => ({ code, summary: f.summary }));
  };
  it("defaults to dry run: no DELETE", async () => {
    const s = setup({ projects: proj, branches });
    const { code } = await go(s, env());
    expect(code).toBe(0);
    expect(deletes(s)).toHaveLength(0);
    expect(s.lines).toContain("would delete preview/ai/issue-50");
  });
  it("DRY_RUN=false deletes orphans only", async () => {
    const s = setup({ projects: proj, branches });
    const { code } = await go(s, env({ DRY_RUN: "false" }));
    expect(code).toBe(0);
    expect(deletes(s)).toHaveLength(1);
    expect(deletes(s)[0].url).toContain("br-preview-ai-issue-50");
  });
  it("missing LIVE_REFS_FILE env aborts", async () => {
    const s = setup({ projects: proj, branches });
    const { code } = await go(s, { ...baseEnv, DRY_RUN: "false" });
    expect(code).toBe(1);
    expect(s.lines.join("\n")).toContain("LIVE_REFS_FILE");
    expect(s.calls).toHaveLength(0);
  });
  it("unreadable refs file aborts", async () => {
    const s = setup({ projects: proj, branches });
    const { code } = await go(s, env({ DRY_RUN: "false" }), null);
    expect(code).toBe(1);
    expect(s.calls).toHaveLength(0);
  });
  it("empty refs file aborts", async () => {
    const s = setup({ projects: proj, branches });
    const { code } = await go(s, env({ DRY_RUN: "false" }), "\n \n");
    expect(code).toBe(1);
    expect(s.lines.join("\n")).toContain("live refs file is empty");
    expect(s.calls).toHaveLength(0);
  });
  it("aborts when more than 10 would be deleted", async () => {
    const many = [br("main", { default: true }), ...Array.from({ length: 11 }, (_, i) => br(`preview/b${i}`)), br("dev"), br("preview/keep1"), br("preview/keep2")];
    const s = setup({ projects: proj, branches: many });
    const { code } = await go(s, env({ DRY_RUN: "false" }), "keep1\nkeep2\n");
    expect(code).toBe(1);
    expect(s.lines.join("\n")).toContain("refusing to delete 11 branches (max 10)");
    expect(deletes(s)).toHaveLength(0);
  });
  it("aborts when selection would be every branch", async () => {
    const s = setup({ projects: proj, branches: [br("preview/a"), br("preview/b")] });
    const { code } = await go(s, env({ DRY_RUN: "false" }));
    expect(code).toBe(1);
    expect(s.lines.join("\n")).toContain("refusing to delete every branch");
    expect(deletes(s)).toHaveLength(0);
  });
  it("deletes both branches that share a name", async () => {
    const bs = [br("main", { default: true }), br("dev"), br("preview/gone", { id: "br-1" }), br("preview/gone", { id: "br-2" })];
    const s = setup({ projects: proj, branches: bs });
    const { code } = await go(s, env({ DRY_RUN: "false" }));
    expect(code).toBe(0);
    expect(deletes(s).map((c) => c.url.split("/").pop())).toEqual(["br-1", "br-2"]);
  });
  it("case variants of preview/ are not swept", async () => {
    const bs = [br("main", { default: true }), br("Preview/x"), br("PREVIEW/y"), br("dev")];
    const s = setup({ projects: proj, branches: bs });
    const { code } = await go(s, env({ DRY_RUN: "false" }));
    expect(code).toBe(0);
    expect(deletes(s)).toHaveLength(0);
  });
  it("writes a markdown summary with validated names only", async () => {
    const bs = [...branches, br("preview/we`ird")];
    const s = setup({ projects: proj, branches: bs });
    const { summary } = await go(s, env());
    expect(summary).toHaveLength(1);
    const [path, text] = summary[0];
    expect(path).toBe("/tmp/summary.md");
    expect(text).toContain("preview/ai/issue-50");
    expect(text).not.toContain("we`ird");
  });
  it("unknown mode fails", async () => {
    const s = setup({ projects: proj, branches });
    expect(await run({ mode: "bogus", env: baseEnv, fetchImpl: s.fetchImpl, log: s.log, sleep: s.sleep })).toBe(1);
  });
});
