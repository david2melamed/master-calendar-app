import type { ExtractedEvent } from "@/lib/ai/schema";
import { TZDate } from "@date-fns/tz";
import { etWallTime, nextDateKey } from "@/lib/time";

/**
 * Turn the AI's wall-clock answer into exact instants (pure, tested).
 * A missing time zone always means US Eastern.
 *  - Time given → that time, in its own zone if the email gave one
 *    (a 5:50 PM Chicago departure is 6:50 PM Eastern); no end → 1 hour.
 *    Deadlines with a time are a point in time.
 *  - Deadline without a time → 11:59 PM ET.
 *  - No time otherwise → all-day (end date exclusive).
 * Returns null for dates/times that don't parse (never guess).
 */
export type Times = { start: Date; end: Date; allDay: boolean };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function validDate(k: string | null | undefined): k is string {
  if (!k || !DATE.test(k)) return false;
  const [y, m, d] = k.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isZone(z: string | null | undefined): z is string {
  if (!z) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock time in a given zone (default Eastern) → exact instant. */
function wall(dateKey: string, h: number, m: number, zone: string | null | undefined): Date {
  if (!isZone(zone)) return etWallTime(dateKey, h, m);
  const [y, mo, d] = dateKey.split("-").map(Number);
  return new Date(new TZDate(y, mo - 1, d, h, m, 0, 0, zone).getTime());
}

function hm(t: string | null | undefined): [number, number] | null {
  const m = t?.trim().match(TIME);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function eventTimes(
  ev: Pick<ExtractedEvent, "date" | "start_time" | "end_time" | "end_date" | "is_deadline"> &
    Partial<Pick<ExtractedEvent, "timezone" | "end_timezone">>,
): Times | null {
  if (!validDate(ev.date)) return null;
  const endDate = validDate(ev.end_date) && ev.end_date >= ev.date ? ev.end_date : ev.date;
  const s = hm(ev.start_time);

  if (s) {
    const start = wall(ev.date, s[0], s[1], ev.timezone);
    if (ev.is_deadline && !ev.end_time) return { start, end: start, allDay: false };
    const e = hm(ev.end_time);
    let end = e ? wall(endDate, e[0], e[1], ev.end_timezone) : new Date(+start + 3600_000);
    if (+end <= +start) end = new Date(+start + 3600_000); // "7–9" written as 19:00–09:00 etc.
    return { start, end, allDay: false };
  }
  if (ev.is_deadline) {
    const due = etWallTime(endDate, 23, 59);
    return { start: due, end: due, allDay: false };
  }
  return { start: etWallTime(ev.date), end: etWallTime(nextDateKey(endDate)), allDay: true };
}
