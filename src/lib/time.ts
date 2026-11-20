import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfDay } from "date-fns";

/**
 * The app runs on servers in UTC, but the user lives in Eastern Time.
 * EVERY date calculation must go through these helpers so DST is handled
 * correctly. Never use `new Date().getHours()` etc. directly.
 */
export const TZ = "America/New_York";

/** "Now" as a date that answers getHours()/getDate() in Eastern Time. */
export function nowET(): TZDate {
  return new TZDate(Date.now(), TZ);
}

/** Wrap any instant so its calendar fields are read in Eastern Time. */
export function inET(d: Date | number | string): TZDate {
  return new TZDate(new Date(d).getTime(), TZ);
}

/** Midnight ET at the start of the given instant's ET day. */
export function startOfDayET(d: Date | number): Date {
  return new Date(startOfDay(inET(d)).getTime());
}

/** The ET calendar date "YYYY-MM-DD" containing this instant. */
export function dateKeyET(d: Date | number): string {
  return format(inET(d), "yyyy-MM-dd");
}

/** Build an instant from an ET wall-clock time, e.g. etWallTime("2026-11-20", 23, 59). */
export function etWallTime(dateKey: string, hours = 0, minutes = 0): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Returned as a plain Date (an exact instant) so it stores/serializes uniformly.
  return new Date(new TZDate(y, m - 1, d, hours, minutes, 0, 0, TZ).getTime());
}

/** 11:59 PM ET on the given ET date — our default time for deadlines. */
export function endOfDayDeadlineET(dateKey: string): Date {
  return etWallTime(dateKey, 23, 59);
}

/** Next ET calendar date key. */
export function nextDateKey(dateKey: string): string {
  return format(addDays(inET(etWallTime(dateKey, 12)), 1), "yyyy-MM-dd");
}

/** Human formatting in ET, e.g. fmtET(d, "EEEE, MMMM d") → "Thursday, November 19". */
export function fmtET(d: Date | number, pattern: string): string {
  return format(inET(d), pattern);
}
