import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createPgliteDb, getDb, type DB } from "@/lib/db/client";
import { accounts, events } from "@/lib/db/schema";
import { parseQuickAdd } from "@/lib/todo/nl-date";
import { createTodo, rollover, updateTodo, deleteTodo } from "@/lib/todo/service";
import { fmtET } from "@/lib/time";

const google = vi.hoisted(() => ({ upserts: [] as { title: string }[], deletes: 0 }));
vi.mock("@/lib/google/app-calendar", () => ({
  ensureAppCalendar: async () => ({ account: { id: "00000000-0000-0000-0000-000000000001" }, calendarId: "todo" }),
  upsertAppEvent: async (_c: unknown, ev: { mcId: string; title: string }) => {
    google.upserts.push(ev);
    return { id: `g-${ev.mcId}` };
  },
  deleteAppEvent: async () => {
    google.deletes++;
  },
  appCalendarIds: async () => [],
}));

// Thursday Nov 19, 2026, 3:00 PM Eastern
const NOW = new Date("2026-11-19T20:00:00Z");
const p = (s: string) => {
  const r = parseQuickAdd(s, NOW);
  return { title: r.title, due: r.dueAt ? fmtET(r.dueAt, "EEE MMM d HH:mm") : null };
};

describe("quick-add dates", () => {
  it("weekday names → the next one, due 11:59 PM", () => {
    expect(p("essay fri")).toEqual({ title: "essay", due: "Fri Nov 20 23:59" });
    expect(p("call grandma thursday")).toEqual({ title: "call grandma", due: "Thu Nov 26 23:59" }); // "thu" on a Thursday = next week
    expect(p("lab report next fri")).toEqual({ title: "lab report", due: "Fri Nov 27 23:59" });
  });
  it("today / tomorrow / in N days / dates / times", () => {
    expect(p("dentist 4pm")).toEqual({ title: "dentist", due: "Thu Nov 19 16:00" });
    expect(p("tmrw math hw")).toEqual({ title: "math hw", due: "Fri Nov 20 23:59" });
    expect(p("pack in 3 days")).toEqual({ title: "pack", due: "Sun Nov 22 23:59" });
    expect(p("apply by 12/1")).toEqual({ title: "apply", due: "Tue Dec 1 23:59" });
    expect(p("renew passport jan 5 at 9:30am")).toEqual({ title: "renew passport", due: "Tue Jan 5 09:30" }); // next January
    expect(p("buy milk")).toEqual({ title: "buy milk", due: null });
  });
});

describe("Urgent ↔ calendar and rollover", () => {
  beforeAll(async () => {
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: "test-client-id-123",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      SESSION_SECRET: "x".repeat(40),
      TOKEN_ENCRYPTION_KEYS: "1:" + Buffer.alloc(32).toString("base64"),
    });
    (globalThis as unknown as { __mcDb?: Promise<DB> }).__mcDb = createPgliteDb();
    await (await getDb()).insert(accounts).values({ id: "00000000-0000-0000-0000-000000000001", email: "me@gmail.com", role: "personal" });
  }, 30_000);

  const calRow = async (todoId: string) =>
    (await (await getDb()).select().from(events).where(and(eq(events.todoItemId, todoId), isNull(events.deletedAt))))[0];

  it("Urgent items go on the calendar (default today 11:59 PM); others don't", async () => {
    const u = await createTodo({ title: "Essay", section: "urgent" });
    expect(u.dueAt).not.toBeNull();
    expect(fmtET(u.dueAt!, "HH:mm")).toBe("23:59");
    expect(await calRow(u.id)).toMatchObject({ source: "todo", title: "Essay", done: false });
    const l = await createTodo({ title: "Read a book", section: "later" });
    expect(await calRow(l.id)).toBeUndefined();
  });

  it("checking off shows ✓ on Google; moving out of Urgent or deleting removes it", async () => {
    const u = await createTodo({ title: "Call coach", section: "urgent" });
    await updateTodo(u.id, { done: true });
    expect(google.upserts.at(-1)?.title).toBe("✓ Call coach");
    expect((await calRow(u.id))?.done).toBe(true);
    await updateTodo(u.id, { done: false, section: "later" });
    expect(await calRow(u.id)).toBeUndefined();
    const v = await createTodo({ title: "Temp", section: "urgent" });
    const before = google.deletes;
    await deleteTodo(v.id);
    expect(google.deletes).toBe(before + 1);
  });

  it("midnight rollover moves unfinished Urgent items to today and counts overdue days", async () => {
    const old = await createTodo({ title: "Old task", section: "urgent", dueAt: new Date("2026-11-18T04:59:00Z") }); // Nov 17
    const fin = await createTodo({ title: "Finished", section: "urgent", dueAt: new Date("2026-11-18T04:59:00Z") });
    await updateTodo(fin.id, { done: true });
    const r = await rollover(NOW);
    expect(r.rolled).toBeGreaterThanOrEqual(1);
    const row = await calRow(old.id);
    expect(fmtET(row!.startAt, "MMM d HH:mm")).toBe("Nov 19 23:59");
    expect(row!.meta).toMatchObject({ overdueDays: 1 });
    expect((await calRow(fin.id))?.startAt.toISOString()).toBe("2026-11-18T04:59:00.000Z"); // done items stay put
    expect((await rollover(NOW)).rolled).toBe(0); // idempotent within the day
  });
});
