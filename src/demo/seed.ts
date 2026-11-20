import { addDays, format } from "date-fns";
import { dateKeyET, etWallTime, inET, nowET } from "@/lib/time";

/**
 * Fake data for building/testing the UI without real accounts (DEMO_MODE=1).
 * Generated relative to "today" so the calendar always looks lived-in.
 */
export type DemoEvent = {
  source: "google" | "ai" | "blackbaud" | "todo";
  externalKey: string;
  sourceLabel: string;
  title: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  aiConfidence?: number;
  aiGuessed?: boolean;
  aiQuote?: string;
  meta?: Record<string, unknown>;
  done?: boolean;
};

const P = "you@example.com";
const HS = "student@school.example.org";
const U = "student@other-school.example.org";

export function demoEvents(anchor: Date = nowET()): DemoEvent[] {
  const out: DemoEvent[] = [];
  const day = (offset: number) => format(addDays(inET(anchor), offset), "yyyy-MM-dd");
  const timed = (
    offset: number,
    sh: number,
    sm: number,
    eh: number,
    em: number,
    e: Omit<DemoEvent, "startAt" | "endAt" | "allDay" | "externalKey">,
  ) => {
    const k = day(offset);
    out.push({
      ...e,
      externalKey: `demo:${k}:${e.title}`,
      startAt: etWallTime(k, sh, sm),
      endAt: etWallTime(k, eh, em),
      allDay: false,
    });
  };
  const allDay = (offset: number, e: Omit<DemoEvent, "startAt" | "endAt" | "allDay" | "externalKey">) => {
    const k = day(offset);
    out.push({
      ...e,
      externalKey: `demo:${k}:${e.title}`,
      startAt: etWallTime(k),
      endAt: etWallTime(day(offset + 1)),
      allDay: true,
    });
  };

  for (let w = -3; w <= 6; w++) {
    const o = w * 7;
    timed(o, 8, 0, 9, 15, { source: "google", sourceLabel: `${HS} · Classes`, title: "AP Calculus BC", location: "Room 214" });
    timed(o + 1, 8, 0, 9, 15, { source: "google", sourceLabel: `${HS} · Classes`, title: "AP Physics C", location: "Lab 3" });
    timed(o + 2, 15, 30, 17, 0, { source: "google", sourceLabel: `${HS} · Activities`, title: "Robotics Club", location: "Makerspace" });
    timed(o + 3, 10, 0, 11, 0, { source: "google", sourceLabel: `${U} · Seminars`, title: "Intro to Economics seminar", location: "Zoom" });
  }

  // Today: a busy, realistic day with overlaps to exercise the layout.
  timed(0, 9, 30, 10, 30, { source: "google", sourceLabel: `${P} · Personal`, title: "Coffee with Sam", location: "Blue Bottle" });
  timed(0, 10, 0, 11, 0, {
    source: "ai",
    sourceLabel: P,
    title: "College info session (tentative)",
    aiConfidence: 0.55,
    aiGuessed: true,
    aiQuote: "We'd love to see you at the info session Thursday around 10.",
  });
  timed(0, 13, 0, 14, 0, { source: "google", sourceLabel: `${HS} · Classes`, title: "English Literature", location: "Room 108" });
  timed(0, 16, 0, 17, 0, {
    source: "ai",
    sourceLabel: P,
    title: "Dentist appointment",
    location: "Smile Dental, 42 Main St",
    aiConfidence: 0.94,
    aiQuote: "Your appointment is confirmed for 4:00 PM today.",
  });
  allDay(0, { source: "google", sourceLabel: `${P} · Holidays`, title: "Mom's birthday" });
  timed(0, 23, 59, 23, 59, {
    source: "blackbaud",
    sourceLabel: "Blackbaud",
    title: "Lab report: Projectile Motion",
    meta: { className: "AP Physics C", points: 50, type: "Lab", status: "To do" },
  });
  timed(0, 23, 59, 23, 59, { source: "todo", sourceLabel: "To-Do", title: "Email Mr. Klein about extension", done: false });

  timed(1, 23, 59, 23, 59, {
    source: "blackbaud",
    sourceLabel: "Blackbaud",
    title: "Problem Set 7",
    meta: { className: "AP Calculus BC", points: 20, type: "Homework", status: "To do" },
  });
  timed(2, 18, 30, 20, 0, { source: "google", sourceLabel: `${P} · Personal`, title: "Dinner with family", location: "Home" });
  timed(4, 12, 0, 13, 0, {
    source: "ai",
    sourceLabel: U,
    title: "Scholarship interview",
    aiConfidence: 0.88,
    aiQuote: "Your interview is scheduled for Monday at noon.",
  });
  allDay(5, { source: "google", sourceLabel: `${HS} · Activities`, title: "Field trip: Science Museum" });

  return out.sort((a, b) => +a.startAt - +b.startAt);
}

export const demoTodayKey = () => dateKeyET(Date.now());
