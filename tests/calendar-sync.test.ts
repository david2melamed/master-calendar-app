import { describe, expect, it } from "vitest";
import { isHolidayCalendar, mapGoogleEvent } from "@/lib/google/calendar-sync";
import { calendarLabel } from "@/lib/events/query";

const cal = { id: "cal-1", accountId: "acc-1" };

describe("mapping Google events", () => {
  it("all-day events use ET midnights with an exclusive end", () => {
    const { key, row } = mapGoogleEvent(
      { id: "e1", summary: "Thanksgiving", start: { date: "2026-11-26" }, end: { date: "2026-11-27" } },
      cal,
    );
    expect(key).toBe("cal-1:e1");
    expect(row).toMatchObject({ allDay: true, title: "Thanksgiving" });
    expect(row!.startAt!.toISOString()).toBe("2026-11-26T05:00:00.000Z");
    expect(row!.endAt!.toISOString()).toBe("2026-11-27T05:00:00.000Z");
  });

  it("timed events keep their exact instants", () => {
    const { row } = mapGoogleEvent(
      {
        id: "e2",
        summary: "Concert",
        start: { dateTime: "2026-11-18T19:00:00-05:00" },
        end: { dateTime: "2026-11-18T23:00:00-05:00" },
        location: "Hall",
      },
      cal,
    );
    expect(row).toMatchObject({ allDay: false, location: "Hall" });
    expect(row!.startAt!.toISOString()).toBe("2026-11-19T00:00:00.000Z");
  });

  it("cancelled and declined events are removed, untitled ones get a placeholder", () => {
    expect(mapGoogleEvent({ id: "x", status: "cancelled" }, cal).row).toBeNull();
    expect(
      mapGoogleEvent(
        {
          id: "y",
          start: { dateTime: "2026-11-18T19:00:00Z" },
          end: { dateTime: "2026-11-18T20:00:00Z" },
          attendees: [{ self: true, responseStatus: "declined" }],
        },
        cal,
      ).row,
    ).toBeNull();
    expect(
      mapGoogleEvent({ id: "z", start: { dateTime: "2026-11-18T19:00:00Z" }, end: { dateTime: "2026-11-18T20:00:00Z" } }, cal)
        .row?.title,
    ).toBe("(No title)");
  });

  it("recognises events this app created (mcId)", () => {
    const { row } = mapGoogleEvent(
      {
        id: "a",
        summary: "From email",
        start: { dateTime: "2026-11-18T19:00:00Z" },
        end: { dateTime: "2026-11-18T20:00:00Z" },
        extendedProperties: { private: { mcId: "abc" } },
      },
      cal,
    );
    expect(row?.meta).toEqual({ mcId: "abc" });
  });
});

describe("calendar labels", () => {
  it("renames the email-named main calendar", () => {
    expect(calendarLabel("you@gmail.com", true, "you@gmail.com")).toBe("Personal");
    expect(calendarLabel("student@school.example.org", true, "student@school.example.org")).toBe("SCHOOL");
    expect(calendarLabel("Family", false, "you@gmail.com")).toBe("Family");
  });
});

describe("holiday calendars", () => {
  it("are recognised so they can be refreshed daily instead of every 10 minutes", () => {
    expect(isHolidayCalendar("en.usa#holiday@group.v.calendar.google.com")).toBe(true);
    expect(isHolidayCalendar("en.jewish#holiday@group.v.calendar.google.com")).toBe(true);
    expect(isHolidayCalendar("family0123@group.calendar.google.com")).toBe(false);
  });
});
