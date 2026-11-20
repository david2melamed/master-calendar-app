import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull, lt, ne } from "drizzle-orm";
import type { Extraction, ExtractedEvent } from "@/lib/ai/schema";
import { getDb } from "@/lib/db/client";
import { events, pendingConflicts } from "@/lib/db/schema";
import { isProbableDuplicate, overlaps, titleSimilarity, type Slot } from "@/lib/events/similarity";
import { deleteAppEvent, ensureAppCalendar, upsertAppEvent } from "@/lib/google/app-calendar";
import { logActivity } from "@/lib/status";
import { dateKeyET, fmtET } from "@/lib/time";
import { eventTimes, type Times } from "./when";

/**
 * Apply what the AI found in one email to your calendar.
 * Philosophy: when in doubt, add it (and mark it AI-guessed).
 */
export type EmailContext = {
  mailbox: string; // which inbox it arrived in
  messageId: string;
  threadId: string | null;
  from: string; // sender address
  subject: string;
};

export type ApplyResult = { added: number; updated: number; cancelled: number; duplicates: number; skipped: number };

const GUESS_BELOW = 0.8;
type EventRow = typeof events.$inferSelect;

export const mcIdFor = (mailbox: string, messageId: string, i: number) =>
  createHash("sha256").update(`${mailbox}:${messageId}:${i}`).digest("hex").slice(0, 24);

export const gmailLink = (mailbox: string, messageId: string) =>
  `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailbox)}#all/${messageId}`;

export async function applyExtraction(ctx: EmailContext, x: Extraction): Promise<ApplyResult> {
  const r: ApplyResult = { added: 0, updated: 0, cancelled: 0, duplicates: 0, skipped: 0 };
  if (x.kind === "none" || !x.events.length) return r;

  for (const [i, ev] of x.events.slice(0, 10).entries()) {
    const t = eventTimes(ev);
    if (!t) {
      r.skipped++;
      continue;
    }
    // Ignore things that are already over.
    if (+t.end < Date.now()) {
      r.skipped++;
      continue;
    }

    if (ev.action === "cancel") {
      const target = await findTarget(ctx, ev, t);
      if (target) {
        await cancelAppEvent(target);
        await logActivity("ai", `Removed “${target.title}” — cancelled in an email from ${ctx.from}`, { eventId: target.id });
        r.cancelled++;
      } else {
        r.skipped++;
      }
      continue;
    }

    if (ev.action === "update") {
      const target = await findTarget(ctx, ev, t);
      if (target) {
        await writeEvent(ctx, ev, t, target.externalKey);
        await logActivity("ai", `Updated “${ev.title}” (${when(t)}) from an email from ${ctx.from}`, { eventId: target.id });
        r.updated++;
        continue;
      }
      // Nothing to update → treat it as new (when in doubt, add).
    }

    const dup = await findDuplicate(ev.title, t);
    if (dup) {
      r.duplicates++;
      continue;
    }
    const row = await writeEvent(ctx, ev, t, mcIdFor(ctx.mailbox, ctx.messageId, i));
    const guessed = ev.confidence < GUESS_BELOW;
    await logActivity(
      "ai",
      `Added “${ev.title}” (${when(t)})${guessed ? " · AI-guessed" : ""} from an email from ${ctx.from}`,
      { eventId: row.id },
    );
    await queueConflicts(row);
    r.added++;
  }
  return r;
}

const when = (t: Times) =>
  t.allDay ? fmtET(t.start, "EEE MMM d") : fmtET(t.start, "EEE MMM d, h:mm a");

/** Create/update the Google event (in "Auto-added") and our row. Idempotent via mcId. */
async function writeEvent(ctx: EmailContext, ev: ExtractedEvent, t: Times, mcId: string): Promise<EventRow> {
  const cal = await ensureAppCalendar("Auto-added");
  const guessed = ev.confidence < GUESS_BELOW;
  const link = gmailLink(ctx.mailbox, ctx.messageId);
  const description = [
    ev.details,
    "",
    `Added by Master Calendar from an email from ${ctx.from}${guessed ? " (AI-guessed — please check)" : ""}.`,
    `“${ev.quote}”`,
    link,
  ]
    .filter((l) => l !== null && l !== undefined)
    .join("\n");

  const g = await upsertAppEvent(
    cal,
    { mcId, title: ev.title, description, location: ev.location, start: t.start, end: t.end, allDay: t.allDay },
    dateKeyET,
  );

  const db = await getDb();
  const values = {
    source: "ai" as const,
    externalKey: mcId,
    accountId: cal.account.id,
    googleEventId: g.id ?? null,
    title: ev.title,
    description: ev.details,
    location: ev.location,
    startAt: t.start,
    endAt: t.end,
    allDay: t.allDay,
    status: "confirmed" as const,
    htmlLink: g.htmlLink ?? null,
    aiConfidence: ev.confidence,
    aiGuessed: guessed,
    aiQuote: ev.quote.slice(0, 500),
    gmailMessageId: ctx.messageId,
    gmailLink: link,
    meta: { mcId, threadId: ctx.threadId, from: ctx.from, mailbox: ctx.mailbox, ...(ev.is_deadline ? { deadline: 1 } : {}) },
    deletedAt: null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(events)
    .values(values)
    .onConflictDoUpdate({ target: [events.source, events.externalKey], set: values })
    .returning();
  return row;
}

async function cancelAppEvent(target: EventRow) {
  if (target.googleEventId) await deleteAppEvent(await ensureAppCalendar("Auto-added"), target.googleEventId);
  const db = await getDb();
  await db.update(events).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(events.id, target.id));
}

/** Live events near this time (all sources), for duplicate / conflict checks. */
async function nearby(t: Times, padMs = 36 * 3600_000): Promise<EventRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(events)
    .where(
      and(
        isNull(events.deletedAt),
        ne(events.status, "cancelled"),
        lt(events.startAt, new Date(+t.end + padMs)),
        gt(events.endAt, new Date(+t.start - padMs)),
      ),
    )
    .limit(500);
}

const slot = (e: EventRow): Slot => ({ title: e.title, start: e.startAt, end: e.endAt, allDay: e.allDay });

async function findDuplicate(title: string, t: Times): Promise<EventRow | null> {
  const me: Slot = { title, ...t };
  return (await nearby(t)).find((e) => isProbableDuplicate(me, slot(e), dateKeyET)) ?? null;
}

/**
 * Which earlier app-created event does an update/cancel refer to?
 * Same email thread + some title overlap, or a strong title match. Only
 * events this app created are ever changed (your own calendars are read-only).
 */
async function findTarget(ctx: EmailContext, ev: ExtractedEvent, t: Times): Promise<EventRow | null> {
  const db = await getDb();
  const candidates = await db
    .select()
    .from(events)
    .where(and(eq(events.source, "ai"), isNull(events.deletedAt), gt(events.endAt, new Date(Date.now() - 86400_000))))
    .limit(500);
  let best: { row: EventRow; score: number } | null = null;
  for (const c of candidates) {
    const sim = Math.max(titleSimilarity(ev.refers_to ?? "", c.title), titleSimilarity(ev.title, c.title));
    const sameThread = !!ctx.threadId && (c.meta as { threadId?: string } | null)?.threadId === ctx.threadId;
    const ok = (sameThread && sim >= 0.3) || sim >= 0.6;
    const score = sim + (sameThread ? 0.5 : 0) - Math.abs(+c.startAt - +t.start) / (30 * 86400_000);
    if (ok && (!best || score > best.score)) best = { row: c, score };
  }
  return best?.row ?? null;
}

/** Remember overlaps with your other timed events; they go out in one batched email. */
async function queueConflicts(row: EventRow) {
  if (row.allDay || +row.startAt === +row.endAt) return; // all-day & deadlines don't "clash"
  const me = slot(row);
  const clashes = (await nearby({ start: row.startAt, end: row.endAt, allDay: false }, 0)).filter(
    (e) => e.id !== row.id && e.source !== "blackbaud" && overlaps(me, slot(e)),
  );
  if (!clashes.length) return;
  const db = await getDb();
  await db.insert(pendingConflicts).values({
    eventId: row.id,
    conflictsWith: clashes.slice(0, 5).map((c) => ({ title: c.title, start: c.startAt.toISOString(), end: c.endAt.toISOString() })),
  });
}
