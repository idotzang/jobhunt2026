import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { redact } from "./redact-transcript.mjs";

const CLI = fileURLToPath(new URL("./redact-transcript.mjs", import.meta.url));
const b64 = (s) => Buffer.from(s).toString("base64");
const SECRET = "ghp_abcdefghijklmnop1234";

describe("redact", () => {
  it("replaces a plain secret, every occurrence", () => {
    expect(redact(`a ${SECRET} b ${SECRET}`, [SECRET])).toBe("a *** b ***");
  });
  it("replaces base64 of x-access-token:secret and of the secret alone", () => {
    const text = `h ${b64(`x-access-token:${SECRET}`)} and ${b64(SECRET)}`;
    expect(redact(text, [SECRET])).toBe("h *** and ***");
  });
  it("ignores empty and short secrets", () => {
    expect(redact("abc 1234567 x", ["", "abc", "1234567", undefined])).toBe("abc 1234567 x");
  });
  it("leaves text unchanged with no secrets", () => {
    expect(redact("hello", [])).toBe("hello");
  });
  it("handles multiple secrets", () => {
    const s2 = "sk-ant-oat01-zzzzzzzzzz";
    expect(redact(`${SECRET} ${s2}`, [SECRET, s2])).toBe("*** ***");
  });
});

describe("CLI", () => {
  const run = (file, env) =>
    spawnSync(process.execPath, [CLI, file], {
      env: { PATH: process.env.PATH, ...env },
      encoding: "utf8",
    });
  it("rewrites the file in place", () => {
    const f = join(mkdtempSync(join(tmpdir(), "redact-")), "t.json");
    writeFileSync(f, `x ${SECRET} y ${b64(`x-access-token:${SECRET}`)}`);
    const res = run(f, { FACTORY_GH_TOKEN: SECRET, CLAUDE_CODE_OAUTH_TOKEN: "" });
    expect(res.status).toBe(0);
    expect(readFileSync(f, "utf8")).toBe("x *** y ***");
  });
  it("exits non-zero when the file is missing", () => {
    const res = run("/nonexistent/dir/t.json", { FACTORY_GH_TOKEN: SECRET });
    expect(res.status).not.toBe(0);
  });
  it("exits non-zero with no file argument", () => {
    const res = spawnSync(process.execPath, [CLI], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
  });
});
