# Application status tracking

## Goal
Give each application a status (Applied, Screening, Interview, Offer, Rejected, Withdrawn) and a last-changed date. The user can change status inline on the list page and filter the list by status, including an "Active" view.

## Scope
In: status column and last-changed timestamp, validated status changes, status controls and display on the list, status filter. Out: reminders, notes, status history, sorting by status, multiple users.

## Decisions
- `applications.status` is `text NOT NULL DEFAULT 'applied'`; `status_changed_at` is `timestamptz NOT NULL DEFAULT now()`. The migration backfills `status_changed_at` from `created_at` for existing rows, which keep all details and show as Applied. Adding columns with defaults is backward-compatible with the old code during deploy.
- The allowed statuses live in one constant list in `src/features/applications/status.ts`, shared by the zod validation, UI and filter. The server action validates every request, so an invalid status is never saved, whatever the client sends. A CHECK constraint is not used; the validation layer is the guard.
- Status changes use a server action; the list page does not navigate. `status_changed_at` only updates when the status really changes.
- Filter state lives in the URL (`?status=<value>`, or `?status=active`) read from the page's `searchParams` (a Promise in Next 16). Unknown filter values fall back to all applications.
- The filter child depends on the UI child because both edit `src/app/page.tsx`.

## Risks
- Drizzle migration must be generated with `npm run db:generate` and the backfill `UPDATE` added by hand to the SQL.
- E2E tests share one database; use unique company names.

```factory-plan
{
  "epic": 18,
  "children": [
    {"id": "status-data", "title": "Add application status columns, validation and repository functions", "model": "sonnet", "depends_on": []},
    {"id": "status-list-ui", "title": "Show and change application status from the list page", "model": "sonnet", "depends_on": ["status-data"]},
    {"id": "status-filter", "title": "Filter the list by status with an Active view", "model": "sonnet", "depends_on": ["status-list-ui"]}
  ]
}
```

## Child: status-data
Model: sonnet (schema, migration and validation; standard work).

Add the data layer only; no UI changes.

### Acceptance criteria and tests
- Statuses are exactly Applied, Screening, Interview, Offer, Rejected, Withdrawn (stored as lowercase values), exported from `src/features/applications/status.ts` with labels and an `ACTIVE_STATUSES` list that excludes Rejected and Withdrawn. Test: `src/features/applications/status.test.ts`.
- The status validator accepts every valid status and rejects anything else (empty, unknown, wrong case, missing). Test: `src/features/applications/status.test.ts`.
- `applications` gains `status` (default `applied`) and `status_changed_at` (default now), via a generated migration in `drizzle/`. Existing rows get status `applied` and `status_changed_at` equal to `created_at`. Test: `src/features/applications/status-migration.test.ts` reads the new migration SQL and asserts it adds both columns with defaults, backfills from `created_at`, and has no DROP or destructive statement.
- New applications start as Applied. Test: `src/features/applications/validation.test.ts` still passes unchanged, and a schema test asserts the column default.
- Repository exposes `updateApplicationStatus(id, status)` (sets `status_changed_at` only when the status changes) and `listApplications({ statuses? })` filtering by a list of statuses. Test: `src/features/applications/status-query.test.ts` unit-tests a pure helper that builds the filter and change decision; DB calls themselves are covered by the e2e in the later children.

## Child: status-list-ui
Model: sonnet (server action plus list UI, standard work).

### Acceptance criteria and tests
- The list shows each application's status label and the date its status last changed (YYYY-MM-DD). Test: e2e `e2e/status.spec.ts`, a newly added application shows "Applied" and today's date. Formatting is a pure function tested in `src/features/applications/status-display.test.ts`.
- A status control per row lets the user change the status without leaving the page. Test: e2e `e2e/status.spec.ts`, change to "Interview", see it in the row.
- The change survives a reload. Test: e2e `e2e/status.spec.ts`, reload and assert the status.
- A server action `changeStatus` requires a session, validates the id and the status with the shared validator, and rejects invalid values without writing. Test: `src/features/applications/status-action.test.ts` calls the parse step with invalid inputs (unknown, empty, non-numeric id) and expects failure.
- Existing applications keep their details and show as Applied. Test: covered by the data migration test in `status-data`; this child's e2e asserts the row still shows company and role.

## Child: status-filter
Model: sonnet (URL-driven filter on the list page).

### Acceptance criteria and tests
- A filter control offers All, Active, and each single status; the choice is stored in `?status=`. Test: e2e `e2e/status.spec.ts`, pick a status and assert the URL and the list.
- Filtering by one status shows only applications with that status. Test: e2e `e2e/status.spec.ts`, change one application to Interview, filter Interview, see it, filter Screening, do not see it.
- "Active" hides Rejected and Withdrawn. Test: e2e `e2e/status.spec.ts` (reject one application, it disappears from Active), plus `src/features/applications/status-filter.test.ts` for the pure parse of the query value.
- Unknown `status` query values show all applications. Test: `src/features/applications/status-filter.test.ts`.
- The application count label reflects the filtered list. Test: existing `src/features/applications/count.test.ts` plus an e2e assertion.
- The browser test covers changing a status and filtering by it end to end. Test: `e2e/status.spec.ts`.
