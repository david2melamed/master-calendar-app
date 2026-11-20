import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { activityLog, syncErrors } from "@/lib/db/schema";
import { log } from "@/lib/log";

/** Record (or bump) an open error for a source. Errors are never silent. */
export async function recordError(source: string, message: string) {
  log.error("source error", { source, message });
  const db = await getDb();
  const open = await db
    .select({ id: syncErrors.id })
    .from(syncErrors)
    .where(and(eq(syncErrors.source, source), isNull(syncErrors.resolvedAt)))
    .limit(1);
  if (open[0]) {
    await db
      .update(syncErrors)
      .set({ message, count: sql`${syncErrors.count} + 1`, lastSeenAt: new Date() })
      .where(eq(syncErrors.id, open[0].id));
  } else {
    await db.insert(syncErrors).values({ source, message });
  }
}

/** Mark a source healthy again. */
export async function resolveErrors(source: string) {
  const db = await getDb();
  await db
    .update(syncErrors)
    .set({ resolvedAt: new Date() })
    .where(and(eq(syncErrors.source, source), isNull(syncErrors.resolvedAt)));
}

export async function logActivity(kind: string, message: string, meta?: Record<string, unknown>) {
  const db = await getDb();
  await db.insert(activityLog).values({ kind, message, meta });
}

export async function recentActivity(limit = 20) {
  const db = await getDb();
  return db.select().from(activityLog).orderBy(desc(activityLog.at)).limit(limit);
}

export async function openErrors() {
  const db = await getDb();
  return db
    .select()
    .from(syncErrors)
    .where(isNull(syncErrors.resolvedAt))
    .orderBy(desc(syncErrors.lastSeenAt));
}
