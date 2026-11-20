import "server-only";
import { gmail, type gmail_v1 } from "@googleapis/gmail";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { listAccounts, withAccount, type Account } from "@/lib/accounts";
import { monthSpend, modeFor, sonnetAllowed, monthKey, CAPS } from "@/lib/ai/budget";
import { extractWithHaiku, extractWithSonnet, needsSecondPass, type EmailInput } from "@/lib/ai/extract";
import { getDb } from "@/lib/db/client";
import { accounts, processedMessages, senderRules } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { runOnce } from "@/lib/jobs/runner";
import { log } from "@/lib/log";
import { sendToSelf } from "@/lib/mail/send";
import { applyExtraction } from "@/lib/pipeline/apply";
import { recordError, resolveErrors } from "@/lib/status";
import { cleanBody, htmlToPlain } from "./clean-body";
import { bareAddress, skipReason, type SenderRule } from "./filter";

/**
 * Gmail → AI pipeline, run by the 5-minute heartbeat (no Pub/Sub, no card).
 *  1. discover: ask Gmail what arrived since last time (history API) and
 *     queue each new message id in processed_messages (unique → never twice).
 *  2. process: for a few queued messages, apply the free filters, then ask
 *     Claude, then add events. Stops before the time limit; the rest wait
 *     for the next run.
 */
const READ = "https://www.googleapis.com/auth/gmail.readonly";
const MAX_ATTEMPTS = 3;
const STALE_DAYS = 7;

const api = (auth: Parameters<typeof gmail>[0]["auth"]) => gmail({ version: "v1", auth });

export type PollSummary = { mailboxes: number; queued: number; processed: number; skipped: number; added: number; errors: number; ai: string };

export async function pollGmail({ deadline }: { deadline: number }): Promise<PollSummary> {
  const s: PollSummary = { mailboxes: 0, queued: 0, processed: 0, skipped: 0, added: 0, errors: 0, ai: "" };
  const mailboxes = (await listAccounts()).filter(
    (a) => a.encryptedRefreshToken && a.status === "connected" && a.scopes.includes(READ),
  );
  for (const acc of mailboxes) {
    try {
      s.queued += await discover(acc);
      s.mailboxes++;
      await resolveErrors(`gmail:${acc.email}`);
    } catch (e) {
      s.errors++;
      await recordError(`gmail:${acc.email}`, `Couldn't check the inbox: ${errMsg(e)}`);
    }
  }
  if (!env().ANTHROPIC_API_KEY) {
    s.ai = "no API key";
    return s;
  }
  const r = await processQueue({ deadline, byId: new Map(mailboxes.map((a) => [a.id, a])) });
  return { ...s, ...r };
}

// ---------- 1. discover ----------

async function discover(acc: Account): Promise<number> {
  return withAccount(acc, async (auth) => {
    const g = api(auth);
    let ids: { id: string; threadId: string | null }[] = [];
    let newHistoryId: string | null = null;

    if (!acc.gmailHistoryId) {
      // First run: start from now, and look back 2 days so nothing recent is missed.
      const profile = await g.users.getProfile({ userId: "me" });
      newHistoryId = profile.data.historyId ?? null;
      ids = await recent(g, "2d");
    } else {
      try {
        let pageToken: string | undefined;
        do {
          const res = await g.users.history.list({
            userId: "me",
            startHistoryId: acc.gmailHistoryId,
            historyTypes: ["messageAdded"],
            labelId: "INBOX",
            maxResults: 500,
            pageToken,
          });
          for (const h of res.data.history ?? [])
            for (const m of h.messagesAdded ?? [])
              if (m.message?.id) ids.push({ id: m.message.id, threadId: m.message.threadId ?? null });
          newHistoryId = res.data.historyId ?? newHistoryId;
          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      } catch (e) {
        if ((e as { code?: number }).code !== 404) throw e;
        // Our bookmark is too old for Gmail: catch up on the last 3 days instead.
        log.warn("gmail history expired, catching up", { mailbox: acc.email });
        const profile = await g.users.getProfile({ userId: "me" });
        newHistoryId = profile.data.historyId ?? null;
        ids = await recent(g, "3d");
      }
    }

    const db = await getDb();
    let queued = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const rows = await db
        .insert(processedMessages)
        .values(ids.slice(i, i + 200).map((m) => ({ accountId: acc.id, messageId: m.id, threadId: m.threadId })))
        .onConflictDoNothing()
        .returning({ id: processedMessages.id });
      queued += rows.length;
    }
    if (newHistoryId && newHistoryId !== acc.gmailHistoryId) {
      await db.update(accounts).set({ gmailHistoryId: newHistoryId, updatedAt: new Date() }).where(eq(accounts.id, acc.id));
    }
    return queued;
  });
}

async function recent(g: gmail_v1.Gmail, window: string) {
  const res = await g.users.messages.list({ userId: "me", q: `in:inbox newer_than:${window}`, maxResults: 100 });
  return (res.data.messages ?? []).filter((m) => m.id).map((m) => ({ id: m.id!, threadId: m.threadId ?? null }));
}

// ---------- 2. process ----------

async function processQueue({ deadline, byId }: { deadline: number; byId: Map<string, Account> }) {
  const out = { processed: 0, skipped: 0, added: 0, errors: 0, ai: "" };
  const spend = await monthSpend();
  const mode = modeFor(spend);
  out.ai = mode;
  if (mode === "paused") {
    await notifyPausedOnce(spend.total);
    return out;
  }

  const db = await getDb();
  const rules = (await db.select().from(senderRules)) as SenderRule[];
  const staleProcessing = new Date(Date.now() - 10 * 60_000);
  const queue = await db
    .select()
    .from(processedMessages)
    .where(
      and(
        lt(processedMessages.attempts, MAX_ATTEMPTS),
        or(
          inArray(processedMessages.status, ["pending", "error"]),
          and(eq(processedMessages.status, "processing"), lt(processedMessages.updatedAt, staleProcessing)),
        ),
      ),
    )
    .orderBy(asc(processedMessages.createdAt))
    .limit(25);

  for (const item of queue) {
    if (Date.now() > deadline) break;
    const acc = byId.get(item.accountId);
    if (!acc) continue;
    // Claim it (another run might be on it).
    const [claimed] = await db
      .update(processedMessages)
      .set({ status: "processing", attempts: sql`${processedMessages.attempts} + 1`, updatedAt: new Date() })
      // status + attempts unchanged since we read it = nobody else claimed it
      .where(
        and(
          eq(processedMessages.id, item.id),
          eq(processedMessages.status, item.status),
          eq(processedMessages.attempts, item.attempts),
        ),
      )
      .returning({ id: processedMessages.id });
    if (!claimed) continue;

    try {
      const r = await processOne(acc, item.messageId, item.threadId, rules);
      await db
        .update(processedMessages)
        .set({ status: r.status, outcome: r.outcome, receivedAt: r.receivedAt, updatedAt: new Date() })
        .where(eq(processedMessages.id, item.id));
      if (r.status === "skipped") out.skipped++;
      else out.processed++;
      out.added += r.added;
    } catch (e) {
      out.errors++;
      const msg = errMsg(e);
      await db
        .update(processedMessages)
        .set({ status: "error", outcome: msg.slice(0, 300), updatedAt: new Date() })
        .where(eq(processedMessages.id, item.id));
      await recordError("email-ai", `An email couldn't be processed (will retry): ${msg}`);
    }
  }
  if (!out.errors && queue.length) await resolveErrors("email-ai");
  return out;
}

type Outcome = { status: "done" | "skipped"; outcome: string; added: number; receivedAt: Date | null };

async function processOne(acc: Account, messageId: string, threadId: string | null, rules: SenderRule[]): Promise<Outcome> {
  const msg = await withAccount(acc, async (auth) =>
    (await api(auth).users.messages.get({ userId: "me", id: messageId, format: "full" })).data,
  );
  const headers = Object.fromEntries((msg.payload?.headers ?? []).map((h) => [String(h.name).toLowerCase(), String(h.value ?? "")]));
  const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : null;
  const parts = flatten(msg.payload);
  const from = bareAddress(headers["from"] ?? "");

  if (receivedAt && Date.now() - +receivedAt > STALE_DAYS * 86400_000) {
    return { status: "skipped", outcome: "stale", added: 0, receivedAt };
  }
  const reason = skipReason(
    { labelIds: msg.labelIds ?? [], headers, mimeTypes: parts.map((p) => p.mimeType ?? ""), from, self: acc.email, subject: headers["subject"] },
    rules,
  );
  if (reason) return { status: "skipped", outcome: `filtered:${reason}`, added: 0, receivedAt };

  const body = cleanBody(bodyText(parts));
  const input: EmailInput = {
    from: headers["from"] ?? from,
    to: headers["to"] ?? acc.email,
    subject: (headers["subject"] ?? "").slice(0, 300),
    sentAt: receivedAt ?? new Date(),
    body,
  };

  // Pass 1: Haiku. Pass 2: Sonnet, only for "possible" emails and only within budget.
  let ai = await extractWithHaiku(input);
  let usedSonnet = false;
  if (needsSecondPass(ai.extraction) && sonnetAllowed(await monthSpend())) {
    ai = await extractWithSonnet(input);
    usedSonnet = true;
  }
  const res = await applyExtraction(
    { mailbox: acc.email, messageId, threadId, from, subject: input.subject },
    ai.extraction,
  );
  const outcome = `ai:${ai.extraction.kind}${usedSonnet ? "+2nd" : ""}${ai.refused ? ":refused" : ""} +${res.added} ~${res.updated} -${res.cancelled} dup${res.duplicates}`;
  return { status: "done", outcome, added: res.added, receivedAt };
}

function flatten(p: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!p) return [];
  return [p, ...(p.parts ?? []).flatMap(flatten)];
}

/** Prefer the plain-text part; fall back to HTML converted to text. */
function bodyText(parts: gmail_v1.Schema$MessagePart[]): string {
  const decode = (p?: gmail_v1.Schema$MessagePart) =>
    p?.body?.data ? Buffer.from(p.body.data, "base64url").toString("utf8") : "";
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data && !p.filename);
  if (plain) return decode(plain);
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data && !p.filename);
  return html ? htmlToPlain(decode(html)) : "";
}

async function notifyPausedOnce(total: number) {
  await runOnce(`ai-paused-email:${monthKey()}`, async () => {
    await sendToSelf(
      "Master Calendar: email AI paused for this month",
      `<p>Your AI spending this month reached <b>$${total.toFixed(2)}</b> (limit $${CAPS.pause.toFixed(2)}), so reading emails for events is paused until next month.</p><p>Your calendars, Blackbaud and To-Do keep working. You can change the limit in <code>src/lib/ai/budget.ts</code>.</p>`,
      `Your AI spending this month reached $${total.toFixed(2)} (limit $${CAPS.pause.toFixed(2)}), so reading emails is paused until next month. Calendars, Blackbaud and To-Do keep working.`,
    );
    return { notified: true };
  }).catch((e) => log.warn("pause email failed", { msg: errMsg(e) }));
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300);
}
