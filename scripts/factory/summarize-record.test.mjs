import { describe, expect, it } from "vitest";
import { summarizeRecord } from "./summarize-record.mjs";

const record = {
  run_id: "999",
  skill: "implement-ticket",
  mode: "build",
  model: "claude-sonnet-5-5",
  outcome: "pr_opened",
  turns: 17,
  duration_s: 48,
  cost_usd: 0.012467,
  input_tokens: 30,
  output_tokens: 6666,
  cache_read_tokens: 439432,
  cache_creation_tokens: 23681,
};

describe("summarizeRecord", () => {
  it("renders a one-line human-readable summary", () => {
    expect(summarizeRecord(record)).toBe(
      "Run 999 · implement-ticket build · claude-sonnet-5-5 · pr_opened · 17 turns · 48s · cost ≈ $0.0125 (list price, notional — billed to the subscription) · tokens in/out/cache-read/cache-write = 30/6,666/439,432/23,681",
    );
  });

  it("shows n/a for null or missing values", () => {
    expect(summarizeRecord({ run_id: null, outcome: "failed", turns: null, cost_usd: null })).toBe(
      "Run n/a · n/a n/a · n/a · failed · n/a turns · n/as · cost ≈ n/a (list price, notional — billed to the subscription) · tokens in/out/cache-read/cache-write = n/a/n/a/n/a/n/a",
    );
  });

  it("never throws on non-object input", () => {
    expect(() => summarizeRecord(null)).not.toThrow();
    expect(summarizeRecord(undefined)).toContain("Run n/a");
  });

  it("treats NaN and strings as n/a", () => {
    expect(summarizeRecord({ ...record, cost_usd: Number.NaN, turns: "x" })).toContain("n/a turns · 48s · cost ≈ n/a");
  });
});
