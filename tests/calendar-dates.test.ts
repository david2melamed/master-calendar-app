import { describe, expect, it } from "vitest";
import {
  eventDayKeys,
  fmtTimeRange,
  minutesOfDayET,
  monthMatrix,
  rangeFor,
  shiftKey,
  titleFor,
  weekKeys,
} from "@/lib/calendar/dates";

describe("calendar date math (ET, Sunday-start weeks)", () => {
  it("week of Thu Nov 19 2026 runs Sun 15 → Sat 21", () => {
    expect(weekKeys("2026-11-19")).toEqual([
      "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21",
    ]);
  });

  it("month grid starts on the Sunday before the 1st", () => {
    const m = monthMatrix("2026-11-19");
    expect(m[0][0]).toBe("2026-11-01"); // Nov 1 2026 is a Sunday
    expect(m[5][6]).toBe("2026-12-12");
  });

  it("navigation shifts by the view's period", () => {
    expect(shiftKey("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(shiftKey("2026-11-19", "week", -1)).toBe("2026-11-12");
    expect(shiftKey("2026-11-01", "day", -1)).toBe("2026-10-31");
  });

  it("day range is midnight-to-midnight ET, including the 25-hour DST day", () => {
    const r = rangeFor("2026-11-01", "day");
    expect(r.from.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("titles", () => {
    expect(titleFor("2026-11-19", "day")).toBe("Thursday, November 19");
    expect(titleFor("2026-11-19", "week")).toBe("November 15 – 21, 2026");
    expect(titleFor("2026-12-30", "week")).toBe("Dec 27, 2026 – Jan 2, 2027");
  });

  it("minutes of day are wall-clock ET", () => {
    expect(minutesOfDayET("2026-11-19T21:30:00Z")).toBe(16 * 60 + 30); // 4:30 PM ET
  });

  it("which days an event touches", () => {
    // all-day Fri–Sat (end exclusive Sunday midnight ET)
    expect(eventDayKeys({ start: "2026-11-20T05:00:00Z", end: "2026-11-22T05:00:00Z", allDay: true })).toEqual([
      "2026-11-20",
      "2026-11-21",
    ]);
    // timed event ending exactly at midnight stays on one day
    expect(eventDayKeys({ start: "2026-11-20T03:00:00Z", end: "2026-11-20T05:00:00Z", allDay: false })).toEqual([
      "2026-11-19",
    ]);
    // overnight flight spans two days
    expect(eventDayKeys({ start: "2026-11-20T03:00:00Z", end: "2026-11-20T08:00:00Z", allDay: false })).toEqual([
      "2026-11-19",
      "2026-11-20",
    ]);
  });

  it("time ranges read naturally", () => {
    expect(fmtTimeRange("2026-11-19T14:00:00Z", "2026-11-19T15:30:00Z")).toBe("9 – 10:30 AM");
    expect(fmtTimeRange("2026-11-19T16:30:00Z", "2026-11-19T18:00:00Z")).toBe("11:30 AM – 1 PM");
  });
});
