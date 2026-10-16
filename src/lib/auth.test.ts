import { describe, expect, it } from "vitest";
import { checkPassword, isPublicPath, isValidSession, safeEqual, sessionToken } from "./auth";

const config = { password: "hunter2", secret: "s3cret" };

describe("sessionToken", () => {
  it("is a deterministic 64-char hex string", async () => {
    const a = await sessionToken("hunter2", "s3cret");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sessionToken("hunter2", "s3cret")).toBe(a);
  });

  it("changes when the secret changes", async () => {
    expect(await sessionToken("hunter2", "other")).not.toBe(await sessionToken("hunter2", "s3cret"));
  });
});

describe("safeEqual", () => {
  it("compares strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("checkPassword", () => {
  it("accepts the configured password only", () => {
    expect(checkPassword("hunter2", config)).toBe(true);
    expect(checkPassword("wrong", config)).toBe(false);
  });

  it("fails closed when not configured", () => {
    expect(checkPassword("", {})).toBe(false);
  });
});

describe("isValidSession", () => {
  it("accepts the token derived from config", async () => {
    const token = await sessionToken("hunter2", "s3cret");
    expect(await isValidSession(token, config)).toBe(true);
  });

  it("rejects missing or wrong cookies", async () => {
    expect(await isValidSession(undefined, config)).toBe(false);
    expect(await isValidSession("deadbeef", config)).toBe(false);
  });

  it("fails closed when not configured", async () => {
    const token = await sessionToken("hunter2", "s3cret");
    expect(await isValidSession(token, {})).toBe(false);
  });
});

describe("isPublicPath", () => {
  it.each(["/login", "/login/x", "/api/health", "/api/health/x"])("%s is public", (p) => {
    expect(isPublicPath(p)).toBe(true);
  });
  it.each(["/loginfoo", "/api/healthz", "/", "/api/health-details"])("%s is not public", (p) => {
    expect(isPublicPath(p)).toBe(false);
  });
});
