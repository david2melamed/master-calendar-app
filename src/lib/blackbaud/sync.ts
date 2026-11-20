import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { events, syncState } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { withRetry } from "@/lib/jobs/runner";
import { log } from "@/lib/log";
import { logActivity, recordError, resolveErrors } from "@/lib/status";
import { parseBlackbaudIcs, type BlackbaudItem } from "./parse";

type EventInsert = typeof events.$inferInsert;

export type BlackbaudState = {
  etag?: string | null;
  lastModified?: string | null;
  hash?: string;
  lastCheckedAt?: string;
  lastChangedAt?: string;
  count?: number;
};

export type BlackbaudResult =
  | { status: "not_configured" }
  | { status: "unchanged"; count: number }
  | { status: "updated"; count: number; added: number; changed: number; removed: number };

const STATE_KEY = "blackbaud";
const ERROR_SOURCE = "blackbaud";
const MAX_BYTES = 5 * 1024 * 1024;

/** Error messages must never contain the feed URL (it works like a password). */
class FeedError extends Error {}

/**
 * Check the Blackbaud feed and bring our copy up to date.
 *  - Sends ETag / If-Modified-Since, so an unchanged feed costs almost nothing.
 *  - New items are added, changed ones updated, items gone from the feed removed
 *    (only within the date range the feed still covers, so old assignments
 *    that simply aged out of the feed are kept).
 *  - If the feed suddenly comes back empty, nothing is deleted (safety net).
 */
export async function syncBlackbaud({ force = false }: { force?: boolean } = {}): Promise<BlackbaudResult> {
  const url = env().BLACKBAUD_ICS_URL;
  if (!url) return { status: "not_configured" };
  try {
    const result = await doSync(url, force);
    await resolveErrors(ERROR_SOURCE);
    return result;
  } catch (e) {
    const msg = e instanceof FeedError ? e.message : "Couldn't reach the Blackbaud feed (network error).";
    await recordError(ERROR_SOURCE, msg);
    throw new Error(msg);
  }
}

async function doSync(rawUrl: string, force: boolean): Promise<BlackbaudResult> {
  const db = await getDb();
  const state = await getBlackbaudState();
  const now = new Date().toISOString();

  const url = rawUrl.replace(/^webcal(s?):\/\//i, "https://");
  const headers: Record<string, string> = { "User-Agent": "MasterCalendar/1.0", Accept: "text/calendar, */*" };
  if (!force && state.etag) headers["If-None-Match"] = state.etag;
  if (!force && state.lastModified) headers["If-Modified-Since"] = state.lastModified;

  const res = await withRetry(
    async () => {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000), cache: "no-store", redirect: "follow" });
      // Retry server hiccups; give up immediately on 4xx (e.g. the link was reset).
      if (r.status >= 500) throw Object.assign(new FeedError(`Blackbaud feed error (HTTP ${r.status}).`), { code: r.status });
      return r;
    },
    { tries: 3, baseMs: 1000 },
  );

  if (res.status === 304) {
    await saveState({ ...state, lastCheckedAt: now });
    return { status: "unchanged", count: state.count ?? 0 };
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new FeedError(
      `Blackbaud rejected the feed link (HTTP ${res.status}). It may have been reset — copy a new link from Blackbaud into BLACKBAUD_ICS_URL.`,
    );
  }
  if (!res.ok) throw new FeedError(`Blackbaud feed returned HTTP ${res.status}.`);

  const text = await res.text();
  if (text.length > MAX_BYTES) throw new FeedError("Blackbaud feed is unexpectedly large; skipped.");
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new FeedError("The Blackbaud link didn't return a calendar file (maybe a login page). Check the feed link.");
  }

  const hash = createHash("sha256").update(text).digest("hex");
  const meta = { etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
  if (!force && hash === state.hash) {
    await saveState({ ...state, ...meta, lastCheckedAt: now });
    return { status: "unchanged", count: state.count ?? 0 };
  }

  let items: BlackbaudItem[];
  try {
    items = parseBlackbaudIcs(text);
  } catch {
    throw new FeedError("Couldn't read the Blackbaud calendar file (bad format).");
  }
  if (items.length === 0 && (state.count ?? 0) > 3) {
    throw new FeedError("Blackbaud feed came back empty; kept your existing assignments just in case.");
  }

  // What we have now, to work out added / changed / removed.
  const existing = await db
    .select({
      key: events.externalKey,
      title: events.title,
      startAt: events.startAt,
      endAt: events.endAt,
      description: events.description,
      meta: events.meta,
    })
    .from(events)
    .where(and(eq(events.source, "blackbaud"), isNull(events.deletedAt)));
  const byKey = new Map(existing.map((r) => [r.key, r]));

  const rows = items.map(toRow);
  const added: EventInsert[] = [];
  const changed: EventInsert[] = [];
  for (const r of rows) {
    const old = byKey.get(r.externalKey);
    if (!old) added.push(r);
    else if (
      old.title !== r.title ||
      +old.startAt !== +r.startAt! ||
      +old.endAt !== +r.endAt! ||
      (old.description ?? null) !== (r.description ?? null) ||
      stableJson(old.meta) !== stableJson(r.meta)
    )
      changed.push(r);
  }

  // Remove items missing from the feed, but only inside the window the feed still covers.
  const keys = new Set(rows.map((r) => r.externalKey));
  const earliest = rows.length ? Math.min(...rows.map((r) => +r.endAt!)) : Infinity;
  const gone = existing.filter((r) => !keys.has(r.key) && +r.endAt >= earliest).map((r) => r.key);

  await upsert([...added, ...changed]);
  if (gone.length) {
    for (let i = 0; i < gone.length; i += 500) {
      const chunk = gone.slice(i, i + 500);
      await db
        .update(events)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(events.source, "blackbaud"),
            sql`${events.externalKey} in (${sql.join(chunk.map((k) => sql`${k}`), sql`, `)})`,
          ),
        );
    }
  }

  await saveState({ ...meta, hash, lastCheckedAt: now, lastChangedAt: now, count: rows.length });

  if (added.length || changed.length || gone.length) {
    const names = added.slice(0, 3).map((r) => `“${r.title}”`);
    const more = added.length > 3 ? ` and ${added.length - 3} more` : "";
    await logActivity(
      "blackbaud",
      [
        added.length ? `Blackbaud: added ${names.join(", ")}${more}` : "Blackbaud:",
        changed.length ? `${changed.length} updated` : null,
        gone.length ? `${gone.length} removed` : null,
      ]
        .filter(Boolean)
        .join(added.length ? " · " : " "),
      { added: added.length, changed: changed.length, removed: gone.length },
    );
  }
  log.info("blackbaud synced", { count: rows.length, added: added.length, changed: changed.length, removed: gone.length });
  return { status: "updated", count: rows.length, added: added.length, changed: changed.length, removed: gone.length };
}

/** JSON with sorted keys: Postgres jsonb doesn't keep key order, so compare this way. */
function stableJson(v: unknown): string {
  const o = (v ?? {}) as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
}

/** Blackbaud item → unified events row. Due items show at their due time. */
export function toRow(i: BlackbaudItem): EventInsert & { externalKey: string } {
  return {
    source: "blackbaud",
    externalKey: `bb:${i.key}`,
    title: i.title,
    description: i.description,
    location: i.location,
    startAt: i.startAt ?? i.dueAt,
    endAt: i.dueAt,
    allDay: false,
    status: "confirmed",
    htmlLink: i.url,
    meta: { ...i.meta, ...(i.dateOnly ? { dateOnly: 1 } : {}) },
    deletedAt: null,
    updatedAt: new Date(),
  };
}

async function upsert(rows: EventInsert[]) {
  if (!rows.length) return;
  const db = await getDb();
  for (let i = 0; i < rows.length; i += 200) {
    await db
      .insert(events)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: [events.source, events.externalKey],
        set: {
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          location: sql`excluded.location`,
          startAt: sql`excluded.start_at`,
          endAt: sql`excluded.end_at`,
          htmlLink: sql`excluded.html_link`,
          meta: sql`excluded.meta`,
          deletedAt: sql`NULL`,
          updatedAt: sql`now()`,
        },
      });
  }
}

export async function getBlackbaudState(): Promise<BlackbaudState> {
  const db = await getDb();
  const [row] = await db.select().from(syncState).where(eq(syncState.key, STATE_KEY));
  return (row?.value as BlackbaudState | undefined) ?? {};
}

async function saveState(value: BlackbaudState) {
  const db = await getDb();
  await db
    .insert(syncState)
    .values({ key: STATE_KEY, value })
    .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: new Date() } });
}
