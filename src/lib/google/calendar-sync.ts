import "server-only";
import type { calendar_v3 } from "@googleapis/calendar";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { listAccounts, withAccount, type Account } from "@/lib/accounts";
import { getDb } from "@/lib/db/client";
import { calendars, events } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { recordError, resolveErrors } from "@/lib/status";
import { etWallTime } from "@/lib/time";
import { calendarApi, refreshCalendarList } from "./calendar";

type CalendarRow = typeof calendars.$inferSelect;
type EventInsert = typeof events.$inferInsert;

/**
 * Google's public holiday calendars ignore sync tokens and resend everything,
 * and they almost never change — so refresh them at most once a day.
 */
const HOLIDAY_REFRESH_MS = 24 * 3600_000;
export const isHolidayCalendar = (googleCalendarId: string) => /#holiday@group\.v\.calendar\.google\.com$/.test(googleCalendarId);

/** How far back the first (full) sync looks. Later syncs only fetch changes. */
const INITIAL_LOOKBACK_DAYS = 365;

/**
 * Convert one Google event into our unified row. Returns null for events that
 * should not be shown (cancelled, or ones you declined).
 */
export function mapGoogleEvent(
  ev: calendar_v3.Schema$Event,
  cal: Pick<CalendarRow, "id" | "accountId">,
): { key: string; row: EventInsert | null } {
  const key = `${cal.id}:${ev.id}`;
  const declined = ev.attendees?.some((a) => a.self && a.responseStatus === "declined");
  if (ev.status === "cancelled" || declined) return { key, row: null };

  let startAt: Date;
  let endAt: Date;
  let allDay = false;
  if (ev.start?.date) {
    // All-day: Google gives "YYYY-MM-DD" dates; the end date is exclusive.
    allDay = true;
    startAt = etWallTime(ev.start.date);
    endAt = etWallTime(ev.end?.date ?? ev.start.date);
    if (+endAt <= +startAt) endAt = new Date(+startAt + 24 * 3600 * 1000);
  } else if (ev.start?.dateTime) {
    startAt = new Date(ev.start.dateTime);
    endAt = new Date(ev.end?.dateTime ?? ev.start.dateTime);
  } else {
    return { key, row: null };
  }

  return {
    key,
    row: {
      source: "google",
      externalKey: key,
      accountId: cal.accountId,
      calendarId: cal.id,
      googleEventId: ev.id ?? null,
      title: ev.summary?.trim() || "(No title)",
      description: ev.description ? ev.description.slice(0, 5000) : null,
      location: ev.location ?? null,
      startAt,
      endAt,
      allDay,
      status: ev.status === "tentative" ? "tentative" : "confirmed",
      htmlLink: ev.htmlLink ?? null,
      recurringEventId: ev.recurringEventId ?? null,
      // App-created events carry our id so we can recognise them later.
      meta: ev.extendedProperties?.private?.mcId ? { mcId: ev.extendedProperties.private.mcId } : null,
      deletedAt: null,
      updatedAt: new Date(),
    },
  };
}

/** Sync one calendar. Uses Google's syncToken so repeat syncs only fetch changes. */
export async function syncCalendar(account: Account, cal: CalendarRow): Promise<{ upserted: number; removed: number }> {
  const db = await getDb();
  let upserted = 0;
  let removed = 0;

  const run = async (syncToken: string | null) =>
    withAccount(account, async (auth) => {
      const api = calendarApi(auth);
      let pageToken: string | undefined;
      let nextSyncToken: string | null = null;
      do {
        const res = await api.events.list({
          calendarId: cal.googleCalendarId,
          singleEvents: true, // expand recurring events into individual occurrences
          showDeleted: true,
          maxResults: 2500,
          pageToken,
          ...(syncToken
            ? { syncToken }
            : { timeMin: new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 86400_000).toISOString() }),
        });
        const rows: EventInsert[] = [];
        const gone: string[] = [];
        const goneIds: string[] = [];
        const appOwned: EventInsert[] = [];
        for (const ev of res.data.items ?? []) {
          if (!ev.id) continue;
          const { key, row } = mapGoogleEvent(ev, cal);
          if (row?.meta?.mcId) appOwned.push(row); // created by this app → mirror onto our AI/To-Do row
          else if (row) rows.push(row);
          else {
            gone.push(key);
            goneIds.push(ev.id);
          }
        }
        upserted += await upsertEvents(rows);
        removed += await softDelete(gone);
        await mirrorAppOwned(appOwned, goneIds);
        pageToken = res.data.nextPageToken ?? undefined;
        nextSyncToken = res.data.nextSyncToken ?? nextSyncToken;
      } while (pageToken);
      return nextSyncToken;
    });

  let token: string | null;
  try {
    token = await run(cal.syncToken);
  } catch (e) {
    // 410 Gone = Google forgot our sync token; start over with a full sync.
    if ((e as { code?: number })?.code === 410 || /410|sync token/i.test(String((e as Error)?.message))) {
      log.warn("sync token expired, full resync", { calendar: cal.summary });
      await db
        .update(events)
        .set({ deletedAt: new Date() })
        .where(and(eq(events.calendarId, cal.id), isNull(events.deletedAt)));
      token = await run(null);
    } else {
      throw e;
    }
  }

  await db
    .update(calendars)
    .set({ syncToken: token, lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(calendars.id, cal.id));
  log.info("calendar synced", { calendar: cal.summary, incremental: !!cal.syncToken, upserted, removed });
  return { upserted, removed };
}

async function upsertEvents(rows: EventInsert[]): Promise<number> {
  if (!rows.length) return 0;
  const db = await getDb();
  // Insert in chunks; on (source, external_key) conflict, overwrite with the new values.
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
          allDay: sql`excluded.all_day`,
          status: sql`excluded.status`,
          htmlLink: sql`excluded.html_link`,
          recurringEventId: sql`excluded.recurring_event_id`,
          meta: sql`excluded.meta`,
          deletedAt: sql`NULL`,
          updatedAt: sql`now()`,
        },
      });
  }
  return rows.length;
}

/**
 * Events this app created (in "Auto-added" / "To-Do") come back through the
 * normal calendar sync. Instead of showing them twice, copy any edits you made
 * in Google Calendar onto the app's own row, and remove it if you deleted it.
 */
async function mirrorAppOwned(rows: EventInsert[], goneGoogleIds: string[]) {
  const db = await getDb();
  for (const r of rows) {
    await db
      .update(events)
      .set({ title: r.title.replace(/^✓ /, ""), location: r.location, startAt: r.startAt, endAt: r.endAt, allDay: r.allDay, htmlLink: r.htmlLink, updatedAt: new Date() })
      .where(
        and(
          inArray(events.source, ["ai", "todo"]),
          eq(events.externalKey, String(r.meta!.mcId)),
          isNull(events.deletedAt),
          sql`(${events.title} <> ${r.title.replace(/^✓ /, "")} or ${events.startAt} <> ${r.startAt!.toISOString()}::timestamptz or ${events.endAt} <> ${r.endAt!.toISOString()}::timestamptz or coalesce(${events.location}, '') <> ${r.location ?? ""})`,
        ),
      );
  }
  if (goneGoogleIds.length) {
    await db
      .update(events)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(inArray(events.source, ["ai", "todo"]), inArray(events.googleEventId, goneGoogleIds), isNull(events.deletedAt)));
  }
}

async function softDelete(keys: string[]): Promise<number> {
  if (!keys.length) return 0;
  const db = await getDb();
  let n = 0;
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const res = await db
      .update(events)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(events.source, "google"),
          sql`${events.externalKey} in (${sql.join(chunk.map((k) => sql`${k}`), sql`, `)})`,
          isNull(events.deletedAt),
        ),
      )
      .returning({ id: events.id });
    n += res.length;
  }
  return n;
}

let inFlight: Promise<SyncSummary> | null = null;
export type SyncSummary = { accounts: number; calendars: number; upserted: number; removed: number; errors: number };

/**
 * Sync every calendar of every connected account. One failing calendar or
 * account never stops the others; failures are recorded on the Status page.
 */
export function syncAllCalendars(): Promise<SyncSummary> {
  // If a sync is already running in this server process, share it instead of starting another.
  inFlight ??= doSyncAll().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSyncAll(): Promise<SyncSummary> {
  const summary: SyncSummary = { accounts: 0, calendars: 0, upserted: 0, removed: 0, errors: 0 };
  const db = await getDb();
  const accounts = (await listAccounts()).filter(
    (a) => a.encryptedRefreshToken && (a.status === "connected" || a.status === "missing_scopes"),
  );

  for (const account of accounts) {
    const source = `calendar:${account.email}`;
    try {
      await refreshCalendarList(account);
      const cals = (await db.select().from(calendars).where(eq(calendars.accountId, account.id))).filter(
        (c) =>
          !isHolidayCalendar(c.googleCalendarId) ||
          !c.lastSyncedAt ||
          Date.now() - +c.lastSyncedAt >= HOLIDAY_REFRESH_MS,
      );
      summary.accounts++;
      let failed = 0;
      // A few calendars at a time keeps us well under Google's rate limits.
      for (let i = 0; i < cals.length; i += 4) {
        await Promise.all(
          cals.slice(i, i + 4).map(async (cal) => {
            try {
              const r = await syncCalendar(account, cal);
              summary.calendars++;
              summary.upserted += r.upserted;
              summary.removed += r.removed;
            } catch (e) {
              failed++;
              summary.errors++;
              await recordError(source, `"${cal.summary}": ${e instanceof Error ? e.message : String(e)}`);
            }
          }),
        );
      }
      if (!failed) await resolveErrors(source);
    } catch (e) {
      summary.errors++;
      await recordError(source, e instanceof Error ? e.message : String(e));
    }
  }
  log.info("calendar sync done", summary);
  return summary;
}

/** When the newest successful calendar sync happened (for "Synced 2 min ago"). */
export async function lastCalendarSync(): Promise<Date | null> {
  const db = await getDb();
  const [row] = await db.select({ t: sql<Date | null>`max(${calendars.lastSyncedAt})` }).from(calendars);
  return row?.t ? new Date(row.t) : null;
}
