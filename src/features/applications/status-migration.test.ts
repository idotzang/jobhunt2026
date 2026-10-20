import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applications } from "@/db/schema";

const dir = join(process.cwd(), "drizzle");
const file = readdirSync(dir).find((f) => f.endsWith(".sql") && /status/i.test(readFileSync(join(dir, f), "utf8")));
const sql = file ? readFileSync(join(dir, file), "utf8") : "";

describe("status migration", () => {
  it("exists", () => {
    expect(file).toBeDefined();
  });

  it("adds both columns with defaults", () => {
    expect(sql).toMatch(/ADD COLUMN "status" text DEFAULT 'applied' NOT NULL/);
    expect(sql).toMatch(/ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now\(\) NOT NULL/);
  });

  it("backfills status_changed_at from created_at", () => {
    expect(sql).toMatch(/UPDATE "applications" SET "status_changed_at" = "created_at"/);
  });

  it("has no destructive statements", () => {
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/i);
  });
});

describe("schema defaults", () => {
  it("new applications start as applied", () => {
    expect(applications.status.default).toBe("applied");
    expect(applications.status.notNull).toBe(true);
    expect(applications.statusChangedAt.hasDefault).toBe(true);
  });
});
