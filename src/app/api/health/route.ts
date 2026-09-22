import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

// Public on purpose (uptime monitoring): the only route without requireUser. Returns no data.
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: "up", time: new Date().toISOString() }, { headers });
  } catch (error) {
    logger.error("health.db_down", error);
    return Response.json({ ok: false, db: "down" }, { status: 503, headers });
  }
}
