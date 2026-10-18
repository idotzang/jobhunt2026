"use server";
import { revalidatePath } from "next/cache";
import { getRequestLogger } from "@/lib/request-logger";
import { requireSession } from "@/lib/session";
import { createApplication } from "./repository";
import { parseNewApplication } from "./validation";

export type AddApplicationState = { added?: string; error?: string } | null;

export async function addApplication(_prev: AddApplicationState, formData: FormData): Promise<AddApplicationState> {
  await requireSession();
  const log = await getRequestLogger();
  const parsed = parseNewApplication(formData);

  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues.map((i) => i.path.join(".")) }, "invalid application");
    return { error: parsed.error.issues[0].message };
  }

  await createApplication(parsed.data);
  log.info({ company: parsed.data.company }, "application created");
  revalidatePath("/");
  return { added: parsed.data.company };
}
