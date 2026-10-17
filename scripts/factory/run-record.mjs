import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function parseExecutionLog(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }
}

export function classifyOutcome(result, conclusion, { pr, mode } = {}) {
  if (result?.subtype === "error_max_turns") return "turn_limit";
  if (conclusion !== "success" || result?.is_error) return "failed";
  if (!pr) return "asked_human";
  return mode === "fix" ? "fixed" : "pr_opened";
}

const toInt = (v) => (v === undefined || v === null || v === "" ? null : Number.parseInt(v, 10));

export function buildRunRecord({ executionLog, env, now }) {
  const result = [...executionLog].reverse().find((m) => m?.type === "result") ?? {};
  const pr = toInt(env.PR);
  const mode = env.MODE ?? "build";
  return {
    run_id: env.GITHUB_RUN_ID ?? null,
    timestamp: now.toISOString(),
    skill: env.SKILL ?? null,
    mode,
    issue: toInt(env.ISSUE),
    pr,
    model: env.MODEL ?? null,
    turns: result.num_turns ?? null,
    duration_s: result.duration_ms != null ? Math.round(result.duration_ms / 1000) : null,
    input_tokens: result.usage?.input_tokens ?? null,
    output_tokens: result.usage?.output_tokens ?? null,
    outcome: classifyOutcome(result, env.CONCLUSION, { pr, mode }),
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
