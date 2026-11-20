import "server-only";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { buildAuthUrl, newPkce } from "@/lib/google/oauth";
import { signOAuthState } from "./session-token";

/**
 * Both "Sign in" and "Connect account" go through Google's OAuth page and come
 * back to /api/auth/google/callback. We stash a random nonce + PKCE verifier in
 * a short-lived signed cookie and only accept a callback whose `state` matches
 * (prevents CSRF / login-swapping attacks).
 */
export const OAUTH_COOKIE = "mc_oauth";

export type OAuthPurpose = "login" | "connect";

export async function startOAuth(opts: {
  purpose: OAuthPurpose;
  scopes: string[];
  loginHint?: string;
}) {
  const nonce = randomBytes(24).toString("base64url");
  const { codeVerifier, codeChallenge } = await newPkce();
  const cookie = await signOAuthState(
    { nonce, purpose: opts.purpose, codeVerifier, hint: opts.loginHint ?? "" },
    env().SESSION_SECRET,
  );
  const url = buildAuthUrl({
    scopes: opts.scopes,
    state: nonce,
    codeChallenge,
    offline: opts.purpose === "connect",
    loginHint: opts.loginHint,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
