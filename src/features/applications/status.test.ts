import { describe, expect, it } from "vitest";
import { ACTIVE_STATUSES, STATUSES, STATUS_LABELS, statusSchema } from "./status";

describe("statuses", () => {
  it("are exactly the six lowercase values with labels", () => {
    expect([...STATUSES]).toEqual(["applied", "screening", "interview", "offer", "rejected", "withdrawn"]);
    expect(STATUS_LABELS).toEqual({
      applied: "Applied",
      screening: "Screening",
      interview: "Interview",
      offer: "Offer",
      rejected: "Rejected",
      withdrawn: "Withdrawn",
    });
  });

  it("ACTIVE_STATUSES excludes rejected and withdrawn", () => {
    expect([...ACTIVE_STATUSES]).toEqual(["applied", "screening", "interview", "offer"]);
  });
});

describe("statusSchema", () => {
  it.each(STATUSES)("accepts %s", (s) => {
    expect(statusSchema.safeParse(s).success).toBe(true);
  });

  it.each(["", "unknown", "Applied", "OFFER", " applied", null, undefined, 1])("rejects %j", (v) => {
    expect(statusSchema.safeParse(v).success).toBe(false);
  });
});
