import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobRuns } from "@/lib/db/schema";
import { log } from "@/lib/log";

/**
 * Run a job at most once per key (e.g. "rollover:2026-11-20").
 * - Already "done" → skipped (safe to call as often as you like).
 * - "running" for less than `staleAfterMs` → skipped (another call is on it).
 * - Failed, or stuck "running" too long → tried again.
 */
export async function runOnce<T>(
  key: string,
  fn: () => Promise<T>,
  { staleAfterMs = 10 * 60_000 }: { staleAfterMs?: number } = {},
): Promise<{ ran: boolean; result?: T; reason?: string }> {
  const db = await getDb();
  // Claim the key atomically: insert, or take over a failed / stale run.
  const claimed = await db
    .insert(jobRuns)
    .values({ key, status: "running" })
    .onConflictDoUpdate({
      target: jobRuns.key,
      set: { status: "running", startedAt: new Date(), finishedAt: null, detail: null },
      // ISO string + cast: postgres.js can't send a raw Date inside a sql`` fragment.
      setWhere: sql`${jobRuns.status} = 'failed' OR (${jobRuns.status} = 'running' AND ${jobRuns.startedAt} < ${new Date(Date.now() - staleAfterMs).toISOString()}::timestamptz)`,
    })
    .returning({ key: jobRuns.key });
  if (!claimed.length) return { ran: false, reason: "already done or in progress" };

  try {
    const result = await fn();
    await db
      .update(jobRuns)
      .set({ status: "done", finishedAt: new Date(), detail: summarize(result) })
      .where(eq(jobRuns.key, key));
    return { ran: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("job failed", { key, msg });
    await db.update(jobRuns).set({ status: "failed", finishedAt: new Date(), detail: msg.slice(0, 500) }).where(eq(jobRuns.key, key));
    throw e;
  }
}

function summarize(v: unknown): string | null {
  if (v === undefined) return null;
  try {
    return JSON.stringify(v).slice(0, 500);
  } catch {
    return null;
  }
}

/** Retry with exponential backoff + jitter (for flaky network calls). */
export async function withRetry<T>(fn: () => Promise<T>, { tries = 3, baseMs = 500 } = {}): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const status = (e as { code?: number; status?: number })?.code ?? (e as { status?: number })?.status;
      // Don't retry errors that won't fix themselves (bad request, auth, not found).
      if (status && [400, 401, 403, 404, 410].includes(Number(status))) break;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i * (0.75 + Math.random() / 2)));
    }
  }
  throw last;
}
