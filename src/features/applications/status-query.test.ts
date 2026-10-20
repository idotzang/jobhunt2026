import { describe, expect, it } from "vitest";
import { normalizeStatusFilter, statusChanged } from "./status-query";

describe("normalizeStatusFilter", () => {
  it("returns undefined for missing or empty lists (no filtering)", () => {
    expect(normalizeStatusFilter(undefined)).toBeUndefined();
    expect(normalizeStatusFilter([])).toBeUndefined();
  });

  it("keeps valid statuses, deduplicated", () => {
    expect(normalizeStatusFilter(["interview", "offer", "interview"])).toEqual(["interview", "offer"]);
  });
});

describe("statusChanged", () => {
  it("is true only when the status differs", () => {
    expect(statusChanged("applied", "interview")).toBe(true);
    expect(statusChanged("interview", "interview")).toBe(false);
  });
});
