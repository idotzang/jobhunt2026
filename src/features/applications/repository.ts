import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { applications, type Application } from "@/db/schema";
import { normalizeStatusFilter, statusChanged } from "./status-query";
import type { Status } from "./status";
import type { NewApplication } from "./validation";

export async function listApplications(options: { statuses?: readonly Status[] } = {}): Promise<Application[]> {
  const statuses = normalizeStatusFilter(options.statuses);
  return getDb()
    .select()
    .from(applications)
    .where(statuses ? inArray(applications.status, statuses) : undefined)
    .orderBy(desc(applications.appliedOn), desc(applications.id));
}

export async function createApplication(input: NewApplication): Promise<void> {
  await getDb().insert(applications).values(input);
}

export async function updateApplicationStatus(id: number, status: Status): Promise<void> {
  const db = getDb();
  const [current] = await db.select({ status: applications.status }).from(applications).where(eq(applications.id, id));
  if (!current || !statusChanged(current.status as Status, status)) return;
  await db.update(applications).set({ status, statusChangedAt: new Date() }).where(eq(applications.id, id));
}
