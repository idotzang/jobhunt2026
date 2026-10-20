import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODELS, pickModel } from "./pick-model.mjs";

const CLI = fileURLToPath(new URL("./pick-model.mjs", import.meta.url));

function runCli(labelsEnv, defaultTier) {
  const env = { ...process.env };
  delete env.LABELS;
  delete env.DEFAULT_TIER;
  if (labelsEnv !== undefined) env.LABELS = labelsEnv;
  if (defaultTier !== undefined) env.DEFAULT_TIER = defaultTier;
  const res = spawnSync(process.execPath, [CLI], { env, encoding: "utf8" });
  return { code: res.status, stdout: res.stdout.trim() };
}

describe("pickModel", () => {
  it("defaults to sonnet", () => {
    expect(pickModel(["ai-build"])).toBe(MODELS.sonnet);
  });
  it("honours model labels", () => {
    expect(pickModel(["ai-build", "model:haiku"])).toBe("claude-haiku-5-5");
    expect(pickModel(["model:opus"])).toBe("claude-opus-5-5");
  });
  it("prefers the strongest model when several labels are present", () => {
    expect(pickModel(["model:haiku", "model:opus"])).toBe(MODELS.opus);
  });
  it("falls back to sonnet for non-array input", () => {
    expect(pickModel({})).toBe(MODELS.sonnet);
  });
});

describe("pickModel defaultTier", () => {
  it("uses the default tier when no model label is present", () => {
    expect(pickModel([], "opus")).toBe("claude-opus-5-5");
    expect(pickModel(["ai-plan"], "haiku")).toBe("claude-haiku-5-5");
  });
  it("lets labels override the default tier", () => {
    expect(pickModel(["model:sonnet"], "opus")).toBe("claude-sonnet-5-5");
    expect(pickModel(["model:haiku"], "opus")).toBe("claude-haiku-5-5");
  });
  it("prefers opus when sonnet and opus labels are both present", () => {
    expect(pickModel(["model:sonnet", "model:opus"], "haiku")).toBe(MODELS.opus);
  });
  it("falls back to sonnet for an invalid default tier", () => {
    expect(pickModel([], "gpt")).toBe(MODELS.sonnet);
    expect(pickModel([], undefined)).toBe(MODELS.sonnet);
    expect(pickModel([], "")).toBe(MODELS.sonnet);
  });
});

describe("pick-model CLI", () => {
  it("honours DEFAULT_TIER=opus with no labels", () => {
    expect(runCli("[]", "opus")).toEqual({ code: 0, stdout: "claude-opus-5-5" });
    expect(runCli(undefined, "opus")).toEqual({ code: 0, stdout: "claude-opus-5-5" });
  });
  it("honours DEFAULT_TIER=opus with garbage LABELS", () => {
    expect(runCli("not json", "opus")).toEqual({ code: 0, stdout: "claude-opus-5-5" });
  });
  it("lets a label beat DEFAULT_TIER=opus", () => {
    expect(runCli('["model:sonnet"]', "opus")).toEqual({ code: 0, stdout: "claude-sonnet-5-5" });
  });
  it("ignores an invalid DEFAULT_TIER", () => {
    expect(runCli("[]", "gpt")).toEqual({ code: 0, stdout: "claude-sonnet-5-5" });
  });
  it("prints the model for LABELS", () => {
    expect(runCli('["ai-build","model:opus"]')).toEqual({ code: 0, stdout: "claude-opus-5-5" });
  });
  it("falls back to sonnet when LABELS is not JSON", () => {
    expect(runCli("not json")).toEqual({ code: 0, stdout: "claude-sonnet-5-5" });
  });
  it("falls back to sonnet when LABELS is not an array", () => {
    expect(runCli('{"a":1}')).toEqual({ code: 0, stdout: "claude-sonnet-5-5" });
  });
  it("falls back to sonnet when LABELS is unset", () => {
    expect(runCli(undefined)).toEqual({ code: 0, stdout: "claude-sonnet-5-5" });
  });
});
