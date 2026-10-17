import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KNOWN_MODES = new Set(["build", "fix"]);

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

export function buildRunRecord({ executionLog, env, now }) {
  const messages = Array.isArray(executionLog) ? executionLog : [];
  const result = [...messages].reverse().find((m) => m?.type === "result") ?? null;
  const pr = toInt(env.PR);
  const mode = env.MODE === undefined || env.MODE === "" ? "build" : env.MODE;
  const outcome = KNOWN_MODES.has(mode) ? classifyOutcome(result, env.CONCLUSION, { pr, mode }) : "failed";
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
    input_tokens: result?.usage?.input_tokens ?? null,
    output_tokens: result?.usage?.output_tokens ?? null,
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
