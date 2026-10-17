import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODELS, pickModel } from "./pick-model.mjs";

const CLI = fileURLToPath(new URL("./pick-model.mjs", import.meta.url));

function runCli(labelsEnv) {
  const env = { ...process.env };
  delete env.LABELS;
  if (labelsEnv !== undefined) env.LABELS = labelsEnv;
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

describe("pick-model CLI", () => {
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
