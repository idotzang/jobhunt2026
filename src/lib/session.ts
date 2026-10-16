import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, authConfigFromEnv, isValidSession } from "./auth";

export async function requireSession(): Promise<void> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(cookie, authConfigFromEnv()))) redirect("/login");
}
