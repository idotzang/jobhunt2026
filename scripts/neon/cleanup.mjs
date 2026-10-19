import { fileURLToPath } from "node:url";
import { selectForPr, selectOrphans } from "./select.mjs";

const API = "https://console.neon.tech/api/v2";
const MAX_DELETES = 10;
const BRANCH_ID = /^br-[A-Za-z0-9-]+$/;
const PROJECT_ID = /^[A-Za-z0-9-]+$/;

class Abort extends Error {}

async function api(fetchImpl, key, path, method = "GET") {
  return fetchImpl(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
}

function redact(text, key) {
  let out = String(text);
  if (key) out = out.split(key).join("[redacted]");
  return out.replace(/napi_[A-Za-z0-9]+/g, "[redacted]").slice(0, 500);
}

async function fail(res, what, key) {
  const body = await res.text().catch(() => "");
  throw new Abort(`${what} failed: HTTP ${res.status} ${redact(body, key)}`);
}

async function findProject(fetchImpl, key, name) {
  const matches = [];
  let cursor;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const res = await api(fetchImpl, key, `/projects?${qs}`);
    if (!res.ok) await fail(res, "list projects", key);
    const body = await res.json();
    for (const p of body.projects ?? []) if (p.name === name) matches.push(p);
    cursor = body.pagination?.next;
  } while (cursor);
  if (matches.length !== 1) {
    throw new Abort(`expected exactly one project named "${name}", found ${matches.length}`);
  }
  if (!PROJECT_ID.test(matches[0].id)) throw new Abort("unexpected project id");
  return matches[0];
}

export async function run({ mode, env = {}, fetchImpl = fetch, log = console.log }) {
  const key = env.NEON_API_KEY;
  try {
    if (mode !== "pr" && mode !== "sweep") throw new Abort(`unknown mode "${mode}"`);
    if (!key) throw new Abort("NEON_API_KEY is not set");

    let pick;
    let dryRun = false;
    if (mode === "pr") {
      const headRef = env.HEAD_REF;
      pick = (branches) => selectForPr(branches, headRef);
      // Validate before any network call.
      selectForPr([], headRef);
    } else {
      dryRun = env.DRY_RUN !== "false";
      const live = (env.LIVE_REFS ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (live.length === 0) throw new Abort("LIVE_REFS is empty; refusing to sweep");
      pick = (branches) => selectOrphans(branches, live);
    }

    const project = await findProject(fetchImpl, key, env.NEON_PROJECT_NAME || "neon-cinereous-coin");
    const res = await api(fetchImpl, key, `/projects/${project.id}/branches`);
    if (!res.ok) await fail(res, "list branches", key);
    const branches = (await res.json()).branches ?? [];

    const selected = pick(branches);
    if (selected.length > MAX_DELETES) {
      throw new Abort(`refusing to delete ${selected.length} branches (max ${MAX_DELETES})`);
    }
    if (selected.length > 0 && selected.length >= branches.length) {
      throw new Abort("refusing to delete every branch");
    }
    if (selected.length === 0) log("nothing to delete");

    for (const b of selected) {
      if (dryRun) {
        log(`would delete ${b.name}`);
        continue;
      }
      if (!BRANCH_ID.test(b.id)) throw new Abort(`unexpected branch id for ${b.name}`);
      const del = await api(fetchImpl, key, `/projects/${project.id}/branches/${b.id}`, "DELETE");
      if (del.status === 404) {
        log(`already gone ${b.name}`);
        continue;
      }
      if (!del.ok) await fail(del, `delete ${b.name}`, key);
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
