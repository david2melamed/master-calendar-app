import "server-only";
import type { calendar_v3 } from "@googleapis/calendar";
import { eq, like } from "drizzle-orm";
import { getAccountByEmail, withAccount, type Account } from "@/lib/accounts";
import { getDb } from "@/lib/db/client";
import { syncState } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { TZ } from "@/lib/time";
import { calendarApi } from "./calendar";

/**
 * The ONLY places this app writes: calendars it creates itself in your
 * personal account ("Auto-added" now, "To-Do" in Phase 6). Every event it
 * creates carries extendedProperties.private.mcId, so a retry finds the
 * existing event instead of making a duplicate.
 */
export type AppCalendarName = "Auto-added" | "To-Do";

const stateKey = (name: AppCalendarName) => `appcal:${name.toLowerCase()}`;

/** The personal (writable) account. Throws if it isn't connected with calendar access. */
export async function personalAccount(): Promise<Account> {
  const acc = await getAccountByEmail(env().PRIMARY_EMAIL);
  if (!acc?.encryptedRefreshToken) throw new Error("Your personal Google account isn't connected.");
  if (!acc.scopes.includes("https://www.googleapis.com/auth/calendar")) {
    throw new Error("Calendar write permission is missing — click Reconnect on your personal account.");
  }
  return acc;
}

/** Find or create the app's calendar; remembers its id. */
export async function ensureAppCalendar(name: AppCalendarName): Promise<{ account: Account; calendarId: string }> {
  const account = await personalAccount();
  const db = await getDb();
  const [row] = await db.select().from(syncState).where(eq(syncState.key, stateKey(name)));
  const saved = (row?.value as { calendarId?: string } | undefined)?.calendarId;

  const calendarId = await withAccount(account, async (auth) => {
    const api = calendarApi(auth);
    if (saved) {
      try {
        await api.calendars.get({ calendarId: saved });
        return saved;
      } catch (e) {
        if ((e as { code?: number }).code !== 404) throw e; // deleted in Google → recreate below
      }
    }
    // Maybe it exists already (e.g. the database was reset).
    const list = await api.calendarList.list({ minAccessRole: "owner", maxResults: 250 });
    const found = list.data.items?.find((c) => c.summary === name);
    if (found?.id) return found.id;
    const created = await api.calendars.insert({
      requestBody: { summary: name, timeZone: TZ, description: "Created by Master Calendar. Events here are added automatically." },
    });
    return created.data.id!;
  });

  if (calendarId !== saved) {
    await db
      .insert(syncState)
      .values({ key: stateKey(name), value: { calendarId } })
      .onConflictDoUpdate({ target: syncState.key, set: { value: { calendarId }, updatedAt: new Date() } });
  }
  return { account, calendarId };
}

/** Google calendar ids of the app's own calendars (hidden from the legend; their events show as AI / To-Do). */
export async function appCalendarIds(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select().from(syncState).where(like(syncState.key, "appcal:%"));
  return rows.map((r) => (r.value as { calendarId?: string }).calendarId).filter((x): x is string => !!x);
}

export type EventTimes = { start: Date; end: Date; allDay: boolean };

/** All-day: Google wants "YYYY-MM-DD" with an exclusive end date. Timed: exact instants. */
function timesBody(t: EventTimes, dateKey: (d: Date) => string) {
  return t.allDay
    ? { start: { date: dateKey(t.start) }, end: { date: dateKey(t.end) } }
    : { start: { dateTime: t.start.toISOString(), timeZone: TZ }, end: { dateTime: t.end.toISOString(), timeZone: TZ } };
}

export type AppEventInput = EventTimes & {
  mcId: string;
  title: string;
  description?: string | null;
  location?: string | null;
};

/** Create (or, on retry, find) an event in an app calendar. Returns Google's event. */
export async function upsertAppEvent(
  cal: { account: Account; calendarId: string },
  ev: AppEventInput,
  dateKey: (d: Date) => string,
): Promise<calendar_v3.Schema$Event> {
  return withAccount(cal.account, async (auth) => {
    const api = calendarApi(auth);
    const existing = await api.events.list({
      calendarId: cal.calendarId,
      privateExtendedProperty: [`mcId=${ev.mcId}`],
      showDeleted: false,
      maxResults: 1,
    });
    const body: calendar_v3.Schema$Event = {
      summary: ev.title,
      description: ev.description ?? undefined,
      location: ev.location ?? undefined,
      ...timesBody(ev, dateKey),
      extendedProperties: { private: { mcId: ev.mcId } },
    };
    const found = existing.data.items?.[0];
    if (found?.id) {
      const res = await api.events.patch({ calendarId: cal.calendarId, eventId: found.id, requestBody: body });
      return res.data;
    }
    const res = await api.events.insert({ calendarId: cal.calendarId, requestBody: body });
    return res.data;
  });
}

export async function deleteAppEvent(cal: { account: Account; calendarId: string }, googleEventId: string) {
  await withAccount(cal.account, async (auth) => {
    try {
      await calendarApi(auth).events.delete({ calendarId: cal.calendarId, eventId: googleEventId });
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code !== 404 && code !== 410) throw e; // already gone is fine
    }
  });
}
