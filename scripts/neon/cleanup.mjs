import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { previewBranchName, selectForPr, selectOrphans } from "./select.mjs";

const API = "https://console.neon.tech/api/v2";
const MAX_DELETES = 10;
const MAX_ATTEMPTS = 4;
const MAX_RETRY_AFTER_MS = 10_000;
const MAX_PAGES = 50;
const BRANCH_ID = /^br-[A-Za-z0-9-]+$/;
const PROJECT_ID = /^[A-Za-z0-9-]+$/;
const SAFE_NAME = /^preview\/[A-Za-z0-9._/-]{1,200}$/;

class Abort extends Error {}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function retryable(status) {
  return status === 423 || status === 429 || status >= 500;
}

function retryDelay(res, attempt) {
  const raw = Number(res.headers?.get?.("retry-after"));
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw * 1000, MAX_RETRY_AFTER_MS);
  return 1000 * 2 ** (attempt - 1);
}

async function api(ctx, path, method = "GET") {
  let res;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await ctx.fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${ctx.key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!retryable(res.status) || attempt === MAX_ATTEMPTS) return res;
    await ctx.sleep(retryDelay(res, attempt));
  }
  return res;
}

function redact(text, key) {
  let out = String(text);
  if (key) out = out.split(key).join("[redacted]");
  return out.replace(/napi_[A-Za-z0-9]+/g, "[redacted]").slice(0, 500);
}

async function fail(ctx, res, what) {
  const body = await res.text().catch(() => "");
  throw new Abort(`${what} failed: HTTP ${res.status} ${redact(body, ctx.key)}`);
}

async function findProject(ctx, name) {
  const matches = [];
  const seen = new Set();
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const res = await api(ctx, `/projects?${qs}`);
    if (!res.ok) await fail(ctx, res, "list projects");
    const body = await res.json();
    const items = body.projects ?? [];
    for (const p of items) if (p.name === name) matches.push(p);
    cursor = body.pagination?.next || body.pagination?.cursor;
    if (items.length === 0 || !cursor || seen.has(cursor)) break;
    seen.add(cursor);
  }
  if (matches.length !== 1) {
    throw new Abort(`expected exactly one project named "${name}", found ${matches.length}`);
  }
  if (!PROJECT_ID.test(String(matches[0].id))) throw new Abort("unexpected project id");
  return matches[0];
}

function readLiveRefs(env, fs) {
  const path = env.LIVE_REFS_FILE;
  if (!path) throw new Abort("LIVE_REFS_FILE is not set");
  let text;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch {
    throw new Abort("cannot read live refs file");
  }
  const refs = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (refs.length === 0) throw new Abort("live refs file is empty; refusing to sweep");
  return refs;
}

function writeSummary(env, fs, dryRun, selected) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  const names = selected.map((b) => (SAFE_NAME.test(b.name) ? b.name : "(unprintable name)"));
  const text =
    `### Neon sweep (${dryRun ? "dry run" : "live"})\n\n` +
    (names.length ? "```\n" + names.join("\n") + "\n```\n" : "Nothing to delete.\n");
  try {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text);
  } catch {
    // The summary is best-effort.
  }
}

export async function run({
  mode,
  env = {},
  fetchImpl = fetch,
  log = console.log,
  sleep = defaultSleep,
  fs = { readFileSync, appendFileSync },
}) {
  const key = env.NEON_API_KEY;
  const ctx = { key, fetchImpl, sleep };
  try {
    if (mode !== "pr" && mode !== "sweep") throw new Abort(`unknown mode "${mode}"`);

    let pick;
    let dryRun = false;
    if (mode === "pr") {
      let name;
      try {
        name = previewBranchName(env.HEAD_REF);
      } catch {
        log("skipped: unsupported ref");
        return 0;
      }
      log(`looking for ${name}`);
      pick = (branches) => selectForPr(branches, env.HEAD_REF);
    } else {
      dryRun = env.DRY_RUN !== "false";
      const live = readLiveRefs(env, fs);
      pick = (branches) => selectOrphans(branches, live);
    }
    if (!key) throw new Abort("NEON_API_KEY is not set");

    const project = await findProject(ctx, env.NEON_PROJECT_NAME || "neon-cinereous-coin");
    const res = await api(ctx, `/projects/${project.id}/branches`);
    if (!res.ok) await fail(ctx, res, "list branches");
    const branches = (await res.json()).branches ?? [];

    const selected = pick(branches);
    if (selected.length > MAX_DELETES) {
      throw new Abort(`refusing to delete ${selected.length} branches (max ${MAX_DELETES})`);
    }
    if (selected.length > 0 && selected.length >= branches.length) {
      throw new Abort("refusing to delete every branch");
    }
    for (const b of selected) {
      if (!BRANCH_ID.test(String(b.id))) throw new Abort(`unexpected branch id for ${b.name}`);
    }
    if (selected.length === 0) log("nothing to delete");
    if (mode === "sweep") writeSummary(env, fs, dryRun, selected);

    for (const b of selected) {
      if (dryRun) {
        log(`would delete ${b.name}`);
        continue;
      }
      const del = await api(ctx, `/projects/${project.id}/branches/${b.id}`, "DELETE");
      if (del.status === 404) {
        log(`already gone ${b.name}`);
        continue;
      }
      if (!del.ok) await fail(ctx, del, `delete ${b.name}`);
      log(`deleted ${b.name}`);
    }
    return 0;
  } catch (err) {
    log(`error: ${redact(err?.message ?? err, key)}`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await run({ mode: process.argv[2], env: process.env });
}
