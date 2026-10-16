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
