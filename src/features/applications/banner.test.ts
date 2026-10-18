import { describe, expect, it } from "vitest";
import { addedBanner } from "./banner";

describe("addedBanner", () => {
  it("reads 'Added <company>' with the company name as entered", () => {
    expect(addedBanner("Acme")).toBe("Added Acme");
  });
});
