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
      cost_usd: null,
      cost_basis: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      thinking_tokens: null,
      api_duration_s: null,
      model_usage: {},
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
      cost_usd: null,
      cost_basis: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      thinking_tokens: null,
      api_duration_s: null,
      model_usage: {},
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

  describe("cost and usage", () => {
    const build = (res) =>
      buildRunRecord({ executionLog: res ? [res] : [], env: { CONCLUSION: "success", MODE: "build", PR: "1" }, now: new Date(0) });
    const realResult = {
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 17,
      duration_ms: 48075,
      duration_api_ms: 37620,
      total_cost_usd: 0.01246652,
      usage: {
        input_tokens: 30,
        cache_read_input_tokens: 439432,
        cache_creation_input_tokens: 23681,
        output_tokens: 6666,
        output_tokens_details: { thinking_tokens: 2007 },
      },
      modelUsage: {
        "claude-sonnet-5-5": {
          inputTokens: 30,
          outputTokens: 6666,
          cacheReadInputTokens: 439432,
          cacheCreationInputTokens: 23681,
          thinkingTokens: 2007,
          costUSD: 0.01246652,
          costBasis: "list",
        },
      },
    };
    const newFields = (r) => ({
      cost_usd: r.cost_usd,
      cost_basis: r.cost_basis,
      cache_read_tokens: r.cache_read_tokens,
      cache_creation_tokens: r.cache_creation_tokens,
      thinking_tokens: r.thinking_tokens,
      api_duration_s: r.api_duration_s,
      model_usage: r.model_usage,
    });

    it("captures cost, cache, thinking and per-model usage from a real-shaped result", () => {
      const r = build(realResult);
      expect(newFields(r)).toEqual({
        cost_usd: 0.012467,
        cost_basis: "list",
        cache_read_tokens: 439432,
        cache_creation_tokens: 23681,
        thinking_tokens: 2007,
        api_duration_s: 37.6,
        model_usage: {
          "claude-sonnet-5-5": {
            cost_usd: 0.012467,
            input_tokens: 30,
            output_tokens: 6666,
            cache_read_tokens: 439432,
            cache_creation_tokens: 23681,
          },
        },
      });
      expect(r.turns).toBe(17);
      expect(r.duration_s).toBe(48);
      expect(r.input_tokens).toBe(30);
      expect(r.output_tokens).toBe(6666);
    });

    it("reports nulls when usage is missing", () => {
      const r = build({ type: "result", subtype: "success", num_turns: 2, duration_ms: 1000 });
      expect(newFields(r)).toEqual({
        cost_usd: null,
        cost_basis: null,
        cache_read_tokens: null,
        cache_creation_tokens: null,
        thinking_tokens: null,
        api_duration_s: null,
        model_usage: {},
      });
    });

    it("maps every model in modelUsage", () => {
      const r = build({
        ...realResult,
        modelUsage: {
          a: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, costUSD: 0.5, costBasis: "list" },
          b: { inputTokens: 5, outputTokens: 6, cacheReadInputTokens: 7, cacheCreationInputTokens: 8, costUSD: 0.25, costBasis: "other" },
        },
      });
      expect(r.cost_basis).toBe("mixed");
      expect(r.model_usage).toEqual({
        a: { cost_usd: 0.5, input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_creation_tokens: 4 },
        b: { cost_usd: 0.25, input_tokens: 5, output_tokens: 6, cache_read_tokens: 7, cache_creation_tokens: 8 },
      });
    });

    it("turns strings, NaN, negatives and non-finite values into null", () => {
      const r = build({
        type: "result",
        total_cost_usd: "0.5",
        duration_api_ms: -5,
        usage: {
          input_tokens: Number.NaN,
          output_tokens: Infinity,
          cache_read_input_tokens: "12",
          cache_creation_input_tokens: -1,
          output_tokens_details: { thinking_tokens: null },
        },
        modelUsage: {
          good: { costUSD: 1, inputTokens: "x", outputTokens: -2, cacheReadInputTokens: Number.NaN, cacheCreationInputTokens: 4, costBasis: 7 },
          bad: "nope",
          worse: null,
        },
      });
      expect(r.input_tokens).toBeNull();
      expect(r.output_tokens).toBeNull();
      expect(newFields(r)).toEqual({
        cost_usd: null,
        cost_basis: null,
        cache_read_tokens: null,
        cache_creation_tokens: null,
        thinking_tokens: null,
        api_duration_s: null,
        model_usage: {
          good: { cost_usd: 1, input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: 4 },
        },
      });
      expect(JSON.stringify(r)).not.toMatch(/NaN|undefined/);
    });

    it("has all-null new fields and empty model_usage with no result message", () => {
      expect(newFields(build(null))).toEqual({
        cost_usd: null,
        cost_basis: null,
        cache_read_tokens: null,
        cache_creation_tokens: null,
        thinking_tokens: null,
        api_duration_s: null,
        model_usage: {},
      });
    });

    it("keeps zero values as numbers, not null", () => {
      const r = build({
        type: "result",
        total_cost_usd: 0,
        duration_api_ms: 0,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens_details: { thinking_tokens: 0 } },
        modelUsage: { m: { costUSD: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costBasis: "list" } },
      });
      expect(newFields(r)).toEqual({
        cost_usd: 0,
        cost_basis: "list",
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        thinking_tokens: 0,
        api_duration_s: 0,
        model_usage: { m: { cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 } },
      });
    });

    it("rejects booleans and numeric-looking strings", () => {
      const r = build({ type: "result", total_cost_usd: true, modelUsage: { m: { costUSD: "1.5" }, n: { costUSD: true } } });
      expect(r.cost_usd).toBeNull();
      expect(r.model_usage.m.cost_usd).toBeNull();
      expect(r.model_usage.n.cost_usd).toBeNull();
    });

    it("uses the shared basis when all models agree, null when none is given", () => {
      expect(build({ type: "result", modelUsage: { a: { costBasis: "list" }, b: { costBasis: "list" } } }).cost_basis).toBe("list");
      expect(build({ type: "result", modelUsage: { a: { costUSD: 1 } } }).cost_basis).toBeNull();
    });

    it("skips a __proto__ model key", () => {
      const modelUsage = JSON.parse('{"__proto__":{"costUSD":1},"ok":{"costUSD":2}}');
      const r = build({ type: "result", modelUsage });
      expect(Object.keys(r.model_usage)).toEqual(["ok"]);
      expect(Object.getPrototypeOf(r.model_usage)).toBe(Object.prototype);
    });
  });
});
