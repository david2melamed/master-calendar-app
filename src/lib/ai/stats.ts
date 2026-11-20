import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { events, processedMessages, senderRules } from "@/lib/db/schema";
import { etWallTime, fmtET } from "@/lib/time";
import { CAPS, modeFor, monthSpend, type AiMode, type Spend } from "./budget";

export type AiStats = {
  spend: Spend;
  mode: AiMode;
  caps: typeof CAPS;
  emails: { checked: number; skipped: number; waiting: number; errors: number };
  added: number;
  ignoredSenders: string[];
};

/** Numbers for the Settings page: this month (Eastern Time). */
export async function aiStats(): Promise<AiStats> {
  const db = await getDb();
  const monthStart = etWallTime(`${fmtET(new Date(), "yyyy-MM")}-01`);
  const [spend, byStatus, added, rules] = await Promise.all([
    monthSpend(),
    db
      .select({ status: processedMessages.status, n: sql<number>`count(*)` })
      .from(processedMessages)
      .where(gte(processedMessages.createdAt, monthStart))
      .groupBy(processedMessages.status),
    db
      .select({ n: sql<number>`count(*)` })
      .from(events)
      .where(and(eq(events.source, "ai"), gte(events.createdAt, monthStart))),
    db.select().from(senderRules).where(eq(senderRules.rule, "deny")),
  ]);
  const c = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)]));
  return {
    spend,
    mode: modeFor(spend),
    caps: CAPS,
    emails: {
      checked: c.done ?? 0,
      skipped: c.skipped ?? 0,
      waiting: (c.pending ?? 0) + (c.processing ?? 0),
      errors: c.error ?? 0,
    },
    added: Number(added[0]?.n ?? 0),
    ignoredSenders: rules.map((r) => r.pattern),
  };
}
