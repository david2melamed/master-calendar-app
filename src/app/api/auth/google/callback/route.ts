import { NextResponse, type NextRequest } from "next/server";
import { markAccountProblem, saveConnection } from "@/lib/accounts";
import { OAUTH_COOKIE } from "@/lib/auth/oauth-flow";
import { createSession, getSession } from "@/lib/auth/session";
import { verifyOAuthState } from "@/lib/auth/session-token";
import { env } from "@/lib/env";
import { refreshCalendarList } from "@/lib/google/calendar";
import { exchangeCode } from "@/lib/google/oauth";
import { log } from "@/lib/log";
import { recordError } from "@/lib/status";

/** Google sends the browser back here after sign-in or "Connect account". */
export async function GET(req: NextRequest) {
  const to = (path: string) => {
    const res = NextResponse.redirect(new URL(path, req.url));
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth/google" });
    return res;
  };

  const p = req.nextUrl.searchParams;
  const st = await verifyOAuthState(req.cookies.get(OAUTH_COOKIE)?.value, env().SESSION_SECRET);
  if (!st || !p.get("state") || p.get("state") !== st.nonce) {
    log.warn("oauth callback rejected: bad state");
    return to("/login?error=state");
  }
  const purpose = st.purpose as "login" | "connect";

  // The user cancelled, or an administrator blocked the app.
  const err = p.get("error");
  if (err) {
    const subtype = p.get("error_subtype") ?? "";
    log.warn("oauth error from google", { purpose, err, subtype });
    if (purpose === "connect" && st.hint && /admin_policy|org_internal|unauthorized_client/i.test(`${err} ${subtype}`)) {
      await markAccountProblem(st.hint, "blocked", "Blocked by the school's Google admin — send docs/ADMIN-REQUEST.md.");
      return to(`/settings?error=blocked&email=${encodeURIComponent(st.hint)}`);
    }
    return to(purpose === "login" ? "/login?error=cancelled" : "/settings?error=cancelled");
  }

  const code = p.get("code");
  if (!code) return to("/login?error=state");

  let who: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    who = await exchangeCode(code, st.codeVerifier);
  } catch (e) {
    log.error("oauth code exchange failed", { purpose, e });
    return to(purpose === "login" ? "/login?error=google" : "/settings?error=google");
  }

  if (purpose === "login") {
    if (!env().ALLOWED_EMAILS.includes(who.email)) {
      log.warn("sign-in rejected: not on allowlist");
      return to("/login?error=not_allowed");
    }
    await createSession(who.email);
    return to("/");
  }

  // purpose === "connect": only the signed-in owner may connect mailboxes.
  if (!(await getSession())) return to("/login");
  if (!env().CONNECTABLE_EMAILS.includes(who.email)) {
    return to(`/settings?error=not_connectable`);
  }
  if (!who.refreshToken) {
    await recordError(`oauth:${who.email}`, "Google did not return a refresh token");
    return to(`/settings?error=no_refresh_token&email=${encodeURIComponent(who.email)}`);
  }

  const account = await saveConnection({
    email: who.email,
    name: who.name,
    refreshToken: who.refreshToken,
    grantedScopes: who.grantedScopes,
  });
  try {
    await refreshCalendarList(account);
  } catch (e) {
    await recordError(`calendar:${who.email}`, `Could not list calendars: ${e instanceof Error ? e.message : e}`);
  }
  return to(`/settings?connected=${encodeURIComponent(who.email)}`);
}
