# Job Hunt

A single-user job-hunt tracker, built and maintained by an AI software factory
(tickets in, reviewed PRs out). Design: [docs/superpowers/specs/2026-10-07-jobhunt-factory-design.md](docs/superpowers/specs/2026-10-07-jobhunt-factory-design.md).

## Stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Drizzle ORM on Neon Postgres, pino logging, Vitest, Playwright, deployed on Vercel.

## Commands

```
npm run dev        # start the dev server
npm test           # unit tests (Vitest)
npm run lint       # ESLint
npm run typecheck  # next typegen + tsc
```

## Environment

| Variable | Purpose |
| --- | --- |
| `APP_PASSWORD` | Password for the single-user login |
| `SESSION_SECRET` | Secret used to sign the session cookie |
| `DATABASE_URL` | Neon Postgres connection string |
| `LOG_LEVEL` | pino log level (default `info`) |
