import { describe, expect, it } from "vitest";
import { applicationCountLabel } from "./count";

describe("applicationCountLabel", () => {
  it("reads '0 applications' when there are none", () => {
    expect(applicationCountLabel(0)).toBe("0 applications");
  });

  it("reads '1 application' for a single application", () => {
    expect(applicationCountLabel(1)).toBe("1 application");
  });

  it("reads 'N applications' for several", () => {
    expect(applicationCountLabel(7)).toBe("7 applications");
  });
});
