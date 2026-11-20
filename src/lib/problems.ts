import "server-only";
import { and, inArray, isNull, lt } from "drizzle-orm";
import { listAccounts } from "@/lib/accounts";
import { getDb } from "@/lib/db/client";
import { syncErrors } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { esc, sendToSelf } from "@/lib/mail/send";

/**
 * Nothing fails silently: once a day, email a list of problems that have
 * lasted 6+ hours, plus any account that needs reconnecting.
 * (If your personal Google account itself needs reconnecting, the email can't
 * be sent — it's sent from that account — so Settings shows it instead.)
 */
export async function emailProblems(): Promise<{ sent: number }> {
  const db = await getDb();
  const old = await db
    .select()
    .from(syncErrors)
    .where(and(isNull(syncErrors.resolvedAt), isNull(syncErrors.notifiedAt), lt(syncErrors.firstSeenAt, new Date(Date.now() - 6 * 3600_000))));
  const reconnect = (await listAccounts()).filter((a) => a.status === "needs_reconnect" || a.status === "missing_scopes");
  if (!old.length && !reconnect.length) return { sent: 0 };

  const settings = `${env().APP_URL}/settings`;
  const lines = [
    ...reconnect.map((a) => `${a.email}: ${a.statusDetail ?? "needs reconnecting"} → Reconnect in Settings`),
    ...old.map((e) => `${e.source}: ${e.message} (${e.count}×)`),
  ];
  await sendToSelf(
    `Master Calendar: ${lines.length} problem${lines.length === 1 ? "" : "s"} need${lines.length === 1 ? "s" : ""} a look`,
    `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p><a href="${esc(settings)}">Open Settings</a></p>`,
    `${lines.map((l) => `• ${l}`).join("\n")}\n\n${settings}`,
  );
  if (old.length) {
    await db.update(syncErrors).set({ notifiedAt: new Date() }).where(inArray(syncErrors.id, old.map((e) => e.id)));
  }
  return { sent: lines.length };
}
