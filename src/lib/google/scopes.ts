/**
 * Exactly which Google permissions we ask for. Kept minimal on purpose.
 *  - Sign-in: identity only.
 *  - Personal account: read mail, send notification emails, full calendar (to write "Auto-added"/"To-Do").
 *  - School accounts: READ-ONLY mail + calendar (this is what the IT admin approves).
 */
const G = "https://www.googleapis.com/auth/";

export const LOGIN_SCOPES = ["openid", "email", "profile"];

export const PERSONAL_SCOPES = [
  "openid",
  "email",
  `${G}gmail.readonly`,
  `${G}gmail.send`,
  `${G}calendar`,
];

export const SCHOOL_SCOPES = ["openid", "email", `${G}gmail.readonly`, `${G}calendar.readonly`];

export type AccountRole = "personal" | "school";

export function scopesFor(role: AccountRole): string[] {
  return role === "personal" ? PERSONAL_SCOPES : SCHOOL_SCOPES;
}

/** Google's granular consent lets the user untick boxes — find what's missing. */
export function missingScopes(role: AccountRole, granted: string[]): string[] {
  const have = new Set(granted);
  return scopesFor(role).filter(
    (s) => s.startsWith("https://") && !have.has(s),
  );
}

export function shortScope(s: string): string {
  return s.replace(G, "");
}
