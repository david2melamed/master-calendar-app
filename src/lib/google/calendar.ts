import "server-only";
import { calendar, type calendar_v3 } from "@googleapis/calendar";
import { and, eq, notInArray } from "drizzle-orm";
import type { OAuth2Client } from "google-auth-library";
import { withAccount, type Account } from "@/lib/accounts";
import { getDb } from "@/lib/db/client";
import { calendars } from "@/lib/db/schema";

export function calendarApi(auth: OAuth2Client) {
  return calendar({ version: "v3", auth });
}

/** Fetch every calendar the account owns or subscribes to, and store the list. */
export async function refreshCalendarList(account: Account) {
  const items: calendar_v3.Schema$CalendarListEntry[] = await withAccount(account, async (auth) => {
    const api = calendarApi(auth);
    const all: calendar_v3.Schema$CalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const res = await api.calendarList.list({ pageToken, maxResults: 250, showHidden: false });
      all.push(...(res.data.items ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return all;
  });

  const db = await getDb();
  const seen: string[] = [];
  for (const c of items) {
    if (!c.id) continue;
    seen.push(c.id);
    const values = {
      accountId: account.id,
      googleCalendarId: c.id,
      summary: c.summaryOverride || c.summary || c.id,
      colorHex: c.backgroundColor ?? null,
      accessRole: c.accessRole ?? null,
      isPrimary: !!c.primary,
      updatedAt: new Date(),
    };
    await db
      .insert(calendars)
      .values(values)
      .onConflictDoUpdate({ target: [calendars.accountId, calendars.googleCalendarId], set: values });
  }
  // Calendars you unsubscribed from in Google disappear here too.
  if (seen.length) {
    await db
      .delete(calendars)
      .where(and(eq(calendars.accountId, account.id), notInArray(calendars.googleCalendarId, seen)));
  }
  return items.length;
}

export async function calendarsFor(accountId: string) {
  const db = await getDb();
  return db.select().from(calendars).where(eq(calendars.accountId, accountId));
}
