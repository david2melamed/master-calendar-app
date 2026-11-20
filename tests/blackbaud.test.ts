import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clean, parseBlackbaudIcs } from "@/lib/blackbaud/parse";
import { blackbaudJobKeys } from "@/lib/blackbaud/schedule";
import { getBlackbaudState, syncBlackbaud } from "@/lib/blackbaud/sync";
import { createPgliteDb, getDb, type DB } from "@/lib/db/client";
import { activityLog, events, syncErrors } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

const ics = (...vevents: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Blackbaud//EN", ...vevents, "END:VCALENDAR"].join("\r\n");
const ev = (lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

describe("parsing the Blackbaud feed", () => {
  it("date-only assignments are due at 11:59 PM Eastern on that date", () => {
    const [a] = parseBlackbaudIcs(
      ics(ev(["UID:a1", "DTSTART;VALUE=DATE:20261120", "DTEND;VALUE=DATE:20261121", "SUMMARY:Problem Set 7"])),
    );
    expect(a).toMatchObject({ key: "a1", title: "Problem Set 7", dateOnly: true, startAt: null });
    expect(a.dueAt.toISOString()).toBe("2026-11-21T04:59:00.000Z"); // 11:59 PM EST
  });

  it("real Blackbaud shape: assigned = DTSTART, due = DTEND − 1 day; class split off the title", () => {
    const items = parseBlackbaudIcs(
      ics(
        ev([
          "UID:52ab4c21",
          "DTSTART;VALUE=DATE:20261106",
          "DTEND;VALUE=DATE:20261125",
          "SUMMARY:AP Calculus AB - 1: MQ 11/24/26",
          "STATUS:CONFIRMED",
          "CATEGORIES:podium,events",
        ]),
        ev([
          "UID:e1",
          "DTSTART;VALUE=DATE:20261116",
          "DTEND;VALUE=DATE:20261121",
          "SUMMARY:English Seminar: Film & Lit - 1: Classroom Engagement &amp; Participation",
          "CATEGORIES:podium,events",
        ]),
      ),
    );
    const mq = items.find((i) => i.key === "52ab4c21")!;
    expect(mq.title).toBe("MQ 11/24/26");
    expect(mq.dueAt.toISOString()).toBe("2026-11-25T04:59:00.000Z"); // Nov 24, 11:59 PM EST
    expect(mq.meta).toEqual({ className: "AP Calculus AB - 1", assigned: "2026-11-06" }); // no "podium,events"
    const en = items.find((i) => i.key === "e1")!;
    expect(en.meta.className).toBe("English Seminar: Film & Lit - 1");
    expect(en.title).toBe("Classroom Engagement & Participation");
    expect(en.dueAt.toISOString()).toBe("2026-11-21T04:59:00.000Z"); // Nov 20
  });

  it("handles DST: a date-only item in July is due 11:59 PM EDT", () => {
    const [a] = parseBlackbaudIcs(ics(ev(["UID:s", "DTSTART;VALUE=DATE:20260715", "SUMMARY:Summer reading"])));
    expect(a.dueAt.toISOString()).toBe("2026-07-16T03:59:00.000Z");
  });

  it("timed items: TZID, UTC and floating times all land on the right instant", () => {
    const items = parseBlackbaudIcs(
      ics(
        ev(["UID:t1", "DTSTART;TZID=America/New_York:20261120T090000", "DTEND;TZID=America/New_York:20261120T100000", "SUMMARY:Test"]),
        ev(["UID:t2", "DTSTART:20261120T150000Z", "SUMMARY:Quiz"]),
        ev(["UID:t3", "DTSTART:20261120T083000", "SUMMARY:Floating"]),
        ev(["UID:t4", "DTSTART;TZID=Eastern Standard Time:20261120T120000", "SUMMARY:Windows zone"]),
      ),
    );
    const k = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(k.t1.startAt!.toISOString()).toBe("2026-11-20T14:00:00.000Z");
    expect(k.t1.dueAt.toISOString()).toBe("2026-11-20T15:00:00.000Z"); // due at the end
    expect(k.t2.dueAt.toISOString()).toBe("2026-11-20T15:00:00.000Z");
    expect(k.t3.dueAt.toISOString()).toBe("2026-11-20T13:30:00.000Z"); // floating = ET, not UTC
    expect(k.t4.dueAt.toISOString()).toBe("2026-11-20T17:00:00.000Z"); // unknown zone name → ET
  });

  it("cleans HTML, keeps real extras only, skips cancelled, keys recurrences separately", () => {
    const items = parseBlackbaudIcs(
      ics(
        ev([
          "UID:h1",
          "DTSTART;VALUE=DATE:20261120",
          "SUMMARY:Lab &amp; report <b>draft</b>",
          "DESCRIPTION:<p>Read ch. 4</p><p>Answer Q1&#8211;5</p>",
          "CATEGORIES:AP Physics C",
          "X-BB-POINTS:50",
          "URL:https://school.myschoolapp.com/app/student#assignmentdetail/1",
        ]),
        ev(["UID:c1", "STATUS:CANCELLED", "DTSTART;VALUE=DATE:20261120", "SUMMARY:Gone"]),
        ev(["UID:r", "RECURRENCE-ID;VALUE=DATE:20261120", "DTSTART;VALUE=DATE:20261120", "SUMMARY:Weekly log"]),
        ev(["UID:r", "RECURRENCE-ID;VALUE=DATE:20261127", "DTSTART;VALUE=DATE:20261127", "SUMMARY:Weekly log"]),
      ),
    );
    expect(items.map((i) => i.key).sort()).toEqual(["h1", "r#2026-11-20", "r#2026-11-27"]);
    const h = items.find((i) => i.key === "h1")!;
    expect(h.title).toBe("Lab & report draft");
    expect(h.description).toBe("Read ch. 4\nAnswer Q1–5");
    expect(h.meta).toEqual({ categories: "AP Physics C", "bb-points": "50" });
    expect(h.url).toContain("assignmentdetail");
  });

  it("clean() collapses whitespace and decodes entities", () => {
    expect(clean("  a&nbsp;&nbsp;b<br>c &lt;3 ")).toBe("a b\nc <3");
  });
});

describe("Blackbaud schedule", () => {
  it("one hourly key per ET hour; the 5 PM check only from 5 PM ET on", () => {
    // 4:59 PM EST = 21:59 UTC
    expect(blackbaudJobKeys(new Date("2026-11-20T21:59:00Z"))).toEqual({
      hourly: "blackbaud:2026-11-20T16",
      fivePm: null,
    });
    // 5:00 PM EST
    expect(blackbaudJobKeys(new Date("2026-11-20T22:00:00Z")).fivePm).toBe("blackbaud-5pm:2026-11-20");
    // 11:30 PM EST is still the same ET day (UTC already says the 21st)
    expect(blackbaudJobKeys(new Date("2026-11-21T04:30:00Z")).fivePm).toBe("blackbaud-5pm:2026-11-20");
    // Summer (EDT): 5 PM = 21:00 UTC
    expect(blackbaudJobKeys(new Date("2026-07-15T21:00:00Z")).fivePm).toBe("blackbaud-5pm:2026-07-15");
  });
});

describe("Blackbaud sync", () => {
  const FEED = "webcal://school.example.com/podium/feed/iCal.aspx?z=SECRET123";
  let feed = "";
  let status = 200;
  let etag: string | null = null;
  const seen: { url: string; headers: Record<string, string> }[] = [];

  beforeAll(async () => {
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: "test-client-id-123",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      SESSION_SECRET: "x".repeat(40),
      TOKEN_ENCRYPTION_KEYS: "1:" + Buffer.alloc(32).toString("base64"),
      BLACKBAUD_ICS_URL: FEED,
    });
    (globalThis as unknown as { __mcDb?: Promise<DB> }).__mcDb = createPgliteDb();
    vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers });
      if (etag && init.headers["If-None-Match"] === etag) return new Response(null, { status: 304 });
      return new Response(status === 200 ? feed : "nope", {
        status,
        headers: etag ? { etag } : {},
      });
    });
  }, 30_000);
  afterEach(() => {
    seen.length = 0;
  });

  const live = async () => {
    const db = await getDb();
    return db
      .select()
      .from(events)
      .where(and(eq(events.source, "blackbaud"), isNull(events.deletedAt)));
  };

  it("adds new items, using https instead of webcal", async () => {
    feed = ics(
      ev(["UID:1", "DTSTART;VALUE=DATE:20261118", "DTEND;VALUE=DATE:20261121", "SUMMARY:English - 1: Essay"]),
      ev(["UID:2", "DTSTART;VALUE=DATE:20261121", "SUMMARY:Worksheet"]),
    );
    const r = await syncBlackbaud();
    expect(r).toMatchObject({ status: "updated", added: 2, changed: 0, removed: 0 });
    expect(seen[0].url.startsWith("https://")).toBe(true);
    expect((await live()).map((e) => e.title).sort()).toEqual(["Essay", "Worksheet"]);
  });

  it("is idempotent: the same feed again changes nothing", async () => {
    const r = await syncBlackbaud();
    expect(r.status).toBe("unchanged");
    expect(await live()).toHaveLength(2);
    // Even a forced full re-read (the daily 5 PM check) sees no changes.
    expect(await syncBlackbaud({ force: true })).toMatchObject({ added: 0, changed: 0, removed: 0 });
  });

  it("updates changed items and removes ones gone from the feed", async () => {
    feed = ics(ev(["UID:1", "DTSTART;VALUE=DATE:20261120", "SUMMARY:Essay (final)"]), ev(["UID:3", "DTSTART;VALUE=DATE:20261123", "SUMMARY:Quiz"]));
    const r = await syncBlackbaud();
    expect(r).toMatchObject({ status: "updated", added: 1, changed: 1, removed: 1 });
    const rows = await live();
    expect(rows.map((e) => e.title).sort()).toEqual(["Essay (final)", "Quiz"]);
    const db = await getDb();
    const acts = await db.select().from(activityLog).where(eq(activityLog.kind, "blackbaud"));
    expect(acts.at(-1)?.message).toContain("Quiz");
  });

  it("keeps old assignments that simply aged out of the feed window", async () => {
    // Feed now only covers Nov 23+; "Essay (final)" (Nov 20) aged out, it isn't deleted.
    feed = ics(ev(["UID:3", "DTSTART;VALUE=DATE:20261123", "SUMMARY:Quiz"]), ev(["UID:4", "DTSTART;VALUE=DATE:20261130", "SUMMARY:Project"]));
    const r = await syncBlackbaud();
    expect(r).toMatchObject({ removed: 0, added: 1 });
    expect((await live()).map((e) => e.title).sort()).toEqual(["Essay (final)", "Project", "Quiz"]);
  });

  it("an empty feed never wipes your assignments", async () => {
    feed = ics(ev(["UID:x", "DTSTART;VALUE=DATE:20261201", "SUMMARY:x"]), ev(["UID:y", "DTSTART;VALUE=DATE:20261202", "SUMMARY:y"]), ev(["UID:z", "DTSTART;VALUE=DATE:20261203", "SUMMARY:z"]), ev(["UID:w", "DTSTART;VALUE=DATE:20261204", "SUMMARY:w"]));
    await syncBlackbaud();
    const before = (await live()).length;
    feed = ics();
    await expect(syncBlackbaud()).rejects.toThrow(/empty/);
    expect(await live()).toHaveLength(before);
  });

  it("uses ETag so an unchanged feed is a cheap 304", async () => {
    etag = '"v1"';
    feed = ics(ev(["UID:e", "DTSTART;VALUE=DATE:20261205", "SUMMARY:E"]));
    await syncBlackbaud({ force: true });
    expect((await getBlackbaudState()).etag).toBe('"v1"');
    const r = await syncBlackbaud();
    expect(seen.at(-1)!.headers["If-None-Match"]).toBe('"v1"');
    expect(r.status).toBe("unchanged");
    etag = null;
  });

  it("errors go to the Status page and never contain the secret link", async () => {
    status = 403;
    await expect(syncBlackbaud({ force: true })).rejects.toThrow(/rejected the feed link/);
    const db = await getDb();
    const errs = await db.select().from(syncErrors).where(and(eq(syncErrors.source, "blackbaud"), isNull(syncErrors.resolvedAt)));
    expect(errs).toHaveLength(1);
    expect(errs[0].message).not.toContain("SECRET123");
    expect(errs[0].message).not.toContain("example.com");

    status = 200;
    feed = "<html>Please log in</html>";
    await expect(syncBlackbaud({ force: true })).rejects.toThrow(/didn't return a calendar/);

    // Recovering clears the problem.
    feed = ics(ev(["UID:ok", "DTSTART;VALUE=DATE:20261206", "SUMMARY:OK"]));
    await syncBlackbaud({ force: true });
    const open = await db.select().from(syncErrors).where(and(eq(syncErrors.source, "blackbaud"), isNull(syncErrors.resolvedAt)));
    expect(open).toHaveLength(0);
  });
});
