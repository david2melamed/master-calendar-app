import { clean } from "@/lib/blackbaud/parse";

/**
 * Turn an email body into short plain text for the AI: HTML stripped,
 * quoted replies and signatures removed, capped in length (cost control).
 * The result is only ever sent to the AI — never logged or stored.
 */
export const MAX_BODY_CHARS = 6000;

export function htmlToPlain(html: string): string {
  return clean(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
      // Gmail / Outlook quoted-reply containers
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, " ")
      .replace(/<div class="gmail_quote"[\s\S]*$/i, " ")
      .replace(/<(tr|h[1-6])[^>]*>/gi, "\n"),
  );
}

export function cleanBody(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    // Stop at the start of a quoted earlier message.
    if (/^On .{4,200}wrote:$/i.test(t)) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i.test(t) && out.length > 3) break;
    // Outlook-style "From: … / Sent: …" header block of a quoted message.
    if (/^From: /i.test(t) && out.length > 3 && lines.slice(i + 1, i + 4).some((l) => /^(Sent|Date): /i.test(l.trim()))) break;
    // Stop at a signature separator.
    if (t === "--" || /^Sent from my (iPhone|iPad|Android)/i.test(t)) break;
    if (t.startsWith(">")) continue; // quoted line
    out.push(lines[i]);
  }
  const joined = out
    .join("\n")
    .replace(/https?:\/\/\S{60,}/g, "[link]") // long tracking URLs waste tokens
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return joined.length > MAX_BODY_CHARS ? `${joined.slice(0, MAX_BODY_CHARS)}\n[…email continues]` : joined;
}
