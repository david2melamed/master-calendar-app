import { NextResponse, type NextRequest } from "next/server";
import { roleForEmail } from "@/lib/accounts";
import { startOAuth } from "@/lib/auth/oauth-flow";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { scopesFor } from "@/lib/google/scopes";

/**
 * "Connect account" button → Google consent for that mailbox.
 * /api/accounts/connect?email=student@other-school.example.org
 */
export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.redirect(new URL("/login", req.url));

  const email = (req.nextUrl.searchParams.get("email") ?? "").toLowerCase();
  if (!env().CONNECTABLE_EMAILS.includes(email)) {
    return NextResponse.redirect(new URL("/settings?error=not_connectable", req.url));
  }
  return startOAuth({ purpose: "connect", scopes: scopesFor(roleForEmail(email)), loginHint: email });
}
