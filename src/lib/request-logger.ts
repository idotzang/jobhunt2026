import "server-only";
import { headers } from "next/headers";
import { REQUEST_ID_HEADER, requestLogger } from "./logger";

export async function getRequestLogger() {
  const h = await headers();
  return requestLogger(h.get(REQUEST_ID_HEADER) ?? "unknown");
}
