# Architecture

- **App:** Next.js App Router in `src/app`; features in `src/features/<name>` (validation, repository, actions); DB schema in `src/db`.
- **Data:** Neon Postgres via Drizzle; migrations in `drizzle/`, applied at build (`vercel-build`).
- **Auth:** single password; `src/proxy.ts` gates routes, `src/lib/auth.ts` holds the logic.
- **Tables:** `applications` (company, role, link, applied_on).
- **Factory:** see `docs/superpowers/specs/2026-10-07-jobhunt-factory-design.md`. If the worker asks a question on an issue, answer in a comment, then remove and re-add `ai-build` to re-run it.
