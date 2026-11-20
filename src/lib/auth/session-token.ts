import { jwtVerify, SignJWT } from "jose";

/**
 * Signed session tokens (HS256 JWTs) — pure functions with no Next.js imports,
 * so they work in proxy.ts, route handlers, and tests alike.
 */
export const SESSION_COOKIE = "mc_session";
export const SESSION_DAYS = 30;

export type SessionPayload = { email: string };

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience("master-calendar")
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key(secret));
}

/** Returns the payload, or null if missing/expired/tampered. Also re-checks the allowlist. */
export async function verifySession(
  token: string | undefined,
  secret: string,
  allowedEmails: string[],
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      audience: "master-calendar",
    });
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    // Even a validly-signed cookie is rejected if the email was removed from the allowlist.
    if (!email || !allowedEmails.includes(email)) return null;
    return { email };
  } catch {
    return null;
  }
}

/** Short-lived signed blob used to carry OAuth state (nonce, PKCE verifier) across the Google redirect. */
export async function signOAuthState(data: Record<string, string>, secret: string): Promise<string> {
  return new SignJWT(data)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("master-calendar-oauth")
    .setExpirationTime("10m")
    .sign(key(secret));
}

export async function verifyOAuthState(
  token: string | undefined,
  secret: string,
): Promise<Record<string, string> | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      audience: "master-calendar-oauth",
    });
    return payload as unknown as Record<string, string>;
  } catch {
    return null;
  }
}
