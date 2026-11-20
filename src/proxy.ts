import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session-token";

/**
 * Runs before every request. Anyone without a valid session cookie for an
 * allowlisted email is sent to /login (pages) or gets 401 (API).
 *
 * Public on purpose:
 *  - /login and the OAuth routes (needed to sign in)
 *  - /api/cron/*     → protected by CRON_SECRET inside each route
 *  - /api/webhooks/* → protected by verifying Google's signed JWT inside the route
 *  - PWA files (manifest, icons, service worker)
 * Every private page/API ALSO checks the session itself (defense in depth).
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/privacy",
  "/api/auth/login",
  "/api/auth/google/callback",
  "/api/cron/",
  "/api/webhooks/",
  "/manifest.webmanifest",
  "/icons/",
  "/sw.js",
  "/offline.html",
  "/favicon.ico",
  "/apple-touch-icon",
];

const allowed = () =>
  (process.env.ALLOWED_EMAILS ?? "you@example.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;
  const session = secret
    ? await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret, allowed())
    : null;
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL("/login", req.url);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next.js internals and static assets.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|svg|ico|webp|woff2?|html|js|webmanifest)$).*)"],
};
