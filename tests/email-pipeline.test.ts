import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { costOf, modeFor, sonnetAllowed } from "@/lib/ai/budget";
import type { Extraction, ExtractedEvent } from "@/lib/ai/schema";
import { createPgliteDb, getDb, type DB } from "@/lib/db/client";
import { accounts, events, pendingConflicts } from "@/lib/db/schema";
import { isProbableDuplicate, overlaps, titleSimilarity } from "@/lib/events/similarity";
import { cleanBody, htmlToPlain, MAX_BODY_CHARS } from "@/lib/gmail/clean-body";
import { bareAddress, skipReason, type MessageFacts } from "@/lib/gmail/filter";
import { applyExtraction } from "@/lib/pipeline/apply";
import { eventTimes } from "@/lib/pipeline/when";
import { dateKeyET } from "@/lib/time";

// Google Calendar is faked: we only check what the app asks it to do.
const google = vi.hoisted(() => ({ upserts: [] as { mcId: string; title: string }[], deletes: [] as string[] }));
vi.mock("@/lib/google/app-calendar", () => ({
  ensureAppCalendar: async () => ({ account: { id: "00000000-0000-0000-0000-000000000001" }, calendarId: "auto" }),
  upsertAppEvent: async (_c: unknown, ev: { mcId: string; title: string }) => {
    google.upserts.push(ev);
    return { id: `g-${ev.mcId}`, htmlLink: `https://calendar.google.com/e/${ev.mcId}` };
  },
  deleteAppEvent: async (_c: unknown, id: string) => {
    google.deletes.push(id);
  },
  appCalendarIds: async () => [],
}));

// ---------- free filters ----------
describe("free filters (before any AI cost)", () => {
  const base: MessageFacts = { labelIds: ["INBOX", "CATEGORY_PERSONAL"], headers: {}, mimeTypes: ["text/plain"], from: "friend@gmail.com", self: "me@gmail.com" };
  const f = (o: Partial<MessageFacts>) => skipReason({ ...base, ...o });

  it("lets a normal Primary email through", () => expect(f({})).toBeNull());
  it("skips other tabs, newsletters, bulk mail, automated senders, invites and login codes", () => {
    expect(f({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] })).toBe("not-primary");
    expect(f({ headers: { "list-unsubscribe": "<mailto:x>" } })).toBe("mailing-list");
    expect(f({ headers: { precedence: "bulk" } })).toBe("bulk");
    expect(f({ from: "no-reply@shop.com" })).toBe("automated-sender");
    expect(f({ mimeTypes: ["text/plain", "text/calendar"] })).toBe("calendar-invite");
    expect(f({ from: "calendar-notification@google.com" })).toBe("calendar-invite");
    expect(f({ subject: "Your Vercel security code: 226498" })).toBe("login-code");
    expect(f({ labelIds: ["SENT"] })).toBe("not-inbox");
  });
  it("does NOT skip human-ish senders like info@ or team@ (when in doubt, read it)", () => {
    expect(f({ from: "info@school.org" })).toBeNull();
    expect(f({ from: "team@club.org" })).toBeNull();
  });
  it("sender rules: deny always skips; allow overrides the tab and list filters", () => {
    expect(skipReason({ ...base, from: "a@spam.com" }, [{ pattern: "@spam.com", rule: "deny" }])).toBe("sender:blocked");
    expect(
      skipReason({ ...base, labelIds: ["INBOX", "CATEGORY_UPDATES"], headers: { "list-id": "x" }, from: "news@school.org" }, [
        { pattern: "news@school.org", rule: "allow" },
      ]),
    ).toBeNull();
  });
  it("parses sender addresses", () => expect(bareAddress('"Jane D" <Jane@Ex.com>')).toBe("jane@ex.com"));
});

describe("email cleaning", () => {
  it("drops quoted replies and signatures", () => {
    const t = cleanBody("See you Friday at 7!\n\n--\nJane\n\nOn Tue, Nov 17, 2026 at 9:00 AM Bob <b@x.com> wrote:\n> old stuff");
    expect(t).toBe("See you Friday at 7!");
  });
  it("strips HTML and quoted blocks, caps length", () => {
    expect(htmlToPlain("<p>Hi&nbsp;there</p><blockquote>old</blockquote><style>p{}</style>")).toBe("Hi there");
    expect(cleanBody("x".repeat(MAX_BODY_CHARS + 500)).length).toBeLessThan(MAX_BODY_CHARS + 30);
  });
});

// ---------- dates ----------
const ev = (o: Partial<ExtractedEvent>): ExtractedEvent => ({
  action: "create",
  title: "Dentist appointment",
  date: "2026-12-01",
  start_time: null,
  end_time: null,
  end_date: null,
  timezone: null,
  end_timezone: null,
  is_deadline: false,
  location: null,
  details: null,
  confidence: 0.95,
  quote: "Dentist Tuesday at 4",
  refers_to: null,
  ...o,
});

describe("turning AI answers into exact times (Eastern)", () => {
  it("timed event; no end → 1 hour", () => {
    const t = eventTimes(ev({ start_time: "16:00" }))!;
    expect(t.start.toISOString()).toBe("2026-12-01T21:00:00.000Z");
    expect(+t.end - +t.start).toBe(3600_000);
  });
  it("deadline without a time → 11:59 PM ET", () => {
    const t = eventTimes(ev({ is_deadline: true }))!;
    expect(t.start.toISOString()).toBe("2026-12-02T04:59:00.000Z");
    expect(t.allDay).toBe(false);
  });
  it("no time → all-day; multi-day uses end_date", () => {
    const t = eventTimes(ev({ end_date: "2026-12-03" }))!;
    expect(t).toMatchObject({ allDay: true });
    expect(dateKeyET(t.end)).toBe("2026-12-04");
  });
  it("end before start is fixed; garbage dates/times are rejected, never guessed", () => {
    const t = eventTimes(ev({ start_time: "19:00", end_time: "09:00" }))!;
    expect(+t.end - +t.start).toBe(3600_000);
    expect(eventTimes(ev({ date: "2026-02-30" }))).toBeNull();
    expect(eventTimes(ev({ date: "next tuesday" }))).toBeNull();
    expect(eventTimes(ev({ start_time: "4pm" }))?.allDay).toBe(true); // unparseable time → treated as no time
  });
  it("local times elsewhere: a 5:50 PM Chicago departure landing 8:40 PM in DC", () => {
    const t = eventTimes(ev({ date: "2026-11-22", start_time: "17:50", end_time: "20:40", timezone: "America/Chicago" }))!;
    expect(t.start.toISOString()).toBe("2026-11-22T23:50:00.000Z"); // 6:50 PM Eastern
    expect(t.end.toISOString()).toBe("2026-11-23T01:40:00.000Z"); // 8:40 PM Eastern
    expect(eventTimes(ev({ start_time: "10:00", timezone: "Not/AZone" }))!.start.toISOString()).toBe("2026-12-01T15:00:00.000Z"); // bad zone → Eastern
  });
  it("DST: a July 9:00 is 13:00 UTC", () => {
    expect(eventTimes(ev({ date: "2026-07-10", start_time: "09:00" }))!.start.toISOString()).toBe("2026-07-10T13:00:00.000Z");
  });
});

describe("similarity, duplicates and overlaps", () => {
  it("scores titles sensibly", () => {
    expect(titleSimilarity("Dentist appointment", "Dentist appt with Dr. Lee")).toBeGreaterThanOrEqual(0.6);
    expect(titleSimilarity("Chem lab report due", "Chemistry lab report")).toBeGreaterThan(0.4);
    expect(titleSimilarity("Soccer practice", "Piano lesson")).toBe(0);
  });
  it("duplicate = similar title AND within 2 hours (or same day for all-day)", () => {
    const a = { title: "Dentist", start: new Date("2026-12-01T21:00:00Z"), end: new Date("2026-12-01T22:00:00Z"), allDay: false };
    expect(isProbableDuplicate(a, { ...a, title: "Dentist appointment", start: new Date("2026-12-01T22:30:00Z") }, dateKeyET)).toBe(true);
    expect(isProbableDuplicate(a, { ...a, start: new Date("2026-12-02T21:00:00Z") }, dateKeyET)).toBe(false);
  });
  it("a shared flight number on the same day means duplicate, even with different titles", () => {
    const mine = { title: "Return flight from Chicago (WN #1199, ORD to DCA)", start: new Date("2026-11-22T23:50:00Z"), end: new Date("2026-11-23T01:40:00Z"), allDay: false };
    const google = { ...mine, title: "Flight to Wash. D.C. (WN 1199)" };
    expect(isProbableDuplicate(mine, google, dateKeyET)).toBe(true);
    expect(isProbableDuplicate(mine, { ...google, title: "Flight to Denver (WN 2746)" }, dateKeyET)).toBe(false);
    expect(isProbableDuplicate({ ...mine, title: "Room 12 study hall" }, { ...google, title: "Room 12 chess club" }, dateKeyET)).toBe(false); // 2 digits isn't a code
  });
  it("only timed events overlap", () => {
    const a = { title: "x", start: new Date(1000), end: new Date(5000), allDay: false };
    expect(overlaps(a, { ...a, start: new Date(4000), end: new Date(9000) })).toBe(true);
    expect(overlaps(a, { ...a, start: new Date(5000), end: new Date(9000) })).toBe(false);
    expect(overlaps(a, { ...a, allDay: true })).toBe(false);
  });
});

describe("budget caps", () => {
  it("prices Haiku and Sonnet correctly", () => {
    expect(costOf("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(costOf("claude-sonnet-5-5", 2000, 300)).toBeCloseTo(0.007);
  });
  it("Sonnet stops at $0.50; Haiku-only at $1.50; paused at $2.00", () => {
    const s = (total: number, sonnet = 0) => ({ total, sonnet, haiku: total - sonnet, calls: 1 });
    expect(sonnetAllowed(s(0.3, 0.2))).toBe(true);
    expect(sonnetAllowed(s(0.6, 0.5))).toBe(false);
    expect(modeFor(s(1.49))).toBe("normal");
    expect(modeFor(s(1.5))).toBe("haiku_only");
    expect(sonnetAllowed(s(1.6, 0.1))).toBe(false);
    expect(modeFor(s(2.0))).toBe("paused");
  });
});

// ---------- applying to the calendar ----------
describe("applying extracted events", () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: "test-client-id-123",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      SESSION_SECRET: "x".repeat(40),
      TOKEN_ENCRYPTION_KEYS: "1:" + Buffer.alloc(32).toString("base64"),
    });
    (globalThis as unknown as { __mcDb?: Promise<DB> }).__mcDb = createPgliteDb();
    await (await getDb())
      .insert(accounts)
      .values({ id: "00000000-0000-0000-0000-000000000001", email: "me@gmail.com", role: "personal" });
  }, 30_000);
  beforeEach(() => {
    google.upserts.length = 0;
    google.deletes.length = 0;
  });

  const ctx = (messageId: string, threadId = "t1") => ({ mailbox: "me@gmail.com", messageId, threadId, from: "mom@gmail.com", subject: "s" });
  const x = (...evs: ExtractedEvent[]): Extraction => ({ kind: "clear", events: evs });
  const liveAi = async () =>
    (await getDb()).select().from(events).where(and(eq(events.source, "ai"), isNull(events.deletedAt)));

  it("adds a new event to Auto-added and marks low confidence as AI-guessed", async () => {
    const r = await applyExtraction(ctx("m1"), x(ev({ title: "Flight to Chicago", start_time: "09:30", confidence: 0.7 })));
    expect(r.added).toBe(1);
    expect(google.upserts).toHaveLength(1);
    const [row] = await liveAi();
    expect(row).toMatchObject({ title: "Flight to Chicago", aiGuessed: true });
    expect(row.gmailLink).toContain("m1");
  });

  it("is idempotent: the same email again creates nothing new", async () => {
    const r = await applyExtraction(ctx("m1"), x(ev({ title: "Flight to Chicago", start_time: "09:30", confidence: 0.7 })));
    expect(r).toMatchObject({ added: 0, duplicates: 1 });
    expect(await liveAi()).toHaveLength(1);
  });

  it("skips duplicates of events already on any calendar", async () => {
    const db = await getDb();
    await db.insert(events).values({
      source: "google",
      externalKey: "cal:dentist",
      title: "Dentist appt",
      startAt: new Date("2026-12-01T21:00:00Z"),
      endAt: new Date("2026-12-01T22:00:00Z"),
    });
    const r = await applyExtraction(ctx("m2"), x(ev({ title: "Dentist appointment", start_time: "16:30" })));
    expect(r.duplicates).toBe(1);
    expect(google.upserts).toHaveLength(0);
  });

  it("updates the earlier event from the same thread", async () => {
    const r = await applyExtraction(
      ctx("m3"),
      x(ev({ action: "update", title: "Flight to Chicago", refers_to: "Flight to Chicago", start_time: "11:00" })),
    );
    expect(r.updated).toBe(1);
    const rows = await liveAi();
    expect(rows).toHaveLength(1);
    expect(rows[0].startAt.toISOString()).toBe("2026-12-01T16:00:00.000Z");
  });

  it("cancels only app-created events", async () => {
    const r = await applyExtraction(ctx("m4"), x(ev({ action: "cancel", title: "Flight", refers_to: "Flight to Chicago" })));
    expect(r.cancelled).toBe(1);
    expect(google.deletes).toHaveLength(1);
    expect(await liveAi()).toHaveLength(0);
    // "Cancel the dentist" can't touch your own Google event.
    const r2 = await applyExtraction(ctx("m5", "t9"), x(ev({ action: "cancel", title: "Dentist appt", refers_to: "Dentist appt" })));
    expect(r2.cancelled).toBe(0);
    expect(google.deletes).toHaveLength(1); // still only the flight
  });

  it("skips events already in the past", async () => {
    const r = await applyExtraction(ctx("m6"), x(ev({ date: "2020-01-01" })));
    expect(r).toMatchObject({ added: 0, skipped: 1 });
  });

  it("queues a conflict when a new timed event overlaps another", async () => {
    const r = await applyExtraction(ctx("m7", "t7"), x(ev({ title: "Orthodontist", start_time: "16:15", end_time: "17:00" })));
    expect(r.added).toBe(1);
    const q = await (await getDb()).select().from(pendingConflicts);
    expect(q).toHaveLength(1);
    expect(q[0].conflictsWith[0].title).toBe("Dentist appt");
  });
});
