import "server-only";
import { and, asc, eq, gt, isNull, lt, ne } from "drizzle-orm";
import { demoEvents } from "@/demo/seed";
import { getDb } from "@/lib/db/client";
import { accounts, calendars, events } from "@/lib/db/schema";
import { appCalendarIds } from "@/lib/google/app-calendar";
import { lastCalendarSync } from "@/lib/google/calendar-sync";
import { paletteColorFor, SOURCE_COLORS } from "./colors";
import type { CalendarEvent, EventsResponse, SourceInfo } from "./types";

/** Google names your main calendar after your email address; show something friendlier. */
export function calendarLabel(summary: string | undefined, isPrimary: boolean | undefined, email: string | null | undefined) {
  if (isPrimary || (summary && email && summary.toLowerCase() === email.toLowerCase())) {
    return email && !email.endsWith("@gmail.com") ? email.split("@")[1].split(".")[0].toUpperCase() : "Personal";
  }
  return summary ?? "Calendar";
}

const FIXED_SOURCES: SourceInfo[] = [
  { key: "ai", label: "Found in email (AI)", group: "App", color: SOURCE_COLORS.ai },
  { key: "blackbaud", label: "Blackbaud assignments", group: "App", color: SOURCE_COLORS.blackbaud },
  { key: "todo", label: "Urgent to-dos", group: "App", color: SOURCE_COLORS.todo },
];

/** All visible events overlapping [from, to), plus the legend. */
export async function eventsInRange(from: Date, to: Date): Promise<EventsResponse> {
  if (process.env.DEMO_MODE === "1" && process.env.NODE_ENV !== "production") return demoResponse(from, to);

  const db = await getDb();
  const [rows, cals] = await Promise.all([
    db
      .select({ e: events, cal: calendars, accEmail: accounts.email })
      .from(events)
      .leftJoin(calendars, eq(events.calendarId, calendars.id))
      .leftJoin(accounts, eq(events.accountId, accounts.id))
      .where(
        and(
          isNull(events.deletedAt),
          ne(events.status, "cancelled"),
          lt(events.startAt, to),
          gt(events.endAt, from),
        ),
      )
      .orderBy(asc(events.startAt))
      .limit(5000),
    db
      .select({ cal: calendars, email: accounts.email })
      .from(calendars)
      .innerJoin(accounts, eq(calendars.accountId, accounts.id))
      .orderBy(asc(accounts.createdAt), asc(calendars.summary)),
  ]);

  const out: CalendarEvent[] = rows.map(({ e, cal, accEmail }) => {
    const isGoogle = e.source === "google";
    const color = e.source === "google" ? paletteColorFor(cal?.colorHex) : SOURCE_COLORS[e.source];
    return {
      id: e.id,
      source: e.source,
      sourceKey: isGoogle ? `cal:${e.calendarId}` : e.source,
      title: e.title,
      start: e.startAt.toISOString(),
      end: e.endAt.toISOString(),
      allDay: e.allDay,
      location: e.location,
      description: e.description,
      status: e.status,
      sourceLabel: isGoogle ? `${calendarLabel(cal?.summary, cal?.isPrimary, accEmail)} · ${accEmail ?? ""}` : (FIXED_SOURCES.find((s) => s.key === e.source)?.label ?? e.source),
      color,
      htmlLink: e.htmlLink,
      aiGuessed: e.aiGuessed,
      aiConfidence: e.aiConfidence,
      aiQuote: e.aiQuote,
      gmailLink: e.gmailLink,
      meta: e.meta ?? null,
      done: e.done,
      appOwned: e.source === "ai" || e.source === "todo",
    };
  });

  // The app's own calendars ("Auto-added", "To-Do") are shown as their App sources instead.
  const hiddenCals = new Set(await appCalendarIds());
  const sources: SourceInfo[] = [
    ...cals.filter(({ cal }) => !hiddenCals.has(cal.googleCalendarId)).map(({ cal, email }) => ({
      key: `cal:${cal.id}`,
      label: calendarLabel(cal.summary, cal.isPrimary, email),
      group: email,
      color: paletteColorFor(cal.colorHex),
    })),
    ...FIXED_SOURCES,
  ];

  const last = await lastCalendarSync();
  return { events: out, sources, lastSync: last?.toISOString() ?? null, demo: false };
}

function demoResponse(from: Date, to: Date): EventsResponse {
  const groups: Record<string, string> = {};
  const evs: CalendarEvent[] = demoEvents()
    .filter((d) => d.startAt < to && d.endAt > from)
    .map((d, i) => {
      const key = d.source === "google" ? `cal:${d.sourceLabel}` : d.source;
      if (d.source === "google") groups[key] = d.sourceLabel;
      const palette = ["#3b6fe0", "#14958a", "#2b8fd6", "#3a9a5b", "#1e3a8a"];
      const color =
        d.source === "google"
          ? palette[Object.keys(groups).indexOf(key) % palette.length]
          : SOURCE_COLORS[d.source];
      return {
        id: `demo-${i}`,
        source: d.source,
        sourceKey: key,
        title: d.title,
        start: d.startAt.toISOString(),
        end: d.endAt.toISOString(),
        allDay: d.allDay,
        location: d.location ?? null,
        description: d.description ?? null,
        status: "confirmed",
        sourceLabel: d.sourceLabel,
        color,
        htmlLink: null,
        aiGuessed: !!d.aiGuessed,
        aiConfidence: d.aiConfidence ?? null,
        aiQuote: d.aiQuote ?? null,
        gmailLink: d.source === "ai" ? "https://mail.google.com/" : null,
        meta: d.meta ?? null,
        done: !!d.done,
        appOwned: d.source === "ai" || d.source === "todo",
      };
    });
  const palette = ["#3b6fe0", "#14958a", "#2b8fd6", "#3a9a5b", "#1e3a8a"];
  const sources: SourceInfo[] = [
    ...Object.keys(groups).map((k, i) => {
      const [cal, acc] = groups[k].split(" · ").reverse();
      return { key: k, label: cal, group: acc ?? "Demo", color: palette[i % palette.length] };
    }),
    ...FIXED_SOURCES,
  ];
  return { events: evs, sources, lastSync: new Date(Date.now() - 120_000).toISOString(), demo: true };
}
