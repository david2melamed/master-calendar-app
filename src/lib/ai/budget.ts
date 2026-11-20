import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { aiUsage } from "@/lib/db/schema";
import { fmtET } from "@/lib/time";

/**
 * Monthly AI spending rules (your limits, enforced in code):
 *  - Sonnet (only for "possible event" emails) stops at $0.50 for the month.
 *  - At $1.50 total → Haiku only.
 *  - At $2.00 total → AI pauses (you get one email). Everything else keeps working.
 */
export const HAIKU = "claude-haiku-5-5";
export const SONNET = "claude-sonnet-5-5";

export const CAPS = { sonnet: 0.5, haikuOnly: 1.5, pause: 2.0 } as const;

/** $ per million tokens [input, output]. Unknown models (e.g. a fallback) are priced high, to be safe. */
const PRICES: Record<string, [number, number]> = {
  [HAIKU]: [0.1, 0.5],
  [SONNET]: [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-opus-5-5": [4, 20],
  "claude-opus-4-8": [5, 25],
};
const UNKNOWN_PRICE: [number, number] = [5, 25];

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const [i, o] = PRICES[model] ?? UNKNOWN_PRICE;
  return (inputTokens * i + outputTokens * o) / 1_000_000;
}

export const monthKey = (d = new Date()) => fmtET(d, "yyyy-MM");

export type Spend = { total: number; sonnet: number; haiku: number; calls: number };

export async function monthSpend(month = monthKey()): Promise<Spend> {
  const db = await getDb();
  const rows = await db
    .select({
      model: aiUsage.model,
      cost: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)`,
      calls: sql<number>`count(*)`,
    })
    .from(aiUsage)
    .where(eq(aiUsage.month, month))
    .groupBy(aiUsage.model);
  const s: Spend = { total: 0, sonnet: 0, haiku: 0, calls: 0 };
  for (const r of rows) {
    const c = Number(r.cost);
    s.total += c;
    s.calls += Number(r.calls);
    if (r.model === HAIKU) s.haiku += c;
    else s.sonnet += c; // Sonnet and any fallback model count against the Sonnet cap
  }
  return s;
}

export type AiMode = "normal" | "haiku_only" | "paused";

export function modeFor(s: Spend): AiMode {
  if (s.total >= CAPS.pause) return "paused";
  if (s.total >= CAPS.haikuOnly) return "haiku_only";
  return "normal";
}

export function sonnetAllowed(s: Spend): boolean {
  return modeFor(s) === "normal" && s.sonnet < CAPS.sonnet;
}

export async function recordUsage(model: string, inputTokens: number, outputTokens: number, purpose: string) {
  const db = await getDb();
  const costUsd = costOf(model, inputTokens, outputTokens);
  await db.insert(aiUsage).values({ month: monthKey(), model, inputTokens, outputTokens, costUsd, purpose });
  return costUsd;
}
