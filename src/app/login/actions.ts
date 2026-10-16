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
