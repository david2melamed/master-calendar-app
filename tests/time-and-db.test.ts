import { describe, expect, it } from "vitest";
import { createPgliteDb } from "@/lib/db/client";
import { accounts, events } from "@/lib/db/schema";
import { demoEvents } from "@/demo/seed";
import { dateKeyET, endOfDayDeadlineET, etWallTime, fmtET, nextDateKey } from "@/lib/time";

describe("Eastern Time helpers (server runs in UTC)", () => {
  it("11:59 PM ET deadline is correct in winter (EST, UTC-5)", () => {
    expect(endOfDayDeadlineET("2026-11-20").toISOString()).toBe("2026-11-21T04:59:00.000Z");
  });

  it("11:59 PM ET deadline is correct in summer (EDT, UTC-4)", () => {
    expect(endOfDayDeadlineET("2026-07-01").toISOString()).toBe("2026-07-02T03:59:00.000Z");
  });

  it("5:00 PM ET is right on both sides of the DST change", () => {
    expect(etWallTime("2026-03-07", 17).toISOString()).toBe("2026-03-07T22:00:00.000Z");
    expect(etWallTime("2026-03-09", 17).toISOString()).toBe("2026-03-09T21:00:00.000Z");
  });

  it("an instant late at night UTC still belongs to the right ET day", () => {
    // 02:30 UTC on Nov 20 = 9:30 PM ET on Nov 19
    expect(dateKeyET(new Date("2026-11-20T02:30:00Z"))).toBe("2026-11-19");
  });

  it("next day across the November DST change", () => {
    expect(nextDateKey("2026-10-31")).toBe("2026-11-01");
    expect(nextDateKey("2026-11-01")).toBe("2026-11-02");
  });

  it("formats in ET", () => {
    expect(fmtET(new Date("2026-11-19T17:00:00Z"), "EEEE, MMMM d, h:mm a")).toBe("Thursday, November 19, 12:00 PM");
  });
});

describe("database", () => {
  it("migrations apply and (source, external_key) prevents duplicate events", async () => {
    const db = await createPgliteDb(); // in-memory
    const [acc] = await db.insert(accounts).values({ email: "a@b.com", role: "personal" }).returning();
    const row = {
      source: "google" as const,
      externalKey: "cal1:evt1",
      accountId: acc.id,
      title: "Test",
      startAt: new Date(),
      endAt: new Date(),
    };
    await db.insert(events).values(row);
    await expect(db.insert(events).values(row)).rejects.toThrow();
    // Upsert path used by sync is idempotent:
    await db.insert(events).values({ ...row, title: "Renamed" }).onConflictDoUpdate({
      target: [events.source, events.externalKey],
      set: { title: "Renamed" },
    });
    const all = await db.select().from(events);
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Renamed");
  }, 30_000);
});

describe("demo data", () => {
  it("generates a busy today with every source type", () => {
    const anchor = etWallTime("2026-11-19", 12);
    const ev = demoEvents(anchor);
    const today = ev.filter((e) => dateKeyET(e.startAt) === "2026-11-19");
    expect(new Set(today.map((e) => e.source))).toEqual(new Set(["google", "ai", "blackbaud", "todo"]));
    expect(today.some((e) => e.aiGuessed)).toBe(true);
    // Unique keys (so seeding twice never duplicates)
    expect(new Set(ev.map((e) => e.externalKey)).size).toBe(ev.length);
  });
});
