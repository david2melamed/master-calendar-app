import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, addYears, format, getWeek, startOfMonth, startOfWeek, startOfYear } from "date-fns";
import { dateKeyET, etWallTime, TZ } from "@/lib/time";

/**
 * Calendar math for the UI. The "cursor" is a date key ("YYYY-MM-DD") in
 * Eastern Time, so the calendar is correct no matter where the device is.
 * Weeks start on Sunday (US convention).
 */
export type View = "year" | "month" | "week" | "day";

/** A TZDate at noon ET on that day (noon avoids any DST edge weirdness). */
export const keyToDate = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new TZDate(y, m - 1, d, 12, 0, 0, 0, TZ);
};
export const dateToKey = (d: Date) => format(d, "yyyy-MM-dd");
export const todayKey = () => dateKeyET(Date.now());

export const addDaysKey = (k: string, n: number) => dateToKey(addDays(keyToDate(k), n));

export function weekStartKey(k: string) {
  return dateToKey(startOfWeek(keyToDate(k), { weekStartsOn: 0 }));
}
export function weekKeys(k: string): string[] {
  const s = weekStartKey(k);
  return Array.from({ length: 7 }, (_, i) => addDaysKey(s, i));
}
/** 6 rows × 7 days covering the month (leading/trailing days from neighbours). */
export function monthMatrix(k: string): string[][] {
  const first = dateToKey(startOfMonth(keyToDate(k)));
  const start = weekStartKey(first);
  return Array.from({ length: 6 }, (_, r) => Array.from({ length: 7 }, (_, c) => addDaysKey(start, r * 7 + c)));
}
export const weekNumber = (k: string) => getWeek(keyToDate(k), { weekStartsOn: 0 });

export function shiftKey(k: string, view: View, dir: 1 | -1): string {
  const d = keyToDate(k);
  if (view === "day") return dateToKey(addDays(d, dir));
  if (view === "week") return dateToKey(addDays(d, 7 * dir));
  if (view === "month") return dateToKey(addMonths(d, dir));
  return dateToKey(addYears(d, dir));
}

/** The [from, to) instants to fetch for a view. */
export function rangeFor(k: string, view: View): { from: Date; to: Date } {
  if (view === "day") return { from: etWallTime(k), to: etWallTime(addDaysKey(k, 1)) };
  if (view === "week") {
    const s = weekStartKey(k);
    return { from: etWallTime(s), to: etWallTime(addDaysKey(s, 7)) };
  }
  if (view === "month") {
    const m = monthMatrix(k);
    return { from: etWallTime(m[0][0]), to: etWallTime(addDaysKey(m[5][6], 1)) };
  }
  const y = dateToKey(startOfYear(keyToDate(k)));
  return { from: etWallTime(y), to: etWallTime(dateToKey(addYears(keyToDate(y), 1))) };
}

/** Header title for each view. */
export function titleFor(k: string, view: View): string {
  const d = keyToDate(k);
  if (view === "day") return format(d, "EEEE, MMMM d");
  if (view === "month") return format(d, "MMMM yyyy");
  if (view === "year") return format(d, "yyyy");
  const days = weekKeys(k).map(keyToDate);
  const a = days[0];
  const b = days[6];
  if (a.getMonth() === b.getMonth()) return `${format(a, "MMMM d")} – ${format(b, "d, yyyy")}`;
  if (a.getFullYear() === b.getFullYear()) return `${format(a, "MMM d")} – ${format(b, "MMM d, yyyy")}`;
  return `${format(a, "MMM d, yyyy")} – ${format(b, "MMM d, yyyy")}`;
}

/** Minutes since ET midnight for an instant (wall-clock, so DST days still line up). */
export function minutesOfDayET(iso: string | Date): number {
  const d = new TZDate(new Date(iso).getTime(), TZ);
  return d.getHours() * 60 + d.getMinutes();
}

/** Every ET date key an event touches (all-day end dates are exclusive). */
export function eventDayKeys(e: { start: string; end: string; allDay: boolean }): string[] {
  const first = dateKeyET(new Date(e.start));
  // End is exclusive: an event ending exactly at midnight doesn't touch the next day.
  const endInstant = new Date(new Date(e.end).getTime() - 1);
  let last = dateKeyET(endInstant < new Date(e.start) ? new Date(e.start) : endInstant);
  if (last < first) last = first;
  const keys: string[] = [];
  for (let k = first; k <= last && keys.length < 400; k = addDaysKey(k, 1)) keys.push(k);
  return keys;
}

export function fmtTime(iso: string | Date): string {
  const d = new TZDate(new Date(iso).getTime(), TZ);
  return d.getMinutes() === 0 ? format(d, "h a") : format(d, "h:mm a");
}

export function fmtTimeRange(startIso: string, endIso: string): string {
  const s = new TZDate(new Date(startIso).getTime(), TZ);
  const e = new TZDate(new Date(endIso).getTime(), TZ);
  if (+s === +e) return fmtTime(s);
  const sameHalf = format(s, "a") === format(e, "a");
  const left = s.getMinutes() === 0 ? format(s, sameHalf ? "h" : "h a") : format(s, sameHalf ? "h:mm" : "h:mm a");
  return `${left} – ${fmtTime(e)}`;
}
