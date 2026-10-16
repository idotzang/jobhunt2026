import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: "ok", db: "ok" });
  } catch (err) {
    logger.error({ err }, "health check failed");
    return Response.json({ status: "error", db: "error" }, { status: 503 });
  }
}
