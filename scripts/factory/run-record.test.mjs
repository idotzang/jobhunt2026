import { describe, expect, it } from "vitest";
import { buildRunRecord, classifyOutcome, parseExecutionLog } from "./run-record.mjs";

const result = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 23,
  duration_ms: 184_400,
  usage: { input_tokens: 120_000, output_tokens: 9_000 },
};

describe("parseExecutionLog", () => {
  it("parses a JSON array", () => {
    expect(parseExecutionLog(JSON.stringify([{ type: "system" }, result]))).toHaveLength(2);
  });
  it("parses JSONL", () => {
    expect(parseExecutionLog(`{"type":"system"}\n${JSON.stringify(result)}\n`)).toHaveLength(2);
  });
  it("returns [] for empty input", () => {
    expect(parseExecutionLog("")).toEqual([]);
  });
});

describe("classifyOutcome", () => {
  it("reports turn limit", () => {
    expect(classifyOutcome({ subtype: "error_max_turns" }, "failure", {})).toBe("turn_limit");
  });
  it("reports failure", () => {
    expect(classifyOutcome(result, "failure", {})).toBe("failed");
  });
  it("reports pr_opened in build mode with a PR", () => {
    expect(classifyOutcome(result, "success", { pr: 7, mode: "build" })).toBe("pr_opened");
  });
  it("reports fixed in fix mode", () => {
    expect(classifyOutcome(result, "success", { pr: 7, mode: "fix" })).toBe("fixed");
  });
  it("reports asked_human when it succeeded without a PR", () => {
    expect(classifyOutcome(result, "success", { pr: null, mode: "build" })).toBe("asked_human");
  });
});

describe("buildRunRecord", () => {
  it("builds a flat record from the last result message and env", () => {
    const record = buildRunRecord({
      executionLog: [{ type: "system" }, result],
      env: {
        GITHUB_RUN_ID: "999",
        SKILL: "implement-ticket",
        MODE: "build",
        ISSUE: "12",
        PR: "14",
        MODEL: "claude-sonnet-5-5",
        CONCLUSION: "success",
        RETRY: "",
      },
      now: new Date("2026-10-08T10:00:00Z"),
    });
    expect(record).toEqual({
      run_id: "999",
      timestamp: "2026-10-08T10:00:00.000Z",
      skill: "implement-ticket",
      mode: "build",
      issue: 12,
      pr: 14,
      model: "claude-sonnet-5-5",
      turns: 23,
      duration_s: 184,
      input_tokens: 120000,
      output_tokens: 9000,
      outcome: "pr_opened",
      retries: 0,
    });
  });

  it("tolerates a missing result message", () => {
    const record = buildRunRecord({ executionLog: [], env: { CONCLUSION: "failure" }, now: new Date(0) });
    expect(record.turns).toBeNull();
    expect(record.outcome).toBe("failed");
  });
});
