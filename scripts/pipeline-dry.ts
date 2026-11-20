/**
 * Dry run of the Gmail → AI pipeline: shows what WOULD be added from recent
 * emails, without writing anything (no calendar events, no queue entries).
 * AI calls are real (and recorded in the monthly budget), unless --no-ai.
 *
 *   npm run pipeline:dry -- --since 3d [--no-ai] [--mailbox you@gmail.com] [--max 30]
 *
 * Prints sender + a shortened subject per email — never email bodies.
 */
import "dotenv/config";
import { gmail } from "@googleapis/gmail";
import { getAccountByEmail, withAccount } from "../src/lib/accounts";
import { monthSpend, sonnetAllowed } from "../src/lib/ai/budget";
import { extractWithHaiku, extractWithSonnet, needsSecondPass } from "../src/lib/ai/extract";
import { env } from "../src/lib/env";
import { cleanBody, htmlToPlain } from "../src/lib/gmail/clean-body";
import { bareAddress, skipReason } from "../src/lib/gmail/filter";
import { eventTimes } from "../src/lib/pipeline/when";
import { fmtET } from "../src/lib/time";

const arg = (name: string, dflt?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? "true") : dflt;
};
const since = arg("since", "3d")!;
const noAi = process.argv.includes("--no-ai");
const max = Number(arg("max", "30"));
const mailbox = arg("mailbox", env().PRIMARY_EMAIL)!;

(async () => {
  const acc = await getAccountByEmail(mailbox);
  if (!acc) throw new Error(`${mailbox} is not connected`);
  let cost = 0;
  const counts: Record<string, number> = {};
  await withAccount(acc, async (auth) => {
    const g = gmail({ version: "v1", auth });
    const list = await g.users.messages.list({ userId: "me", q: `in:inbox newer_than:${since}`, maxResults: max });
    console.log(`${list.data.messages?.length ?? 0} inbox emails in the last ${since} (${mailbox})\n`);
    for (const m of list.data.messages ?? []) {
      const msg = (await g.users.messages.get({ userId: "me", id: m.id!, format: "full" })).data;
      const headers = Object.fromEntries((msg.payload?.headers ?? []).map((h) => [String(h.name).toLowerCase(), String(h.value ?? "")]));
      const flat = (p: typeof msg.payload): NonNullable<typeof msg.payload>[] => (p ? [p, ...(p.parts ?? []).flatMap(flat)] : []);
      const parts = flat(msg.payload);
      const from = bareAddress(headers["from"] ?? "");
      const when = msg.internalDate ? fmtET(Number(msg.internalDate), "MMM d h:mma") : "?";
      const subj = (headers["subject"] ?? "").slice(0, 55);
      const reason = skipReason({ labelIds: msg.labelIds ?? [], headers, mimeTypes: parts.map((p) => p.mimeType ?? ""), from, self: acc.email, subject: headers["subject"] });
      if (reason) {
        counts[`skip ${reason}`] = (counts[`skip ${reason}`] ?? 0) + 1;
        console.log(`· ${when}  ${from.padEnd(32).slice(0, 32)}  SKIP (${reason})`);
        continue;
      }
      counts.toAI = (counts.toAI ?? 0) + 1;
      console.log(`▸ ${when}  ${from.padEnd(32).slice(0, 32)}  “${subj}”`);
      if (noAi) continue;
      const dec = (p?: (typeof parts)[number]) => (p?.body?.data ? Buffer.from(p.body.data, "base64url").toString("utf8") : "");
      const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data && !p.filename);
      const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data && !p.filename);
      const body = cleanBody(plain ? dec(plain) : html ? htmlToPlain(dec(html)) : "");
      const input = { from: headers["from"] ?? from, to: headers["to"] ?? "", subject: headers["subject"] ?? "", sentAt: new Date(Number(msg.internalDate)), body };
      let r = await extractWithHaiku(input);
      cost += r.cost;
      let tag = "haiku";
      if (needsSecondPass(r.extraction) && sonnetAllowed(await monthSpend())) {
        r = await extractWithSonnet(input);
        cost += r.cost;
        tag = `sonnet(${r.model})`;
      }
      console.log(`    ${tag}: ${r.extraction.kind}${r.refused ? " (refused)" : ""}`);
      for (const ev of r.extraction.events) {
        const t = eventTimes(ev);
        const at = !t ? "INVALID DATE" : t.allDay ? fmtET(t.start, "EEE MMM d") + " all-day" : fmtET(t.start, "EEE MMM d h:mma");
        console.log(`      ${ev.action.toUpperCase()} “${ev.title}” — ${at}  conf ${ev.confidence.toFixed(2)}${ev.confidence < 0.8 ? " (AI-guessed)" : ""}`);
      }
    }
  });
  console.log("\nSummary:", counts, noAi ? "" : `AI cost this run: $${cost.toFixed(4)}`);
  process.exit(0);
})().catch((e) => {
  console.error("dry run failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
