import "server-only";
import { and, gt, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { events, pendingConflicts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { esc, sendToSelf } from "@/lib/mail/send";
import { dateKeyET, fmtET } from "@/lib/time";

/**
 * Send ONE email listing every new conflict, once things have been quiet for
 * 3 minutes (so a burst of emails produces one message, not ten).
 */
const QUIET_MS = 3 * 60_000;

export async function sendPendingConflicts(): Promise<{ sent: number } | "none" | "waiting"> {
  const db = await getDb();
  const pending = await db.select().from(pendingConflicts).where(isNull(pendingConflicts.sentAt));
  if (!pending.length) return "none";
  if (pending.some((p) => Date.now() - +p.createdAt < QUIET_MS)) return "waiting";

  // Claim them atomically so two runs can't both send.
  const claimed = await db
    .update(pendingConflicts)
    .set({ sentAt: new Date() })
    .where(and(inArray(pendingConflicts.id, pending.map((p) => p.id)), isNull(pendingConflicts.sentAt)))
    .returning();
  if (!claimed.length) return "none";

  const evs = await db
    .select()
    .from(events)
    .where(and(inArray(events.id, claimed.map((c) => c.eventId)), isNull(events.deletedAt), gt(events.endAt, new Date())));
  const byId = new Map(evs.map((e) => [e.id, e]));
  const items = claimed.filter((c) => byId.has(c.eventId));
  if (!items.length) return { sent: 0 };

  const t = (iso: string | Date) => fmtET(new Date(iso), "EEE MMM d, h:mm a");
  const url = (d: Date) => `${env().APP_URL}/calendar?view=day&date=${dateKeyET(d)}`;
  const lines = items.map((c) => {
    const e = byId.get(c.eventId)!;
    return { e, others: c.conflictsWith, link: url(e.startAt) };
  });

  const subject =
    lines.length === 1
      ? `Calendar conflict: “${lines[0].e.title}” overlaps ${lines[0].others.length === 1 ? `“${lines[0].others[0].title}”` : `${lines[0].others.length} events`}`
      : `${lines.length} calendar conflicts from new emails`;
  const html = `<p>New events from your email overlap things already on your calendar:</p><ul>${lines
    .map(
      ({ e, others, link }) =>
        `<li><b>${esc(e.title)}</b> — ${esc(t(e.startAt))}<br>overlaps ${others
          .map((o) => `<b>${esc(o.title)}</b> (${esc(t(o.start))})`)
          .join(", ")}<br><a href="${esc(link)}">Open that day</a></li>`,
    )
    .join("")}</ul>`;
  const text = lines
    .map(({ e, others, link }) => `• ${e.title} — ${t(e.startAt)}\n  overlaps ${others.map((o) => `${o.title} (${t(o.start)})`).join(", ")}\n  ${link}`)
    .join("\n\n");

  try {
    await sendToSelf(subject, html, `New events from your email overlap things already on your calendar:\n\n${text}`);
  } catch (e) {
    // Put them back so the next run retries.
    await db.update(pendingConflicts).set({ sentAt: null }).where(inArray(pendingConflicts.id, claimed.map((c) => c.id)));
    throw e;
  }
  return { sent: items.length };
}
