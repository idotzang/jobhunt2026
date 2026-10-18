import { describe, expect, it } from "vitest";
import { pluralizeApplications } from "./plural";

describe("pluralizeApplications", () => {
  it("uses the singular for exactly one", () => {
    expect(pluralizeApplications(1)).toBe("1 application");
  });

  it("uses the plural otherwise", () => {
    expect(pluralizeApplications(0)).toBe("0 applications");
    expect(pluralizeApplications(3)).toBe("3 applications");
  });
});
