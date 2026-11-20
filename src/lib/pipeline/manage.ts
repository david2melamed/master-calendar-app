import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { events, senderRules } from "@/lib/db/schema";
import { deleteAppEvent, ensureAppCalendar } from "@/lib/google/app-calendar";
import { logActivity } from "@/lib/status";

/** Delete an event the AI added (from Google "Auto-added" too). Never touches your own calendars. */
export async function deleteAiEvent(id: string): Promise<"deleted" | "not_found" | "not_allowed"> {
  const db = await getDb();
  const [row] = await db.select().from(events).where(eq(events.id, id));
  if (!row || row.deletedAt) return "not_found";
  if (row.source !== "ai") return "not_allowed";
  if (row.googleEventId) await deleteAppEvent(await ensureAppCalendar("Auto-added"), row.googleEventId);
  await db.update(events).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(events.id, id));
  await logActivity("ai", `You deleted “${row.title}”`, { eventId: id });
  return "deleted";
}

/** "Ignore this sender": future emails from them skip the AI entirely. */
export async function blockSender(address: string) {
  const pattern = address.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pattern)) throw new Error("not an email address");
  const db = await getDb();
  await db
    .insert(senderRules)
    .values({ pattern, rule: "deny" })
    .onConflictDoUpdate({ target: senderRules.pattern, set: { rule: "deny" } });
  await logActivity("ai", `Emails from ${pattern} will be ignored from now on`);
}
