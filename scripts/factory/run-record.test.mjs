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
  it("skips malformed and truncated JSONL lines but keeps the valid ones", () => {
    const text = `{"type":"system"}\n{"type":"assis\n${JSON.stringify(result)}\n{"type":"res`;
    expect(parseExecutionLog(text)).toEqual([{ type: "system" }, result]);
  });
  it("skips blank lines", () => {
    expect(parseExecutionLog(`\n\n{"type":"system"}\n\n   \n`)).toEqual([{ type: "system" }]);
  });
  it("recovers complete messages from a truncated pretty-printed array", () => {
    const text = `[\n  {"type": "system"},\n  ${JSON.stringify(result)},\n  {"type": "assis`;
    expect(parseExecutionLog(text)).toEqual([{ type: "system" }, result]);
  });
  it("returns [] for non-string input", () => {
    expect(parseExecutionLog(undefined)).toEqual([]);
    expect(parseExecutionLog(null)).toEqual([]);
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
  it("reports asked_human in fix mode without a PR", () => {
    expect(classifyOutcome(result, "success", { pr: null, mode: "fix" })).toBe("asked_human");
  });
  it("reports failed when there is no result message, whatever the conclusion", () => {
    expect(classifyOutcome(null, "success", { pr: 7, mode: "build" })).toBe("failed");
    expect(classifyOutcome(null, "failure", {})).toBe("failed");
  });
});

describe("buildRunRecord", () => {
  it("builds a flat record from the last result message and env", () => {
    const record = buildRunRecord({
      executionLog: [{ type: "system" }, result],
      env: {
        GITHUB_RUN_ID: "999",
        GITHUB_RUN_ATTEMPT: "2",
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
      run_attempt: 2,
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

  it("uses the last result message when there are several", () => {
    const earlier = { ...result, num_turns: 3 };
    const record = buildRunRecord({
      executionLog: [earlier, { type: "system" }, result],
      env: { CONCLUSION: "success", MODE: "build", PR: "1" },
      now: new Date(0),
    });
    expect(record.turns).toBe(23);
  });

  it("tolerates a missing result message and reports the full shape", () => {
    const record = buildRunRecord({
      executionLog: [],
      env: { GITHUB_RUN_ID: "5", SKILL: "implement-ticket", MODE: "build", ISSUE: "3", CONCLUSION: "success", PR: "9" },
      now: new Date(0),
    });
    expect(record).toEqual({
      run_id: "5",
      run_attempt: null,
      timestamp: "1970-01-01T00:00:00.000Z",
      skill: "implement-ticket",
      mode: "build",
      issue: 3,
      pr: 9,
      model: null,
      turns: null,
      duration_s: null,
      input_tokens: null,
      output_tokens: null,
      outcome: "failed",
      retries: 0,
    });
  });

  it("reports failed for an unknown MODE", () => {
    const record = buildRunRecord({
      executionLog: [result],
      env: { MODE: "review", CONCLUSION: "success", PR: "7" },
      now: new Date(0),
    });
    expect(record.outcome).toBe("failed");
  });

  it("treats an unset MODE as build", () => {
    const record = buildRunRecord({
      executionLog: [result],
      env: { CONCLUSION: "success", PR: "7" },
      now: new Date(0),
    });
    expect(record.outcome).toBe("pr_opened");
    expect(record.mode).toBe("build");
  });

  it("rejects malformed integers: non-digits become null, retries fall back to 0", () => {
    const record = buildRunRecord({
      executionLog: [result],
      env: { ISSUE: "12abc", PR: "-5", RETRY: "abc", GITHUB_RUN_ATTEMPT: "1.5", CONCLUSION: "success" },
      now: new Date(0),
    });
    expect(record.issue).toBeNull();
    expect(record.pr).toBeNull();
    expect(record.retries).toBe(0);
    expect(record.run_attempt).toBeNull();
  });

  it("reads RETRY when it is a plain integer", () => {
    const record = buildRunRecord({ executionLog: [], env: { RETRY: "2" }, now: new Date(0) });
    expect(record.retries).toBe(2);
  });
});
