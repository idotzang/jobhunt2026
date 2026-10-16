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

const PUBLIC_PATHS = ["/login", "/api/health"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
