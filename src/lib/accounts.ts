import "server-only";
import { asc, eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getDb } from "@/lib/db/client";
import { accounts } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { missingScopes, type AccountRole } from "@/lib/google/scopes";
import { oauthClient } from "@/lib/google/oauth";
import { logActivity, recordError, resolveErrors } from "@/lib/status";

export type Account = typeof accounts.$inferSelect;

export function roleForEmail(email: string): AccountRole {
  return email.toLowerCase() === env().PRIMARY_EMAIL ? "personal" : "school";
}

export async function listAccounts(): Promise<Account[]> {
  const db = await getDb();
  return db.select().from(accounts).orderBy(asc(accounts.createdAt));
}

export async function getAccountByEmail(email: string) {
  const db = await getDb();
  const rows = await db.select().from(accounts).where(eq(accounts.email, email.toLowerCase()));
  return rows[0] ?? null;
}

/** Save a successful "Connect account" — the refresh token is encrypted first. */
export async function saveConnection(input: {
  email: string;
  name: string | null;
  refreshToken: string;
  grantedScopes: string[];
}): Promise<Account> {
  const role = roleForEmail(input.email);
  const missing = missingScopes(role, input.grantedScopes);
  const values = {
    email: input.email,
    role,
    displayName: input.name,
    encryptedRefreshToken: encryptSecret(input.refreshToken),
    scopes: input.grantedScopes,
    status: missing.length ? ("missing_scopes" as const) : ("connected" as const),
    statusDetail: missing.length ? `Missing permissions: ${missing.join(", ")}` : null,
    lastConnectedAt: new Date(),
    updatedAt: new Date(),
  };
  const db = await getDb();
  const [row] = await db
    .insert(accounts)
    .values(values)
    .onConflictDoUpdate({ target: accounts.email, set: values })
    .returning();
  if (!missing.length) await resolveErrors(`oauth:${input.email}`);
  await logActivity("account", `Connected ${input.email} (${role})`);
  return row;
}

/** Remember that an account could not be connected (e.g. blocked by a school admin). */
export async function markAccountProblem(
  email: string,
  status: "blocked" | "needs_reconnect" | "error",
  detail: string,
) {
  const db = await getDb();
  const role = roleForEmail(email);
  await db
    .insert(accounts)
    .values({ email, role, status, statusDetail: detail })
    .onConflictDoUpdate({
      target: accounts.email,
      set: { status, statusDetail: detail, updatedAt: new Date() },
    });
  await recordError(`oauth:${email}`, detail);
}

/** An OAuth client that acts as this account (auto-refreshes access tokens). */
export function clientFor(account: Account): OAuth2Client {
  if (!account.encryptedRefreshToken) {
    throw new Error(`${account.email} is not connected`);
  }
  const c = oauthClient();
  c.setCredentials({ refresh_token: decryptSecret(account.encryptedRefreshToken) });
  return c;
}

/** True when Google says the refresh token is dead (revoked/expired). */
export function isInvalidGrant(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  // gaxios errors carry response.data.error === "invalid_grant"
  const data = (e as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error === "invalid_grant" || /invalid_grant/i.test(msg);
}

/**
 * Run a Google API call for an account. If the token is dead, mark the account
 * "needs reconnect" (shown on Status + emailed in a later phase) instead of failing silently.
 */
export async function withAccount<T>(account: Account, fn: (c: OAuth2Client) => Promise<T>): Promise<T> {
  try {
    return await fn(clientFor(account));
  } catch (e) {
    if (isInvalidGrant(e)) {
      await markAccountProblem(
        account.email,
        "needs_reconnect",
        "Google access expired or was revoked. Click Reconnect.",
      );
    }
    throw e;
  }
}
