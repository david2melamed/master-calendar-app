/**
 * Free filters that run BEFORE any AI call, so newsletters, receipts and
 * calendar invitations never cost anything. Pure function → easy to test.
 */
export type MessageFacts = {
  labelIds: string[];
  headers: Record<string, string>; // lower-cased header names
  /** MIME types of every part, e.g. ["text/plain", "text/html", "text/calendar"]. */
  mimeTypes: string[];
  from: string; // bare lower-case address
  /** The connected mailbox's own address. */
  self: string;
  subject?: string;
};

export type SenderRule = { pattern: string; rule: "allow" | "deny" };

const OTHER_TABS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];

/** Automated senders that never write about your plans. */
const NOREPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|bounce[s]?|notifications?|newsletter|marketing|promo(tions)?|deals|offers|digest|system|alerts?|security)([+@.-]|$)/i;

/** One-time login / verification codes never contain events. */
const LOGIN_CODE = /\b(verification|security|login|log[- ]in|sign[- ]in|confirmation|one[- ]time|access)\s+(code|pin|passcode)\b|\bis your .{0,30}code\b|\bOTP\b/i;

export function senderMatches(from: string, pattern: string): boolean {
  const p = pattern.toLowerCase().trim();
  return p.startsWith("@") ? from.endsWith(p) : from === p;
}

/** Returns why to skip this email, or null to send it to the AI. */
export function skipReason(m: MessageFacts, rules: SenderRule[] = []): string | null {
  const from = m.from.toLowerCase();
  const rule = rules.find((r) => senderMatches(from, r.pattern));
  if (rule?.rule === "deny") return "sender:blocked";
  const allowed = rule?.rule === "allow";

  if (!m.labelIds.includes("INBOX")) return "not-inbox";
  if (m.labelIds.includes("SPAM") || m.labelIds.includes("TRASH")) return "spam";
  if (m.labelIds.includes("DRAFT")) return "draft";
  // Primary tab only (an email with no tab label counts as Primary).
  if (!allowed && OTHER_TABS.some((l) => m.labelIds.includes(l))) return "not-primary";

  // Google Calendar already put invitations on your calendar.
  if (m.mimeTypes.some((t) => t.toLowerCase() === "text/calendar")) return "calendar-invite";
  if (/calendar-notification@google\.com$/.test(from)) return "calendar-invite";

  if (allowed) return null;
  if (m.subject && LOGIN_CODE.test(m.subject)) return "login-code";
  const h = m.headers;
  if (h["list-unsubscribe"] || h["list-id"]) return "mailing-list";
  if (/^(bulk|list|junk)$/i.test(h["precedence"] ?? "")) return "bulk";
  if (h["auto-submitted"] && !/^no$/i.test(h["auto-submitted"])) return "automated";
  if (NOREPLY.test(from.split("@")[0] ?? "")) return "automated-sender";
  return null;
}

/** "Jane Doe <Jane@Example.com>" → "jane@example.com" */
export function bareAddress(header: string): string {
  const m = header.match(/<([^>]+)>/);
  return (m ? m[1] : header).trim().toLowerCase();
}
