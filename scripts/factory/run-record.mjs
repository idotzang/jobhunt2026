import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KNOWN_MODES = new Set(["build", "fix", "plan", "replan"]);

// Keep every line that parses; blank or broken lines (e.g. a truncated tail) are skipped.
// Trailing commas are stripped so lines from a pretty-printed array still parse.
function parseLines(text) {
  const messages = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim().replace(/,$/, "");
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // skip this line
    }
  }
  return messages;
}

export function parseExecutionLog(text) {
  if (typeof text !== "string") return [];
  try {
    const trimmed = text.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return parseLines(trimmed);
    }
  } catch {
    return [];
  }
}

export function classifyOutcome(result, conclusion, { pr, mode } = {}) {
  if (!result) return "failed";
  if (result.subtype === "error_max_turns") return "turn_limit";
  if (conclusion !== "success" || result.is_error) return "failed";
  if (!pr) return "asked_human";
  return mode === "fix" ? "fixed" : "pr_opened";
}

// Only plain non-negative integers; anything else (including "-5", "12abc", "") is null.
const toInt = (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number.parseInt(v, 10) : null);

// Finite, non-negative numbers only; anything else (strings, NaN, Infinity, negatives) is null.
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const round = (v, digits) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);

function buildModelUsage(modelUsage) {
  const out = {};
  if (!modelUsage || typeof modelUsage !== "object" || Array.isArray(modelUsage)) return out;
  for (const [model, u] of Object.entries(modelUsage)) {
    if (model === "__proto__") continue;
    if (!u || typeof u !== "object" || Array.isArray(u)) continue;
    out[model] = {
      cost_usd: round(num(u.costUSD), 6),
      input_tokens: num(u.inputTokens),
      output_tokens: num(u.outputTokens),
      cache_read_tokens: num(u.cacheReadInputTokens),
      cache_creation_tokens: num(u.cacheCreationInputTokens),
    };
  }
  return out;
}

export function buildRunRecord({ executionLog, env, now }) {
  const messages = Array.isArray(executionLog) ? executionLog : [];
  const result = [...messages].reverse().find((m) => m?.type === "result") ?? null;
  const pr = toInt(env.PR);
  const mode = env.MODE === undefined || env.MODE === "" ? "build" : env.MODE;
  const outcome = KNOWN_MODES.has(mode) ? classifyOutcome(result, env.CONCLUSION, { pr, mode }) : "failed";
  const bases = new Set(
    Object.values(result?.modelUsage && typeof result.modelUsage === "object" ? result.modelUsage : {})
      .map((u) => u?.costBasis)
      .filter((b) => typeof b === "string"),
  );
  const costBasis = bases.size === 0 ? null : bases.size === 1 ? [...bases][0] : "mixed";
  return {
    run_id: env.GITHUB_RUN_ID ?? null,
    run_attempt: toInt(env.GITHUB_RUN_ATTEMPT),
    timestamp: now.toISOString(),
    skill: env.SKILL ?? null,
    mode,
    issue: toInt(env.ISSUE),
    pr,
    model: env.MODEL ?? null,
    turns: result?.num_turns ?? null,
    duration_s: result?.duration_ms != null ? Math.round(result.duration_ms / 1000) : null,
    input_tokens: num(result?.usage?.input_tokens),
    output_tokens: num(result?.usage?.output_tokens),
    cost_usd: round(num(result?.total_cost_usd), 6),
    cost_basis: costBasis,
    cache_read_tokens: num(result?.usage?.cache_read_input_tokens),
    cache_creation_tokens: num(result?.usage?.cache_creation_input_tokens),
    thinking_tokens: num(result?.usage?.output_tokens_details?.thinking_tokens),
    api_duration_s: round(num(result?.duration_api_ms) === null ? null : result.duration_api_ms / 1000, 1),
    model_usage: buildModelUsage(result?.modelUsage),
    outcome,
    retries: toInt(env.RETRY) ?? 0,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let text = "";
  try {
    text = process.env.EXECUTION_FILE ? readFileSync(process.env.EXECUTION_FILE, "utf8") : "";
  } catch {
    text = "";
  }
  console.log(JSON.stringify(buildRunRecord({ executionLog: parseExecutionLog(text), env: process.env, now: new Date() })));
}
