import { describe, expect, it } from "vitest";
import { MODELS, pickModel } from "./pick-model.mjs";

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
});
