import { TZDate } from "@date-fns/tz";
import ICAL from "ical.js";
import { endOfDayDeadlineET, etWallTime } from "@/lib/time";

/**
 * Turns Blackbaud's calendar feed (an .ics file) into simple "due item" rows.
 * Pure function: no network, no database, so it is easy to test.
 *
 * Rules:
 *  - Date-only items: Blackbaud puts the ASSIGNED date in DTSTART and the DUE
 *    date in DTEND (exclusive, i.e. the day after). So due date = DTEND − 1 day,
 *    at 11:59 PM ET. Without a DTEND, the start date is the due date.
 *  - Timed items keep their time (if it has an end, the end is the due time).
 *  - Each item is identified by its UID (+ RECURRENCE-ID), so re-reading the
 *    feed updates items instead of duplicating them.
 *  - Titles look like "AP Calculus AB - 1: Packet pg. 56-58"; the class part is
 *    split off into meta.className.
 *  - Extra details (class, type, points, status) are kept only when the feed
 *    actually has them; nothing is invented.
 */
export type BlackbaudItem = {
  key: string;
  title: string;
  dueAt: Date;
  /** Start time for items that have a real time range (e.g. a test 9–10 AM); else null. */
  startAt: Date | null;
  dateOnly: boolean;
  description: string | null;
  url: string | null;
  location: string | null;
  meta: Record<string, string | number>;
};

export function parseBlackbaudIcs(text: string): BlackbaudItem[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  const out = new Map<string, BlackbaudItem>();

  for (const ve of comp.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(ve);
    if (!ev.uid || !ev.startDate) continue;
    if (String(ve.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") continue;

    const rid = ve.getFirstPropertyValue("recurrence-id");
    const key = rid ? `${ev.uid}#${String(rid)}` : ev.uid;

    const s = ev.startDate;
    const e = ev.endDate;
    let dueAt: Date;
    let startAt: Date | null = null;
    const meta: Record<string, string | number> = {};
    if (s.isDate) {
      let dueKey = dateKeyOf(s);
      if (e && e.isDate && e.compare(s) > 0) {
        const last = e.clone();
        last.adjust(-1, 0, 0, 0); // DTEND is exclusive
        dueKey = dateKeyOf(last);
      }
      if (dueKey !== dateKeyOf(s)) meta.assigned = dateKeyOf(s);
      dueAt = endOfDayDeadlineET(dueKey);
    } else {
      const start = timeToDate(s, tzidOf(ve, "dtstart"));
      const endProp = ve.getFirstProperty("dtend") ? "dtend" : "dtstart";
      const end = e && !e.isDate ? timeToDate(e, tzidOf(ve, endProp)) : null;
      if (end && +end > +start) {
        startAt = start;
        dueAt = end;
      } else {
        dueAt = start;
      }
    }

    const categories = ve
      .getAllProperties("categories")
      .flatMap((p) => p.getValues().map(String))
      .map(clean)
      .filter((c) => c && !GENERIC_CATEGORIES.has(c.toLowerCase()));
    if (categories.length) meta.categories = categories.join(", ");
    // Keep any X- extras Blackbaud adds (class, points, type, status…), cleaned.
    for (const p of ve.getAllProperties()) {
      const name = p.name.toLowerCase();
      if (!name.startsWith("x-") || name.startsWith("x-microsoft") || name.startsWith("x-apple")) continue;
      const v = clean(String(p.getFirstValue() ?? ""));
      if (v) meta[name.slice(2)] = v.slice(0, 200);
    }

    // "AP Calculus AB - 1: Packet pg. 56-58" → class "AP Calculus AB - 1", title "Packet pg. 56-58"
    let title = clean(ev.summary ?? "");
    const m = title.match(CLASS_PREFIX);
    if (m) {
      meta.className = m[1];
      title = m[2];
    }

    const url = ve.getFirstPropertyValue("url");
    out.set(key, {
      key,
      title: title || "(Untitled assignment)",
      dueAt,
      startAt,
      dateOnly: s.isDate,
      description: ev.description ? clean(ev.description).slice(0, 4000) || null : null,
      url: url ? String(url) : null,
      location: ev.location ? clean(ev.location) || null : null,
      meta,
    });
  }
  return [...out.values()];
}

/** Blackbaud's "<Course> - <Section>: <Assignment>" title format. */
const CLASS_PREFIX = /^(.+? - [^:]{1,20}?): ([\s\S]+)$/;
/** Categories every item has, which tell you nothing. */
const GENERIC_CATEGORIES = new Set(["podium", "events"]);

/** "YYYY-MM-DD" of an ICAL date value. */
function dateKeyOf(t: ICAL.Time): string {
  return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}

/** The TZID parameter on a date property, if any (e.g. "America/New_York"). */
function tzidOf(ve: ICAL.Component, prop: string): string | null {
  const v = ve.getFirstProperty(prop)?.getParameter("tzid");
  return typeof v === "string" ? v.replace(/^\/+/, "") : null;
}

function isIanaZone(z: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

/**
 * Exact instant of an ICAL date-time:
 *  - "...Z" (UTC) → as given.
 *  - TZID=<real zone> → that zone's wall time.
 *  - No zone, or a zone name we can't read (e.g. "Eastern Standard Time") → Eastern Time,
 *    never the server's UTC.
 */
function timeToDate(t: ICAL.Time, tzid: string | null): Date {
  if (t.zone?.tzid === "UTC") return t.toJSDate();
  if (tzid && isIanaZone(tzid)) {
    return new Date(new TZDate(t.year, t.month - 1, t.day, t.hour, t.minute, t.second, 0, tzid).getTime());
  }
  return etWallTime(dateKeyOf(t), t.hour, t.minute);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Strip HTML tags, decode entities, collapse whitespace. */
export function clean(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
