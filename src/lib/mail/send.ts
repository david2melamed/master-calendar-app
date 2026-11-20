import "server-only";
import { gmail } from "@googleapis/gmail";
import { env } from "@/lib/env";
import { personalAccount } from "@/lib/google/app-calendar";
import { withAccount } from "@/lib/accounts";
import { log } from "@/lib/log";

/**
 * Send a notification email to YOU, from your own Gmail (gmail.send scope).
 * Only ever sends to your own address.
 */
export async function sendToSelf(subject: string, html: string, text: string) {
  const account = await personalAccount();
  const to = env().PRIMARY_EMAIL;
  const boundary = `mc_${Math.random().toString(36).slice(2)}`;
  const mime = [
    `From: Master Calendar <${account.email}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text, "utf8").toString("base64"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf8").toString("base64"),
    `--${boundary}--`,
  ].join("\r\n");

  await withAccount(account, (auth) =>
    gmail({ version: "v1", auth }).users.messages.send({
      userId: "me",
      requestBody: { raw: Buffer.from(mime, "utf8").toString("base64url") },
    }),
  );
  log.info("notification sent", { subject });
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
