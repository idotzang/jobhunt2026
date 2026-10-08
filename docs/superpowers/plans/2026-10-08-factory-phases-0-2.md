# Factory Bootstrap (Phases 0–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live, password-protected job-hunt walking skeleton on Vercel + Neon, guarded by CI/regression/security gates, with a ticket-triggered TDD worker agent that turns a labelled GitHub issue into a gated PR and logs every run.

**Architecture:** Next.js 16 App Router app (single password via `proxy.ts`, Drizzle ORM on Neon Postgres, pino JSON logs). GitHub Actions run the gates and the agent (`anthropics/claude-code-action@v1` on the owner's subscription). Vercel deploys a preview per PR (with a Neon branch) and production on merge. Agent run records go to `runs.jsonl` on an orphan `factory-log` branch.

**Tech Stack:** Next.js 16.4, TypeScript, Tailwind, Drizzle ORM 0.45 + drizzle-kit 0.31, @neondatabase/serverless 1.2, zod 4, pino 10, Vitest 5, Playwright 1.64, GitHub Actions, Vercel, Neon.

**Spec:** `docs/superpowers/specs/2026-10-07-jobhunt-factory-design.md`

## Global Constraints

- Owner writes no code; owner does only account/credential steps (marked **OWNER**). Never enter credentials on the owner's behalf.
- Single user: one password (`APP_PASSWORD`) + `SESSION_SECRET`, no user accounts.
- Agents authenticate with `CLAUDE_CODE_OAUTH_TOKEN` (subscription), never an API key.
- Every agent run is triggered by a human-originated event (label, merge, or a gate failure on an agent PR). No cron.
- One agent run at a time: every agent workflow uses `concurrency: { group: factory-agent, cancel-in-progress: false }`.
- Default model `claude-sonnet-5-5`; `model:haiku` → `claude-haiku-4-5-20251001`; `model:opus` → `claude-opus-5-5`.
- `CLAUDE.md` stays ≤ ~10 lines; behavior lives in `.claude/skills/`.
- Node 22. Use `npm`.
- GitHub Action major versions below (`actions/checkout@v6`, `actions/setup-node@v5`, `actions/upload-artifact@v5`, `github/codeql-action/*@v4`, `gitleaks/gitleaks-action@v2`): if a major doesn't resolve, use the newest major on that action's releases page.
- Run records omit gate results (gates run after the agent finishes); retro/report join gate results from GitHub checks via the `pr` field.

## File Structure

```
CLAUDE.md                                  thin agent entry point (Task 12)
vercel.json                                disable deploys of factory-log branch (Task 7)
drizzle.config.ts                          drizzle-kit config (Task 4)
drizzle/                                   generated SQL migrations (Task 4)
vitest.config.ts                           unit test config (Task 1)
playwright.config.ts                       e2e config, local or BASE_URL (Task 6)
e2e/applications.spec.ts                   regression suite seed (Task 6)
src/proxy.ts                               auth gate + request id (Task 3)
src/lib/auth.ts (+ .test.ts)               pure session/password logic (Task 3)
src/lib/session.ts                         requireSession() for server code (Task 3)
src/lib/logger.ts (+ .test.ts)             pino logger + request child loggers (Task 2)
src/lib/request-logger.ts                  logger bound to current request (Task 2)
src/app/login/page.tsx, actions.ts         login UI + server action (Task 3)
src/db/schema.ts, client.ts                Drizzle schema + client (Task 4)
src/features/applications/validation.ts (+ .test.ts)  input parsing (Task 4)
src/features/applications/repository.ts    DB queries (Task 4)
src/features/applications/actions.ts       addApplication server action (Task 5)
src/app/page.tsx                           applications page (Task 5)
src/app/api/health/route.ts                health endpoint (Task 5)
scripts/factory/tests-with-code.mjs (+ .test.mjs)   gate (Task 8)
scripts/factory/pick-model.mjs (+ .test.mjs)        label → model (Task 13)
scripts/factory/run-record.mjs (+ .test.mjs)        execution log → JSON line (Task 13)
scripts/factory/record-run.sh               append record to factory-log (Task 13)
.github/workflows/ci.yml                   lint/type/unit/tests-with-code (Task 8)
.github/workflows/e2e.yml                  Playwright vs preview + prod health (Task 9)
.github/workflows/security.yml             CodeQL, npm audit, gitleaks (Task 10)
.github/workflows/factory-build.yml        ai-build label → worker (Task 14)
.github/workflows/factory-fix.yml          gate failure on agent PR → fix loop (Task 15)
.github/ISSUE_TEMPLATE/{epic,task}.yml, config.yml  (Task 12)
.claude/skills/implement-ticket/SKILL.md   TDD worker skill (Task 12)
```

---

# Phase 0 — Walking skeleton, live

### Task 1: Scaffold Next.js app with test tooling

**Files:**
- Create: Next.js scaffold (`package.json`, `src/app/*`, `tsconfig.json`, `eslint.config.mjs`, …), `vitest.config.ts`, `src/lib/smoke.test.ts`
- Modify: `package.json` scripts, `.gitignore`, `next.config.ts`

**Interfaces:**
- Produces: npm scripts `lint`, `typecheck`, `test`, `test:e2e`, `db:generate`, `db:migrate`, `vercel-build`; `@/*` → `src/*` alias working in Vitest.

- [ ] **Step 1: Scaffold**

The repo already contains `docs/` and `.git`. Run:

```bash
npx create-next-app@latest . --ts --eslint --tailwind --app --src-dir --import-alias "@/*" --use-npm --yes
```

If it refuses because the directory isn't empty, scaffold into a temp dir and copy everything except `.git` in:

```bash
npx create-next-app@latest /tmp/jh-scaffold --ts --eslint --tailwind --app --src-dir --import-alias "@/*" --use-npm --yes
rsync -a --exclude .git /tmp/jh-scaffold/ ./
```

- [ ] **Step 2: Install dependencies used by later tasks**

```bash
npm install drizzle-orm @neondatabase/serverless pino zod
npm install -D vitest drizzle-kit @playwright/test @next/env
```

- [ ] **Step 3: Add scripts to `package.json`** (merge into the existing `"scripts"` object, keep `dev`/`build`/`start`)

```json
"lint": "eslint .",
"typecheck": "tsc --noEmit",
"test": "vitest run",
"test:e2e": "playwright test",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"vercel-build": "npm run db:migrate && next build"
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
```

- [ ] **Step 5: Set `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pino"],
};

export default nextConfig;
```

- [ ] **Step 6: Append to `.gitignore`**

```
/test-results/
/playwright-report/
```

- [ ] **Step 7: Write a smoke test proving the alias + runner work** — `src/lib/smoke.test.ts`

```ts
import { describe, expect, it } from "vitest";

describe("test runner", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Verify tooling**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all pass, `1 passed`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 app with Vitest"
```

---

### Task 2: Structured logger with request IDs

**Files:**
- Create: `src/lib/logger.ts`, `src/lib/logger.test.ts`, `src/lib/request-logger.ts`
- Delete: `src/lib/smoke.test.ts`

**Interfaces:**
- Produces:
  - `REQUEST_ID_HEADER = "x-request-id"`
  - `newRequestId(): string`
  - `createLogger(destination?: pino.DestinationStream): pino.Logger`
  - `logger: pino.Logger`
  - `requestLogger(requestId: string, base?: pino.Logger): pino.Logger`
  - `getRequestLogger(): Promise<pino.Logger>` (server-only; reads the request header)

- [ ] **Step 1: Write the failing test** — `src/lib/logger.test.ts`

```ts
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, newRequestId, requestLogger } from "./logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, stream };
}

describe("logger", () => {
  it("writes JSON lines tagged with the app name", () => {
    const { lines, stream } = capture();
    createLogger(stream).info("hello");
    expect(lines[0]).toMatchObject({ app: "jobhunt", msg: "hello" });
  });

  it("binds the request id on child loggers", () => {
    const { lines, stream } = capture();
    requestLogger("req-123", createLogger(stream)).info("in request");
    expect(lines[0]).toMatchObject({ requestId: "req-123", msg: "in request" });
  });

  it("generates unique request ids", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/logger.test.ts`
Expected: FAIL — cannot resolve `./logger`.

- [ ] **Step 3: Implement** — `src/lib/logger.ts`

```ts
import pino from "pino";

export const REQUEST_ID_HEADER = "x-request-id";

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function createLogger(destination?: pino.DestinationStream): pino.Logger {
  const options: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL ?? "info",
    base: { app: "jobhunt" },
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();

export function requestLogger(requestId: string, base: pino.Logger = logger): pino.Logger {
  return base.child({ requestId });
}
```

`src/lib/request-logger.ts`:

```ts
import "server-only";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, requestLogger } from "./logger";

export async function getRequestLogger() {
  const h = await headers();
  return requestLogger(h.get(REQUEST_ID_HEADER) ?? "unknown");
}
```

If `server-only` isn't installed: `npm install server-only`.

- [ ] **Step 4: Run to verify it passes, delete smoke test**

```bash
rm src/lib/smoke.test.ts
npx vitest run src/lib/logger.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: structured JSON logger with request ids"
```

---

### Task 3: Single-password auth

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth.test.ts`, `src/lib/session.ts`, `src/proxy.ts`, `src/app/login/page.tsx`, `src/app/login/actions.ts`, `.env.example`

**Interfaces:**
- Consumes: `REQUEST_ID_HEADER`, `newRequestId`, `getRequestLogger` (Task 2)
- Produces:
  - `SESSION_COOKIE = "jh_session"`
  - `type AuthConfig = { password?: string; secret?: string }`
  - `authConfigFromEnv(): AuthConfig`
  - `sessionToken(password: string, secret: string): Promise<string>` (64-char hex HMAC-SHA256)
  - `safeEqual(a: string, b: string): boolean`
  - `checkPassword(input: string, config: AuthConfig): boolean`
  - `isValidSession(cookie: string | undefined, config: AuthConfig): Promise<boolean>`
  - `requireSession(): Promise<void>` (redirects to `/login` if invalid)

- [ ] **Step 1: Write the failing test** — `src/lib/auth.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { checkPassword, isValidSession, safeEqual, sessionToken } from "./auth";

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: FAIL — cannot resolve `./auth`.

- [ ] **Step 3: Implement** — `src/lib/auth.ts`

```ts
export const SESSION_COOKIE = "jh_session";

export type AuthConfig = { password?: string; secret?: string };

export function authConfigFromEnv(): AuthConfig {
  return { password: process.env.APP_PASSWORD, secret: process.env.SESSION_SECRET };
}

export async function sessionToken(password: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(password));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkPassword(input: string, config: AuthConfig): boolean {
  if (!config.password || !config.secret) return false;
  return safeEqual(input, config.password);
}

export async function isValidSession(cookie: string | undefined, config: AuthConfig): Promise<boolean> {
  if (!cookie || !config.password || !config.secret) return false;
  return safeEqual(cookie, await sessionToken(config.password, config.secret));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit the tested core**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat: password + session token logic"
```

- [ ] **Step 6: Wire it into Next.js**

`src/lib/session.ts`:

```ts
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, authConfigFromEnv, isValidSession } from "./auth";

export async function requireSession(): Promise<void> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(cookie, authConfigFromEnv()))) redirect("/login");
}
```

`src/proxy.ts` (Next 16 replaces `middleware.ts` with `proxy.ts`; if the installed Next major is < 16, name the file `src/middleware.ts` and the function `middleware`):

```ts
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authConfigFromEnv, isValidSession } from "@/lib/auth";
import { REQUEST_ID_HEADER, newRequestId } from "@/lib/logger";

const PUBLIC_PATHS = ["/login", "/api/health"];

export async function proxy(request: NextRequest) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;

  if (!isPublic && !(await isValidSession(cookie, authConfigFromEnv()))) {
    const res = NextResponse.redirect(new URL("/login", request.url));
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  }

  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

`src/app/login/actions.ts`:

```ts
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, authConfigFromEnv, checkPassword, sessionToken } from "@/lib/auth";
import { getRequestLogger } from "@/lib/request-logger";

export async function login(formData: FormData) {
  const log = await getRequestLogger();
  const config = authConfigFromEnv();
  const password = String(formData.get("password") ?? "");

  if (!checkPassword(password, config)) {
    log.warn("login failed");
    redirect("/login?error=1");
  }

  (await cookies()).set(SESSION_COOKIE, await sessionToken(config.password!, config.secret!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  log.info("login succeeded");
  redirect("/");
}
```

`src/app/login/page.tsx`:

```tsx
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-2xl font-semibold">Job Hunt</h1>
      <form action={login} className="flex flex-col gap-3">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required className="rounded border p-2" />
        {error && (
          <p role="alert" className="text-red-600">
            Wrong password
          </p>
        )}
        <button type="submit" className="rounded bg-black p-2 text-white">
          Sign in
        </button>
      </form>
    </main>
  );
}
```

`.env.example`:

```
APP_PASSWORD=change-me
SESSION_SECRET=generate-with-openssl-rand-hex-32
DATABASE_URL=postgres://...
LOG_LEVEL=info
```

- [ ] **Step 7: Verify**

Run: `npm run lint && npm run typecheck && npm test`
Expected: all pass. (Browser behavior is covered by Task 6's e2e tests.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: password login page and proxy auth gate"
```

---

### Task 4: Database schema and application validation

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`, `src/features/applications/validation.ts`, `src/features/applications/validation.test.ts`, `src/features/applications/repository.ts`, `drizzle/` (generated)

**Interfaces:**
- Produces:
  - table `applications` (`id serial`, `company text`, `role text`, `link text null`, `applied_on date`, `created_at timestamptz`)
  - `type Application = typeof applications.$inferSelect`
  - `getDb()` → Drizzle client; throws `"DATABASE_URL is not set"` if missing
  - `newApplicationSchema` (zod), `type NewApplication = { company: string; role: string; link: string | null; appliedOn: string }`
  - `parseNewApplication(formData: FormData)` → zod `SafeParseReturnType`
  - `listApplications(): Promise<Application[]>` (newest `appliedOn` first)
  - `createApplication(input: NewApplication): Promise<void>`

- [ ] **Step 1: Write the failing validation test** — `src/features/applications/validation.test.ts`

```ts
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

  it("rejects a malformed date", () => {
    expect(parseNewApplication(form({ ...valid, appliedOn: "yesterday" })).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/applications/validation.test.ts`
Expected: FAIL — cannot resolve `./validation`.

- [ ] **Step 3: Implement** — `src/features/applications/validation.ts`

```ts
import { z } from "zod";

export const newApplicationSchema = z.object({
  company: z.string().trim().min(1, "Company is required").max(200),
  role: z.string().trim().min(1, "Role is required").max(200),
  link: z.union([z.literal(""), z.url("Link must be a valid URL")]).transform((v) => v || null),
  appliedOn: z.iso.date("Applied date must be YYYY-MM-DD"),
});

export type NewApplication = z.infer<typeof newApplicationSchema>;

export function parseNewApplication(formData: FormData) {
  const field = (name: string) => String(formData.get(name) ?? "");
  return newApplicationSchema.safeParse({
    company: field("company"),
    role: field("role"),
    link: field("link").trim(),
    appliedOn: field("appliedOn"),
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/applications/validation.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/applications/validation.ts src/features/applications/validation.test.ts
git commit -m "feat: validate new application input"
```

- [ ] **Step 6: Schema, client, repository, drizzle config**

`src/db/schema.ts`:

```ts
import { date, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  link: text("link"),
  appliedOn: date("applied_on").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Application = typeof applications.$inferSelect;
```

`src/db/client.ts`:

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}
```

`src/features/applications/repository.ts`:

```ts
import "server-only";
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { applications, type Application } from "@/db/schema";
import type { NewApplication } from "./validation";

export async function listApplications(): Promise<Application[]> {
  return getDb().select().from(applications).orderBy(desc(applications.appliedOn), desc(applications.id));
}

export async function createApplication(input: NewApplication): Promise<void> {
  await getDb().insert(applications).values(input);
}
```

`drizzle.config.ts`:

```ts
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
```

- [ ] **Step 7: Generate the migration (no DB needed)**

Run: `npm run db:generate`
Expected: creates `drizzle/0000_*.sql` containing `CREATE TABLE "applications"`.

- [ ] **Step 8: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test` → all pass.

```bash
git add -A
git commit -m "feat: applications table, Drizzle client and repository"
```

---

### Task 5: Applications page and health endpoint

**Files:**
- Create: `src/features/applications/actions.ts`, `src/app/api/health/route.ts`
- Modify: `src/app/page.tsx` (replace scaffold content), `src/app/layout.tsx` (title only)

**Interfaces:**
- Consumes: `requireSession` (Task 3), `getRequestLogger`, `logger` (Task 2), `parseNewApplication`, `listApplications`, `createApplication`, `getDb` (Task 4)
- Produces: `GET /api/health` → `200 {"status":"ok","db":"ok"}` or `503 {"status":"error","db":"error"}`; page `/` with form labelled fields **Company**, **Role**, **Link**, **Applied on**, button **Add application**, heading **Applications**, list with accessible name **Applications**.

- [ ] **Step 1: Server action** — `src/features/applications/actions.ts`

```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRequestLogger } from "@/lib/request-logger";
import { requireSession } from "@/lib/session";
import { createApplication } from "./repository";
import { parseNewApplication } from "./validation";

export async function addApplication(formData: FormData) {
  await requireSession();
  const log = await getRequestLogger();
  const parsed = parseNewApplication(formData);

  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues.map((i) => i.path.join(".")) }, "invalid application");
    redirect(`/?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }

  await createApplication(parsed.data);
  log.info({ company: parsed.data.company }, "application created");
  revalidatePath("/");
}
```

- [ ] **Step 2: Page** — replace `src/app/page.tsx`

```tsx
import { addApplication } from "@/features/applications/actions";
import { listApplications } from "@/features/applications/repository";
import { requireSession } from "@/lib/session";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireSession();
  const { error } = await searchParams;
  const apps = await listApplications();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">Applications</h1>

      <form action={addApplication} className="grid gap-3">
        <input name="company" aria-label="Company" placeholder="Company" required className="rounded border p-2" />
        <input name="role" aria-label="Role" placeholder="Role" required className="rounded border p-2" />
        <input name="link" type="url" aria-label="Link" placeholder="Job link (optional)" className="rounded border p-2" />
        <input name="appliedOn" type="date" aria-label="Applied on" required defaultValue={today} className="rounded border p-2" />
        {error && (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        )}
        <button type="submit" className="rounded bg-black p-2 text-white">
          Add application
        </button>
      </form>

      {apps.length === 0 ? (
        <p>No applications yet.</p>
      ) : (
        <ul aria-label="Applications" className="divide-y rounded border">
          {apps.map((a) => (
            <li key={a.id} className="p-3">
              <span className="font-medium">{a.company}</span> — {a.role}{" "}
              <span className="text-gray-500">({a.appliedOn})</span>
              {a.link && (
                <>
                  {" · "}
                  <a href={a.link} target="_blank" rel="noreferrer" className="underline">
                    link
                  </a>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

In `src/app/layout.tsx`, set `metadata.title` to `"Job Hunt"` (leave everything else).

- [ ] **Step 3: Health route** — `src/app/api/health/route.ts`

```ts
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok", db: "ok" });
  } catch (err) {
    logger.error({ err }, "health check failed");
    return Response.json({ status: "error", db: "error" }, { status: 503 });
  }
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test` → all pass.

```bash
git add -A
git commit -m "feat: applications page and health endpoint"
```

---

### Task 6: Playwright regression suite seed

**Files:**
- Create: `playwright.config.ts`, `e2e/applications.spec.ts`

**Interfaces:**
- Consumes: page contract from Task 5; env `BASE_URL` (optional), `E2E_PASSWORD` or `APP_PASSWORD`.
- Produces: `npm run test:e2e` — runs against `BASE_URL` if set, otherwise starts `npm run dev`.

- [ ] **Step 1: Config** — `playwright.config.ts`

```ts
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "@playwright/test";

loadEnvConfig(process.cwd());
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: process.env.BASE_URL
    ? undefined
    : { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
```

- [ ] **Step 2: Tests** — `e2e/applications.spec.ts`

```ts
import { expect, test } from "@playwright/test";

const password = process.env.E2E_PASSWORD ?? process.env.APP_PASSWORD;

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok", db: "ok" });
});

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("wrong password is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong password");
});

test("sign in, add an application, see it in the list", async ({ page }) => {
  test.skip(!password, "E2E_PASSWORD not set");
  const company = `Acme ${Date.now()}`;

  await page.goto("/login");
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Applications" })).toBeVisible();

  await page.getByLabel("Company").fill(company);
  await page.getByLabel("Role").fill("Staff Engineer");
  await page.getByRole("button", { name: "Add application" }).click();

  await expect(page.getByRole("list", { name: "Applications" })).toContainText(company);
});
```

- [ ] **Step 3: Install browser and list tests (no DB yet)**

```bash
npx playwright install chromium
npx playwright test --list
```
Expected: 4 tests listed. Full runs happen after Task 7 provides a database.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: Playwright regression suite seed"
```

---

### Task 7: Deploy — GitHub, Vercel, Neon (OWNER + agent)

**Files:**
- Create: `vercel.json`

**Interfaces:**
- Produces: GitHub repo `jobhunt2026` (public); Vercel project with production URL; Neon database with preview branching; env vars `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET` in all Vercel environments; local `.env.local`.

- [ ] **Step 1: Keep the log branch out of Vercel** — `vercel.json`

```json
{
  "git": {
    "deploymentEnabled": {
      "factory-log": false
    }
  }
}
```

```bash
git add vercel.json
git commit -m "chore: don't deploy the factory-log branch"
```

- [ ] **Step 2: Create and push the GitHub repo** (agent runs this only after the owner confirms the repo may be created **public** — public gives free Actions minutes and free CodeQL)

```bash
gh repo create jobhunt2026 --public --source . --push
```

- [ ] **Step 3: OWNER — Vercel + Neon**
  1. Sign in at vercel.com with GitHub → **Add New → Project** → import `jobhunt2026` → Framework: Next.js → **Deploy** (first deploy may fail without a DB; fine).
  2. In the project: **Storage → Create Database → Neon** → create a database and connect it to **Production, Preview, Development**. Enable **"Create database branch for deployment" for Preview** if offered. Confirm `DATABASE_URL` appears under **Settings → Environment Variables** (if the integration uses a different name, add `DATABASE_URL` pointing at the same value).
  3. **Settings → Environment Variables**: add `APP_PASSWORD` (your choice) and `SESSION_SECRET` (run `openssl rand -hex 32` locally) for **all environments**.
  4. **Settings → Deployment Protection**: turn **Vercel Authentication off** for Preview (the app has its own password; CI must reach previews).
  5. **Deployments → Redeploy** the latest production deployment.

- [ ] **Step 4: Pull env locally and run everything against the dev branch**

```bash
npx vercel link --yes
npx vercel env pull .env.local --environment=development
npm run db:migrate
npm run test:e2e
```
Expected: migration applies; 4 Playwright tests pass.

- [ ] **Step 5: Verify production**

```bash
curl -s https://<production-domain>/api/health
```
Expected: `{"status":"ok","db":"ok"}`. Open the URL in a browser, sign in, add an application. **Phase 0 done: live URL.**

---

# Phase 1 — Gates

### Task 8: CI workflow and tests-with-code gate

**Files:**
- Create: `scripts/factory/tests-with-code.mjs`, `scripts/factory/tests-with-code.test.mjs`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces:
  - `isTestFile(path: string): boolean`, `isSourceFile(path: string): boolean`
  - `checkTestsWithCode(files: string[]): { ok: boolean; message: string }`
  - CLI: `node scripts/factory/tests-with-code.mjs <base-ref>` exits 1 on violation, 0 otherwise; env `SKIP=true` bypasses.
  - Status check named **`checks`**.

- [ ] **Step 1: Failing test** — `scripts/factory/tests-with-code.test.mjs`

```js
import { describe, expect, it } from "vitest";
import { checkTestsWithCode, isSourceFile, isTestFile } from "./tests-with-code.mjs";

describe("file classification", () => {
  it("recognises test files", () => {
    expect(isTestFile("src/lib/auth.test.ts")).toBe(true);
    expect(isTestFile("e2e/applications.spec.ts")).toBe(true);
    expect(isTestFile("scripts/factory/x.test.mjs")).toBe(true);
    expect(isTestFile("src/lib/auth.ts")).toBe(false);
  });

  it("treats non-test files under src/ as source", () => {
    expect(isSourceFile("src/lib/auth.ts")).toBe(true);
    expect(isSourceFile("src/lib/auth.test.ts")).toBe(false);
    expect(isSourceFile("docs/specs/x.md")).toBe(false);
  });
});

describe("checkTestsWithCode", () => {
  it("passes when source changes come with test changes", () => {
    expect(checkTestsWithCode(["src/a.ts", "src/a.test.ts"]).ok).toBe(true);
  });

  it("passes when no source changed", () => {
    expect(checkTestsWithCode(["README.md", ".github/workflows/ci.yml"]).ok).toBe(true);
  });

  it("fails when source changed without tests, naming the files", () => {
    const result = checkTestsWithCode(["src/a.ts", "src/b.tsx"]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("src/a.ts");
    expect(result.message).toContain("skip-tests-check");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/factory/tests-with-code.test.mjs`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement** — `scripts/factory/tests-with-code.mjs`

```js
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function isTestFile(path) {
  return /\.(test|spec)\.(ts|tsx|mjs)$/.test(path) || path.startsWith("e2e/");
}

export function isSourceFile(path) {
  return path.startsWith("src/") && !isTestFile(path);
}

export function checkTestsWithCode(files) {
  const source = files.filter(isSourceFile);
  const tests = files.filter(isTestFile);
  if (source.length === 0 || tests.length > 0) {
    return { ok: true, message: `ok: ${source.length} source file(s), ${tests.length} test file(s)` };
  }
  return {
    ok: false,
    message:
      `Source changed without any test changes:\n  ${source.join("\n  ")}\n` +
      `Add or update a test, or label the PR "skip-tests-check" if no test is meaningful.`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.SKIP === "true") {
    console.log("tests-with-code: skipped by label");
    process.exit(0);
  }
  const base = process.argv[2] ?? "origin/main";
  const files = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" }).split("\n").filter(Boolean);
  const result = checkTestsWithCode(files);
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}
```

If ESLint flags `process`/`console` as undefined in `.mjs` files, add to `eslint.config.mjs` a block: `{ files: ["scripts/**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly" } } }`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run scripts/factory/tests-with-code.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: CI workflow** — `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  checks:
    name: checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - name: Tests-with-code gate
        if: github.event_name == 'pull_request'
        env:
          SKIP: ${{ contains(github.event.pull_request.labels.*.name, 'skip-tests-check') }}
        run: node scripts/factory/tests-with-code.mjs origin/${{ github.base_ref }}
```

- [ ] **Step 6: Commit and push; confirm green**

```bash
git add -A
git commit -m "ci: lint, typecheck, unit tests, tests-with-code gate"
git push
gh run watch --exit-status
```
Expected: `CI` run succeeds.

---

### Task 9: E2E against previews + production health check

**Files:**
- Create: `.github/workflows/e2e.yml`

**Interfaces:**
- Consumes: Vercel `deployment_status` events; GitHub secret `E2E_PASSWORD` (same value as `APP_PASSWORD`).
- Produces: status check **`e2e`** on preview deployments; job **`prod-health`** that opens a `bug` issue if production `/api/health` fails.

- [ ] **Step 1: OWNER — add secret**

```bash
gh secret set E2E_PASSWORD
```
(paste the same value as `APP_PASSWORD` when prompted)

- [ ] **Step 2: Workflow** — `.github/workflows/e2e.yml`

```yaml
name: E2E
on: deployment_status
permissions:
  contents: read
  issues: write
jobs:
  e2e:
    name: e2e
    if: github.event.deployment_status.state == 'success' && github.event.deployment.environment != 'Production'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ github.event.deployment.sha }}
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
        env:
          CI: "true"
          BASE_URL: ${{ github.event.deployment_status.environment_url || github.event.deployment_status.target_url }}
          E2E_PASSWORD: ${{ secrets.E2E_PASSWORD }}
      - uses: actions/upload-artifact@v5
        if: failure()
        with:
          name: playwright-report-${{ github.run_id }}
          path: playwright-report/

  prod-health:
    name: prod-health
    if: github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'Production'
    runs-on: ubuntu-latest
    steps:
      - name: Check /api/health
        id: health
        env:
          URL: ${{ github.event.deployment_status.environment_url || github.event.deployment_status.target_url }}
        run: curl --fail --silent --show-error --retry 3 --retry-delay 10 "$URL/api/health"
      - name: Open issue on failure
        if: failure() && steps.health.outcome == 'failure'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh issue create --repo "${{ github.repository }}" --label bug \
            --title "Production health check failed (${{ github.event.deployment.sha }})" \
            --body "Post-deploy health check failed. Run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
```

- [ ] **Step 3: Prove it on a PR**

```bash
git checkout -b ci/e2e-workflow
git add .github/workflows/e2e.yml
git commit -m "ci: Playwright against Vercel previews, prod health check"
git push -u origin HEAD
gh pr create --fill
```
Wait for the Vercel preview, then: `gh pr checks --watch`
Expected: `checks` and `e2e` pass. Merge: `gh pr merge --squash --delete-branch`. After the production deploy, confirm `prod-health` passed: `gh run list --workflow E2E --limit 2`.

---

### Task 10: Security workflow

**Files:**
- Create: `.github/workflows/security.yml`

**Interfaces:**
- Produces: status checks **`codeql`**, **`npm-audit`**, **`gitleaks`**.

- [ ] **Step 1: Workflow** — `.github/workflows/security.yml`

```yaml
name: Security
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  codeql:
    name: codeql
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v6
      - uses: github/codeql-action/init@v4
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v4

  npm-audit:
    name: npm-audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm audit --omit=dev --audit-level=high

  gitleaks:
    name: gitleaks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Prove it on a PR**

```bash
git checkout main && git pull
git checkout -b ci/security
git add .github/workflows/security.yml
git commit -m "ci: CodeQL, npm audit, gitleaks"
git push -u origin HEAD
gh pr create --fill
gh pr checks --watch
```
Expected: `codeql`, `npm-audit`, `gitleaks` pass (fix any real high-severity audit finding by upgrading the package). Merge: `gh pr merge --squash --delete-branch`.

---

### Task 11: Branch protection

**Files:** none (repo settings via API)

**Interfaces:**
- Produces: `main` requires all gate checks; no direct pushes (admins included). From here on **all changes go through PRs**.

- [ ] **Step 1: Read the exact check names from the last PR**

```bash
gh pr checks $(gh pr list --state merged --limit 1 --json number -q '.[0].number')
```
Note the exact name of the Vercel check (e.g. `Vercel` or `Vercel – jobhunt2026`).

- [ ] **Step 2: Apply protection** (agent confirms with the owner before running — it changes repo settings). Replace `<VERCEL_CHECK>` with the exact name from Step 1.

```bash
gh api -X PUT "repos/{owner}/{repo}/branches/main/protection" --input - <<'EOF'
{
  "required_status_checks": {
    "strict": false,
    "contexts": ["checks", "e2e", "codeql", "npm-audit", "gitleaks", "<VERCEL_CHECK>"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

- [ ] **Step 3: Verify**

Run: `git checkout main && git pull && git commit --allow-empty -m "test: protection" && git push`
Expected: push **rejected** (protected branch). Then `git reset --hard origin/main`. **Phase 1 done.**

---

# Phase 2 — The worker

All Phase 2 work happens on branch `factory/worker` and lands via one PR that must pass the gates.

```bash
git checkout main && git pull && git checkout -b factory/worker
```

### Task 12: Thin CLAUDE.md, issue templates, TDD worker skill

**Files:**
- Create: `CLAUDE.md`, `.github/ISSUE_TEMPLATE/epic.yml`, `.github/ISSUE_TEMPLATE/task.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.claude/skills/implement-ticket/SKILL.md`

**Interfaces:**
- Produces: skill invocable as `/implement-ticket <issue>` and `/implement-ticket fix <pr>`; agent branches named `ai/issue-<n>-<slug>`; PR body sections `## What`, `## Acceptance criteria → tests`, `## Factory feedback`.

- [ ] **Step 1: `CLAUDE.md`**

```markdown
# Job Hunt

Single-user job-hunt app: Next.js 16 + Drizzle + Neon Postgres on Vercel. Built by an AI software factory (design: `docs/superpowers/specs/`).

- All work follows a skill in `.claude/skills/`. Read the relevant one before starting.
- Skills are the factory's source of truth and are expected to improve.
- If a skill was unclear, wrong, or missing something, say so in a "Factory feedback" section of your PR. Never silently work around it.
```

- [ ] **Step 2: Issue templates**

`.github/ISSUE_TEMPLATE/epic.yml`:

```yaml
name: Epic
description: A user-facing outcome. Add the ai-plan label when ready for planning.
title: "Epic: "
body:
  - type: textarea
    id: why
    attributes:
      label: Why
      description: What problem does this solve for me?
    validations:
      required: true
  - type: textarea
    id: done
    attributes:
      label: Done when
      description: Observable outcomes, one per line.
    validations:
      required: true
  - type: textarea
    id: out
    attributes:
      label: Out of scope
```

`.github/ISSUE_TEMPLATE/task.yml`:

```yaml
name: Task
description: One PR-sized change. Add the ai-build label to start the worker.
body:
  - type: textarea
    id: what
    attributes:
      label: What
      description: The change, as an outcome (not an implementation).
    validations:
      required: true
  - type: textarea
    id: criteria
    attributes:
      label: Acceptance criteria
      description: One per line. Each becomes at least one test.
    validations:
      required: true
  - type: textarea
    id: notes
    attributes:
      label: Notes
```

`.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: true
```

- [ ] **Step 3: The worker skill** — `.claude/skills/implement-ticket/SKILL.md`

````markdown
---
name: implement-ticket
description: Implement one GitHub issue with strict TDD and open a PR, or repair a failing PR. Invoked as `/implement-ticket <issue-number>` or `/implement-ticket fix <pr-number>`.
---

# Implement Ticket

You are the factory's worker. You run headless in GitHub Actions. Nobody will answer you in real time — when you need a human, write on GitHub and stop.

## Mode A — `/implement-ticket <issue>`

### 1. Understand
1. `gh issue view <issue> --comments`
2. If the issue links a spec in `docs/specs/`, read it. Read `docs/architecture.md` if it exists.
3. Read the code you will change and its existing tests.
4. If the ticket is ambiguous in a way that changes behavior, do not guess: `gh issue comment <issue> --body "<numbered questions>"` and stop.
5. Write down the acceptance criteria. If the issue has none, derive them and state them in the PR.

### 2. Branch
`git checkout -b ai/issue-<issue>-<short-kebab-slug>`

### 3. TDD — repeat for each acceptance criterion
- **RED** — write one test for the criterion.
  - Logic → unit test next to the code as `*.test.ts`, run with `npx vitest run <file>`.
  - User-visible flow → Playwright test in `e2e/`. These need a deployed preview, so locally only check `npx playwright test --list` compiles; CI runs them against the preview.
  - Prefer putting logic in pure functions so it can be unit-tested.
  - Run the unit test. It must **fail for the expected reason** (an assertion, not an import or syntax error). If it passes immediately, the test is wrong — fix the test.
  - Commit: `test: <criterion>`
- **GREEN** — write the minimal code to pass. Run the test; it passes. Commit: `feat: …` or `fix: …`
- **REFACTOR** — clean up with tests green. Commit `refactor: …` if anything changed.

Rules: no production code without a failing test first. Never delete, skip, or weaken an existing test to make something pass.

### 4. Verify
```
npm run lint && npm run typecheck && npm test
```
All must pass. If `src/db/schema.ts` changed: `npm run db:generate` and commit the new file in `drizzle/`.

### 5. Open the PR
```
git push -u origin HEAD
gh pr create --title "<issue title>" --body-file <file>
```
Body:
```
Closes #<issue>

## What
<1–3 sentences>

## Acceptance criteria → tests
| Criterion | Test |
|---|---|

## Factory feedback
<Where this skill, CLAUDE.md, or the ticket was unclear, wrong, or missing something. "None" if nothing.>
```

## Mode B — `/implement-ticket fix <pr>`
A gate failed on your PR.
1. `gh pr view <pr>` and `gh pr checks <pr>`.
2. Find the failure: `gh run list --branch <branch> --status failure --limit 5`, then `gh run view <run-id> --log-failed`. For `e2e`, read the Playwright output in the log.
3. Fix the root cause on the PR branch. Never disable a gate, skip a test, or weaken an assertion.
4. Run step 4 (Verify) locally, commit `fix: <gate> — <cause>`, push.
5. Edit the PR body's **Factory feedback** section: what went wrong and what in this skill would have prevented it.

## Never
- Push to `main` or merge PRs.
- Change `.github/workflows/` or `.claude/skills/` unless the issue has the `factory` label.
- Read, print, or change secrets or `.env*` files.
````

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "factory: thin CLAUDE.md, issue templates, TDD implement-ticket skill"
```

---

### Task 13: Run-record logging

**Files:**
- Create: `scripts/factory/pick-model.mjs`, `scripts/factory/pick-model.test.mjs`, `scripts/factory/run-record.mjs`, `scripts/factory/run-record.test.mjs`, `scripts/factory/record-run.sh`

**Interfaces:**
- Produces:
  - `MODELS = { haiku, sonnet, opus }`, `pickModel(labels: string[]): string`; CLI prints model for env `LABELS` (JSON array).
  - `parseExecutionLog(text: string): object[]` (accepts JSON array or JSONL)
  - `classifyOutcome(result: object, conclusion: string, { pr, mode }): "pr_opened" | "fixed" | "asked_human" | "turn_limit" | "failed"`
  - `buildRunRecord({ executionLog: object[], env: Record<string,string|undefined>, now: Date }): RunRecord`
  - CLI `node scripts/factory/run-record.mjs` prints one JSON line using env `EXECUTION_FILE, GITHUB_RUN_ID, SKILL, MODE, ISSUE, PR, MODEL, CONCLUSION, RETRY`.
  - `scripts/factory/record-run.sh` appends that line to `runs.jsonl` on branch `factory-log` and writes the job summary.

- [ ] **Step 1: Failing tests** — `scripts/factory/pick-model.test.mjs`

```js
import { describe, expect, it } from "vitest";
import { MODELS, pickModel } from "./pick-model.mjs";

describe("pickModel", () => {
  it("defaults to sonnet", () => {
    expect(pickModel(["ai-build"])).toBe(MODELS.sonnet);
  });
  it("honours model labels", () => {
    expect(pickModel(["ai-build", "model:haiku"])).toBe("claude-haiku-4-5-20251001");
    expect(pickModel(["model:opus"])).toBe("claude-opus-5-5");
  });
  it("prefers the strongest model when several labels are present", () => {
    expect(pickModel(["model:haiku", "model:opus"])).toBe(MODELS.opus);
  });
});
```

`scripts/factory/run-record.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import { buildRunRecord, classifyOutcome, parseExecutionLog } from "./run-record.mjs";

const result = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 23,
  duration_ms: 184_400,
  usage: { input_tokens: 120_000, output_tokens: 9_000 },
};

describe("parseExecutionLog", () => {
  it("parses a JSON array", () => {
    expect(parseExecutionLog(JSON.stringify([{ type: "system" }, result]))).toHaveLength(2);
  });
  it("parses JSONL", () => {
    expect(parseExecutionLog(`{"type":"system"}\n${JSON.stringify(result)}\n`)).toHaveLength(2);
  });
  it("returns [] for empty input", () => {
    expect(parseExecutionLog("")).toEqual([]);
  });
});

describe("classifyOutcome", () => {
  it("reports turn limit", () => {
    expect(classifyOutcome({ subtype: "error_max_turns" }, "failure", {})).toBe("turn_limit");
  });
  it("reports failure", () => {
    expect(classifyOutcome(result, "failure", {})).toBe("failed");
  });
  it("reports pr_opened in build mode with a PR", () => {
    expect(classifyOutcome(result, "success", { pr: 7, mode: "build" })).toBe("pr_opened");
  });
  it("reports fixed in fix mode", () => {
    expect(classifyOutcome(result, "success", { pr: 7, mode: "fix" })).toBe("fixed");
  });
  it("reports asked_human when it succeeded without a PR", () => {
    expect(classifyOutcome(result, "success", { pr: null, mode: "build" })).toBe("asked_human");
  });
});

describe("buildRunRecord", () => {
  it("builds a flat record from the last result message and env", () => {
    const record = buildRunRecord({
      executionLog: [{ type: "system" }, result],
      env: {
        GITHUB_RUN_ID: "999",
        SKILL: "implement-ticket",
        MODE: "build",
        ISSUE: "12",
        PR: "14",
        MODEL: "claude-sonnet-5-5",
        CONCLUSION: "success",
        RETRY: "",
      },
      now: new Date("2026-10-08T10:00:00Z"),
    });
    expect(record).toEqual({
      run_id: "999",
      timestamp: "2026-10-08T10:00:00.000Z",
      skill: "implement-ticket",
      mode: "build",
      issue: 12,
      pr: 14,
      model: "claude-sonnet-5-5",
      turns: 23,
      duration_s: 184,
      input_tokens: 120000,
      output_tokens: 9000,
      outcome: "pr_opened",
      retries: 0,
    });
  });

  it("tolerates a missing result message", () => {
    const record = buildRunRecord({ executionLog: [], env: { CONCLUSION: "failure" }, now: new Date(0) });
    expect(record.turns).toBeNull();
    expect(record.outcome).toBe("failed");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run scripts/factory`
Expected: the two new files FAIL — cannot resolve modules.

- [ ] **Step 3: Implement**

`scripts/factory/pick-model.mjs`:

```js
import { fileURLToPath } from "node:url";

export const MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5-5",
  opus: "claude-opus-5-5",
};

export function pickModel(labels) {
  for (const tier of ["opus", "sonnet", "haiku"]) {
    if (labels.includes(`model:${tier}`)) return MODELS[tier];
  }
  return MODELS.sonnet;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(pickModel(JSON.parse(process.env.LABELS ?? "[]")));
}
```

`scripts/factory/run-record.mjs`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function parseExecutionLog(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  }
}

export function classifyOutcome(result, conclusion, { pr, mode } = {}) {
  if (result?.subtype === "error_max_turns") return "turn_limit";
  if (conclusion !== "success" || result?.is_error) return "failed";
  if (!pr) return "asked_human";
  return mode === "fix" ? "fixed" : "pr_opened";
}

const toInt = (v) => (v === undefined || v === null || v === "" ? null : Number.parseInt(v, 10));

export function buildRunRecord({ executionLog, env, now }) {
  const result = [...executionLog].reverse().find((m) => m?.type === "result") ?? {};
  const pr = toInt(env.PR);
  const mode = env.MODE ?? "build";
  return {
    run_id: env.GITHUB_RUN_ID ?? null,
    timestamp: now.toISOString(),
    skill: env.SKILL ?? null,
    mode,
    issue: toInt(env.ISSUE),
    pr,
    model: env.MODEL ?? null,
    turns: result.num_turns ?? null,
    duration_s: result.duration_ms != null ? Math.round(result.duration_ms / 1000) : null,
    input_tokens: result.usage?.input_tokens ?? null,
    output_tokens: result.usage?.output_tokens ?? null,
    outcome: classifyOutcome(result, env.CONCLUSION, { pr, mode }),
    retries: toInt(env.RETRY) ?? 0,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let text = "";
  try {
    text = process.env.EXECUTION_FILE ? readFileSync(process.env.EXECUTION_FILE, "utf8") : "";
  } catch {
    text = "";
  }
  console.log(JSON.stringify(buildRunRecord({ executionLog: parseExecutionLog(text), env: process.env, now: new Date() })));
}
```

`scripts/factory/record-run.sh`:

```bash
#!/usr/bin/env bash
# Append one run record to runs.jsonl on the factory-log branch and write a job summary.
set -euo pipefail

record="$(node scripts/factory/run-record.mjs)"

git config user.name "factory-bot"
git config user.email "factory-bot@users.noreply.github.com"

logdir="$(mktemp -d)"
if git ls-remote --exit-code --heads origin factory-log >/dev/null 2>&1; then
  git fetch --quiet origin factory-log
  git worktree add --quiet "$logdir" origin/factory-log
  git -C "$logdir" checkout --quiet -B factory-log
else
  git worktree add --quiet --detach "$logdir"
  git -C "$logdir" checkout --quiet --orphan factory-log
  git -C "$logdir" rm -rf --quiet .
fi

echo "$record" >> "$logdir/runs.jsonl"
git -C "$logdir" add runs.jsonl
git -C "$logdir" commit --quiet -m "run ${GITHUB_RUN_ID:-local}: ${SKILL:-unknown} #${ISSUE:-?}"
git -C "$logdir" push --quiet origin factory-log

{
  echo "### Factory run"
  echo '```json'
  echo "$record"
  echo '```'
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
```

```bash
chmod +x scripts/factory/record-run.sh
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run scripts/factory`
Expected: PASS (all tests in 3 files).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "factory: run records (model picker, execution log parser, factory-log writer)"
```

---

### Task 14: Worker workflow (`ai-build` label)

**Files:**
- Create: `.github/workflows/factory-build.yml`

**Interfaces:**
- Consumes: `/implement-ticket` (Task 12); `pick-model.mjs`, `record-run.sh` (Task 13); secrets `CLAUDE_CODE_OAUTH_TOKEN`, `FACTORY_GH_TOKEN` (Task 16).
- Produces: label `ai-build` on an issue → agent PR on branch `ai/issue-<n>-*`; run record; transcript artifact `transcript-<run_id>`.

- [ ] **Step 1: Workflow** — `.github/workflows/factory-build.yml`

```yaml
name: Factory · build
on:
  issues:
    types: [labeled]
concurrency:
  group: factory-agent
  cancel-in-progress: false
permissions:
  contents: write
  pull-requests: write
  issues: write
  id-token: write
  actions: read
jobs:
  build:
    if: github.event.label.name == 'ai-build'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      GH_TOKEN: ${{ secrets.FACTORY_GH_TOKEN }}
      ISSUE: ${{ github.event.issue.number }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ secrets.FACTORY_GH_TOKEN }}
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - id: model
        env:
          LABELS: ${{ toJson(github.event.issue.labels.*.name) }}
        run: echo "model=$(node scripts/factory/pick-model.mjs)" >> "$GITHUB_OUTPUT"
      - id: claude
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github_token: ${{ secrets.FACTORY_GH_TOKEN }}
          prompt: "/implement-ticket ${{ github.event.issue.number }}"
          claude_args: >-
            --model ${{ steps.model.outputs.model }}
            --max-turns 80
            --allowedTools "Bash,Read,Edit,Write,Glob,Grep"
      - name: Find PR
        id: pr
        if: always()
        run: |
          pr=$(gh pr list --state all --json number,headRefName \
            -q "map(select(.headRefName | startswith(\"ai/issue-$ISSUE-\"))) | .[0].number // empty")
          echo "number=$pr" >> "$GITHUB_OUTPUT"
      - name: Record run
        if: always()
        env:
          EXECUTION_FILE: ${{ steps.claude.outputs.execution_file }}
          CONCLUSION: ${{ steps.claude.outputs.conclusion }}
          SKILL: implement-ticket
          MODE: build
          MODEL: ${{ steps.model.outputs.model }}
          PR: ${{ steps.pr.outputs.number }}
        run: bash scripts/factory/record-run.sh
      - uses: actions/upload-artifact@v5
        if: always()
        with:
          name: transcript-${{ github.run_id }}
          path: ${{ steps.claude.outputs.execution_file }}
          if-no-files-found: ignore
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "factory: ai-build label runs the TDD worker"
```

---

### Task 15: Fix-loop workflow

**Files:**
- Create: `.github/workflows/factory-fix.yml`

**Interfaces:**
- Consumes: failed runs of workflows `CI`, `E2E`, `Security` on an open PR whose branch starts with `ai/`.
- Produces: up to 2 automatic `/implement-ticket fix <pr>` runs (labels `fix-attempt-1`, `fix-attempt-2`); then label `needs-human` + PR comment. Run records with `MODE=fix`, `RETRY=<attempt>`.

- [ ] **Step 1: Workflow** — `.github/workflows/factory-fix.yml`

```yaml
name: Factory · fix
on:
  workflow_run:
    workflows: [CI, E2E, Security]
    types: [completed]
concurrency:
  group: factory-agent
  cancel-in-progress: false
permissions:
  contents: write
  pull-requests: write
  issues: write
  id-token: write
  actions: read
jobs:
  fix:
    if: github.event.workflow_run.conclusion == 'failure'
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      GH_TOKEN: ${{ secrets.FACTORY_GH_TOKEN }}
      SHA: ${{ github.event.workflow_run.head_sha }}
      FAILED_RUN: ${{ github.event.workflow_run.html_url }}
    steps:
      - name: Locate agent PR for this commit
        id: pr
        run: |
          pr=$(gh pr list --repo "${{ github.repository }}" --state open --search "$SHA" \
            --json number,headRefName,headRefOid,labels \
            -q 'map(select(.headRefName | startswith("ai/"))) | .[0] // empty')
          if [ -z "$pr" ]; then echo "skip=true" >> "$GITHUB_OUTPUT"; exit 0; fi
          if [ "$(jq -r .headRefOid <<<"$pr")" != "$SHA" ]; then echo "skip=true" >> "$GITHUB_OUTPUT"; exit 0; fi
          echo "skip=false" >> "$GITHUB_OUTPUT"
          echo "number=$(jq -r .number <<<"$pr")" >> "$GITHUB_OUTPUT"
          echo "branch=$(jq -r .headRefName <<<"$pr")" >> "$GITHUB_OUTPUT"
          echo "attempts=$(jq '[.labels[].name | select(startswith("fix-attempt-"))] | length' <<<"$pr")" >> "$GITHUB_OUTPUT"
      - name: Give up and ask a human
        if: steps.pr.outputs.skip == 'false' && steps.pr.outputs.attempts >= 2
        run: |
          gh pr edit "${{ steps.pr.outputs.number }}" --repo "${{ github.repository }}" --add-label needs-human
          gh pr comment "${{ steps.pr.outputs.number }}" --repo "${{ github.repository }}" \
            --body "Gates still failing after 2 automatic fix attempts — needs a human look. Failed run: $FAILED_RUN"
      - name: Mark attempt
        id: attempt
        if: steps.pr.outputs.skip == 'false' && steps.pr.outputs.attempts < 2
        run: |
          n=$(( ${{ steps.pr.outputs.attempts }} + 1 ))
          gh pr edit "${{ steps.pr.outputs.number }}" --repo "${{ github.repository }}" --add-label "fix-attempt-$n"
          echo "n=$n" >> "$GITHUB_OUTPUT"
      - uses: actions/checkout@v6
        if: steps.attempt.outcome == 'success'
        with:
          ref: ${{ steps.pr.outputs.branch }}
          fetch-depth: 0
          token: ${{ secrets.FACTORY_GH_TOKEN }}
      - uses: actions/setup-node@v5
        if: steps.attempt.outcome == 'success'
        with:
          node-version: 22
          cache: npm
      - if: steps.attempt.outcome == 'success'
        run: npm ci
      - id: claude
        if: steps.attempt.outcome == 'success'
        uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github_token: ${{ secrets.FACTORY_GH_TOKEN }}
          prompt: "/implement-ticket fix ${{ steps.pr.outputs.number }}"
          claude_args: >-
            --model claude-sonnet-5-5
            --max-turns 40
            --allowedTools "Bash,Read,Edit,Write,Glob,Grep"
      - name: Record run
        if: always() && steps.attempt.outcome == 'success'
        env:
          EXECUTION_FILE: ${{ steps.claude.outputs.execution_file }}
          CONCLUSION: ${{ steps.claude.outputs.conclusion }}
          SKILL: implement-ticket
          MODE: fix
          MODEL: claude-sonnet-5-5
          PR: ${{ steps.pr.outputs.number }}
          RETRY: ${{ steps.attempt.outputs.n }}
        run: bash scripts/factory/record-run.sh
      - uses: actions/upload-artifact@v5
        if: always() && steps.attempt.outcome == 'success'
        with:
          name: transcript-${{ github.run_id }}
          path: ${{ steps.claude.outputs.execution_file }}
          if-no-files-found: ignore
```

- [ ] **Step 2: Commit and open the Phase 2 PR**

```bash
git add -A
git commit -m "factory: fix loop on failed gates (max 2 attempts)"
git push -u origin HEAD
gh pr create --title "Factory: TDD worker, run logging, fix loop" --body "Phase 2 of docs/superpowers/plans/2026-10-08-factory-phases-0-2.md"
gh pr checks --watch
```
Expected: all required checks pass (no `src/` changes, so tests-with-code passes). **OWNER merges** the PR.

---

### Task 16: Secrets, labels, and the smoke ticket (OWNER + agent)

**Files:** none

**Interfaces:**
- Produces: secrets `CLAUDE_CODE_OAUTH_TOKEN`, `FACTORY_GH_TOKEN`; labels `ai-build`, `ai-plan`, `factory`, `factory-report`, `proposed`, `model:haiku`, `model:sonnet`, `model:opus`, `skip-tests-check`, `fix-attempt-1`, `fix-attempt-2`, `needs-human`; one ticket shipped end-to-end.

- [ ] **Step 1: OWNER — subscription token**

In a terminal: `claude setup-token`, then `gh secret set CLAUDE_CODE_OAUTH_TOKEN` and paste it.

- [ ] **Step 2: OWNER — factory GitHub token** (PRs made with the default Actions token don't trigger CI; this token makes agent PRs run the gates)

github.com → Settings → Developer settings → **Fine-grained tokens** → Generate: repository access **only `jobhunt2026`**; permissions **Contents, Issues, Pull requests, Workflows: Read and write**; **Actions, Checks: Read**. Then `gh secret set FACTORY_GH_TOKEN` and paste it.

- [ ] **Step 3: Create labels**

```bash
for l in ai-build ai-plan factory factory-report proposed model:haiku model:sonnet model:opus skip-tests-check fix-attempt-1 fix-attempt-2 needs-human; do
  gh label create "$l" --force
done
```

- [ ] **Step 4: Smoke ticket** (agent confirms with the owner before creating the issue)

```bash
gh issue create --title "Show how many applications I have" --body "$(cat <<'EOF'
### What
Above the applications list, show the total number of applications.

### Acceptance criteria
- With no applications, it reads "0 applications".
- With one application, it reads "1 application".
- With several, it reads "N applications".
EOF
)" --label model:haiku
```

Then **OWNER** adds the `ai-build` label in the GitHub UI (the approval event).

- [ ] **Step 5: Verify end-to-end**

```bash
gh run watch --exit-status $(gh run list --workflow "Factory · build" --limit 1 --json databaseId -q '.[0].databaseId')
gh pr list --search "head:ai/issue-"
gh pr checks <pr> --watch
git fetch origin factory-log && git show origin/factory-log:runs.jsonl | tail -1
```
Expected: a PR on `ai/issue-<n>-*` with `test:` commits before `feat:` commits; all gates green (or the fix loop repairs them); `runs.jsonl` has a record with `"outcome":"pr_opened"`. **OWNER** opens the preview URL, checks the count, merges. Production shows the count. **Phase 2 done: the factory shipped its first ticket.**
