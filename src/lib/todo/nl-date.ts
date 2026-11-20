import { addDays } from "date-fns";
import { dateKeyET, etWallTime, inET } from "@/lib/time";

/**
 * Quick-add date reader (pure, Eastern Time): "essay fri" → title "essay",
 * due Friday 11:59 PM. Understands today/tonight, tomorrow/tmrw, weekday
 * names (next one; "next fri" skips a week), "in 3 days", 11/24, Nov 24,
 * and an optional time like "5pm", "5:30pm", "at 17:00".
 * No date words → due null (caller decides).
 */
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseQuickAdd(text: string, now = new Date()): { title: string; dueAt: Date | null } {
  let t = ` ${text.trim()} `;
  const today = dateKeyET(now);
  const plus = (n: number) => dateKeyET(addDays(inET(etWallTime(today, 12)), n));
  let day: string | null = null;
  let time: [number, number] | null = null;

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = t.match(re);
    if (m) {
      fn(m);
      t = t.replace(m[0], " ");
    }
  };

  // Time first: "5pm", "5:30 pm", "at 17:00"
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (m) => {
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    time = [h, Number(m[2] ?? 0)];
  });
  if (!time) take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/, (m) => (time = [Number(m[1]), Number(m[2])]));

  take(/\s(today|tonight|tdy)\b/i, () => (day = today));
  if (!day) take(/\s(tomorrow|tmrw|tmr|tom)\b/i, () => (day = plus(1)));
  if (!day) take(/\sin\s+(\d{1,2})\s+days?\b/i, (m) => (day = plus(Number(m[1]))));
  if (!day)
    take(/\s(next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/i, (m) => {
      const target = DAYS.indexOf(m[2].slice(0, 3).toLowerCase());
      const cur = inET(etWallTime(today, 12)).getDay();
      let d = (target - cur + 7) % 7 || 7; // "fri" on a Friday = next Friday
      if (m[1]) d += d < 7 ? 7 : 0;
      day = plus(d);
    });
  if (!day)
    take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => (day = absolute(Number(m[1]), Number(m[2]), m[3], today)));
  if (!day)
    take(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, (m) => {
      day = absolute(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2]), undefined, today);
    });

  const title = t.replace(/\s+(due|by|on)\s*$/i, " ").replace(/\s+/g, " ").trim() || text.trim();
  if (!day && time) day = today;
  if (!day) return { title, dueAt: null };
  const [h, m] = time ?? [23, 59];
  return { title, dueAt: etWallTime(day, h, m) };
}

/** Month/day without a year → the next time that date comes around. */
function absolute(month: number, dayOfMonth: number, year: string | undefined, today: string): string | null {
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return null;
  let y = year ? Number(year.length === 2 ? `20${year}` : year) : Number(today.slice(0, 4));
  const key = (yy: number) => `${yy}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
  if (!year && key(y) < today) y += 1;
  return key(y);
}
