import { describe, expect, it } from "vitest";
import { parseNewApplication } from "./validation";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const valid = { company: " Acme ", role: "Staff Engineer", link: "", appliedOn: "2026-10-08" };

describe("parseNewApplication", () => {
  it("accepts a valid application, trimming text and nulling an empty link", () => {
    const result = parseNewApplication(form(valid));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ company: "Acme", role: "Staff Engineer", link: null, appliedOn: "2026-10-08" });
  });

  it("keeps a valid link", () => {
    const result = parseNewApplication(form({ ...valid, link: "https://acme.com/jobs/1" }));
    expect(result.data?.link).toBe("https://acme.com/jobs/1");
  });

  it("requires company", () => {
    const result = parseNewApplication(form({ ...valid, company: "  " }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Company is required");
  });

  it("requires role", () => {
    const result = parseNewApplication(form({ ...valid, role: "" }));
    expect(result.error?.issues[0].message).toBe("Role is required");
  });

  it("rejects a malformed link", () => {
    expect(parseNewApplication(form({ ...valid, link: "not a url" })).success).toBe(false);
  });

  it("rejects non-http(s) link schemes", () => {
    expect(parseNewApplication(form({ ...valid, link: "javascript:alert(1)" })).success).toBe(false);
    expect(parseNewApplication(form({ ...valid, link: "ftp://x.com" })).success).toBe(false);
  });

  it("accepts http and https links", () => {
    expect(parseNewApplication(form({ ...valid, link: "http://x.com" })).success).toBe(true);
    expect(parseNewApplication(form({ ...valid, link: "https://x.com" })).success).toBe(true);
  });

  it("rejects a malformed date", () => {
    expect(parseNewApplication(form({ ...valid, appliedOn: "yesterday" })).success).toBe(false);
  });
});
