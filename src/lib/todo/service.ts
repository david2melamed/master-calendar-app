import "server-only";
import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { events, todoItems, todoLists } from "@/lib/db/schema";
import { deleteAppEvent, ensureAppCalendar, upsertAppEvent } from "@/lib/google/app-calendar";
import { esc, sendToSelf } from "@/lib/mail/send";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { logActivity } from "@/lib/status";
import { dateKeyET, endOfDayDeadlineET, etWallTime, fmtET } from "@/lib/time";

/**
 * To-Do rules:
 *  - Urgent items always have a due time (default: today 11:59 PM) and appear
 *    on your Google Calendar in the app's own "To-Do" calendar.
 *  - Checking an item off (here or on the calendar) updates both.
 *  - Moving an item out of Urgent, or deleting it, removes it from the calendar.
 *  - At midnight, unfinished Urgent items roll to the new day (11:59 PM) and
 *    are marked overdue; a 7 AM email lists them.
 */
export type TodoItem = typeof todoItems.$inferSelect;
export type Section = TodoItem["section"];

const mcId = (id: string) => `todo-${id}`;

export async function listTodos() {
  const db = await getDb();
  const since = new Date(Date.now() - 30 * 86400_000);
  const [items, lists] = await Promise.all([
    db
      .select()
      .from(todoItems)
      .where(sql`${todoItems.doneAt} is null or ${todoItems.doneAt} > ${since.toISOString()}::timestamptz`)
      .orderBy(asc(todoItems.position), asc(todoItems.createdAt)),
    db.select().from(todoLists).orderBy(asc(todoLists.position), asc(todoLists.createdAt)),
  ]);
  return { items, lists };
}

export async function createTodo(input: { title: string; section: Section; listId?: string | null; dueAt?: Date | null }) {
  const db = await getDb();
  const dueAt = input.section === "urgent" ? (input.dueAt ?? endOfDayDeadlineET(dateKeyET(new Date()))) : (input.dueAt ?? null);
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${todoItems.position}), 0)` }).from(todoItems);
  const [item] = await db
    .insert(todoItems)
    .values({
      title: input.title.slice(0, 300),
      section: input.section,
      listId: input.section === "list" ? (input.listId ?? null) : null,
      dueAt,
      position: Number(max) + 1,
    })
    .returning();
  await syncToCalendar(item);
  return item;
}

export async function updateTodo(
  id: string,
  patch: { title?: string; done?: boolean; section?: Section; listId?: string | null; dueAt?: Date | null },
) {
  const db = await getDb();
  const [cur] = await db.select().from(todoItems).where(eq(todoItems.id, id));
  if (!cur) return null;
  const section = patch.section ?? cur.section;
  let dueAt = patch.dueAt !== undefined ? patch.dueAt : cur.dueAt;
  if (section === "urgent" && !dueAt) dueAt = endOfDayDeadlineET(dateKeyET(new Date()));
  const [item] = await db
    .update(todoItems)
    .set({
      title: patch.title?.slice(0, 300) ?? cur.title,
      section,
      listId: section === "list" ? (patch.listId ?? cur.listId) : null,
      dueAt,
      doneAt: patch.done === undefined ? cur.doneAt : patch.done ? (cur.doneAt ?? new Date()) : null,
      // Rescheduling clears the "overdue" count.
      rolledDays: patch.dueAt !== undefined ? 0 : cur.rolledDays,
      updatedAt: new Date(),
    })
    .where(eq(todoItems.id, id))
    .returning();
  await syncToCalendar(item);
  return item;
}

export async function deleteTodo(id: string) {
  const db = await getDb();
  const [item] = await db.delete(todoItems).where(eq(todoItems.id, id)).returning();
  if (item) await removeFromCalendar(item.id);
  return !!item;
}

export async function createList(name: string) {
  const db = await getDb();
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${todoLists.position}), 0)` }).from(todoLists);
  const [l] = await db.insert(todoLists).values({ name: name.slice(0, 80), position: Number(max) + 1 }).returning();
  return l;
}

export async function deleteList(id: string) {
  const db = await getDb();
  await db.delete(todoLists).where(eq(todoLists.id, id)); // items cascade (lists never hold Urgent items)
}

// ---------- calendar bridge ----------

/** Put an Urgent item on the calendar (or take a non-urgent one off). Idempotent. */
export async function syncToCalendar(item: TodoItem) {
  if (item.section !== "urgent" || !item.dueAt) return removeFromCalendar(item.id);
  const db = await getDb();
  const cal = await ensureAppCalendar("To-Do");
  const done = !!item.doneAt;
  const title = `${done ? "✓ " : ""}${item.title}`;
  const g = await upsertAppEvent(
    cal,
    { mcId: mcId(item.id), title, description: "From your Master Calendar To-Do list.", start: item.dueAt, end: item.dueAt, allDay: false },
    dateKeyET,
  );
  const values = {
    source: "todo" as const,
    externalKey: mcId(item.id),
    accountId: cal.account.id,
    googleEventId: g.id ?? null,
    title: item.title,
    startAt: item.dueAt,
    endAt: item.dueAt,
    allDay: false,
    status: "confirmed" as const,
    htmlLink: g.htmlLink ?? null,
    todoItemId: item.id,
    done,
    meta: { mcId: mcId(item.id), todoId: item.id, ...(item.rolledDays ? { overdueDays: item.rolledDays } : {}) },
    deletedAt: null,
    updatedAt: new Date(),
  };
  await db.insert(events).values(values).onConflictDoUpdate({ target: [events.source, events.externalKey], set: values });
}

async function removeFromCalendar(todoId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "todo"), eq(events.externalKey, mcId(todoId)), isNull(events.deletedAt)));
  if (!row) return;
  if (row.googleEventId) await deleteAppEvent(await ensureAppCalendar("To-Do"), row.googleEventId);
  await db.update(events).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(events.id, row.id));
}

// ---------- midnight rollover + 7 AM summary ----------

/** Unfinished Urgent items due before today → due today 11:59 PM, overdue count +1. */
export async function rollover(now = new Date()) {
  const db = await getDb();
  const today = dateKeyET(now);
  const startOfToday = endOfDayDeadlineET(today); // new due time: today 11:59 PM
  const startToday = etWallTime(today); // midnight
  const stale = await db
    .select()
    .from(todoItems)
    .where(and(eq(todoItems.section, "urgent"), isNull(todoItems.doneAt), lt(todoItems.dueAt, startToday)));
  for (const it of stale) {
    const [moved] = await db
      .update(todoItems)
      .set({ dueAt: startOfToday, rolledDays: it.rolledDays + 1, updatedAt: new Date() })
      .where(eq(todoItems.id, it.id))
      .returning();
    try {
      await syncToCalendar(moved);
    } catch (e) {
      log.warn("rollover calendar update failed", { msg: e instanceof Error ? e.message : String(e) });
    }
  }
  if (stale.length) await logActivity("todo", `Moved ${stale.length} unfinished Urgent to-do${stale.length === 1 ? "" : "s"} to today`);
  return { rolled: stale.length };
}

/** 7 AM email listing overdue Urgent items (only if there are any). */
export async function sendOverdueSummary(now = new Date()) {
  const db = await getDb();
  const today = dateKeyET(now);
  const overdue = await db
    .select()
    .from(todoItems)
    .where(
      and(
        eq(todoItems.section, "urgent"),
        isNull(todoItems.doneAt),
        gte(todoItems.rolledDays, 1),
        gte(todoItems.dueAt, endOfDayDeadlineET(today)),
      ),
    );
  if (!overdue.length) return { sent: 0 };
  const line = (i: TodoItem) => `${i.title} — overdue ${i.rolledDays} day${i.rolledDays === 1 ? "" : "s"}`;
  const link = `${env().APP_URL}/todo`;
  await sendToSelf(
    `${overdue.length} overdue to-do${overdue.length === 1 ? "" : "s"} for ${fmtET(now, "EEEE")}`,
    `<p>These Urgent to-dos weren't finished and moved to today:</p><ul>${overdue.map((i) => `<li>${esc(line(i))}</li>`).join("")}</ul><p><a href="${esc(link)}">Open To-Do</a></p>`,
    `These Urgent to-dos weren't finished and moved to today:\n\n${overdue.map((i) => `• ${line(i)}`).join("\n")}\n\n${link}`,
  );
  return { sent: overdue.length };
}
