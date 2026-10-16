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
  redirect("/");
}
