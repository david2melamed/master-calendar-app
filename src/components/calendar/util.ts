import { addDaysKey, eventDayKeys, minutesOfDayET } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/events/types";
import { etWallTime } from "@/lib/time";

/** "Pinned to the top" items: all-day events, Blackbaud due items, and to-dos. */
export const isTopItem = (e: CalendarEvent) => e.allDay || e.source === "blackbaud" || e.source === "todo";

/** Group events by every ET day they touch. */
export function byDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const m = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    for (const k of eventDayKeys(e)) {
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
  }
  for (const list of m.values()) list.sort(compareEvents);
  return m;
}

/** All-day first, then due/to-do, then by start time, longer first. */
export function compareEvents(a: CalendarEvent, b: CalendarEvent) {
  const rank = (e: CalendarEvent) => (e.allDay ? 0 : e.source === "blackbaud" || e.source === "todo" ? 1 : 2);
  return (
    rank(a) - rank(b) ||
    a.start.localeCompare(b.start) ||
    +new Date(b.end) - +new Date(b.start) - (+new Date(a.end) - +new Date(a.start)) ||
    a.title.localeCompare(b.title)
  );
}

export type Segment = { event: CalendarEvent; startMin: number; endMin: number };

/** The part of a timed event that falls on a given day, in minutes from ET midnight. */
export function segmentsForDay(events: CalendarEvent[], dayKey: string): Segment[] {
  const dayStart = etWallTime(dayKey);
  const dayEnd = etWallTime(addDaysKey(dayKey, 1));
  const out: Segment[] = [];
  for (const e of events) {
    if (isTopItem(e)) continue;
    const s = new Date(e.start);
    const en = new Date(e.end);
    if (en <= dayStart || s >= dayEnd) continue;
    const startMin = s <= dayStart ? 0 : minutesOfDayET(s);
    const endMin = en >= dayEnd ? 24 * 60 : minutesOfDayET(en);
    out.push({ event: e, startMin, endMin: Math.max(endMin, startMin) });
  }
  return out;
}

/** Google descriptions are HTML; show them as clean text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Soft background tint for an event color that works in light and dark mode. */
export const tint = (color: string, pct = 14) => `color-mix(in srgb, ${color} ${pct}%, var(--bg))`;
