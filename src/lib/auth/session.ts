import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  signSession,
  verifySession,
  type SessionPayload,
} from "./session-token";

export async function createSession(email: string) {
  const token = await signSession({ email }, env().SESSION_SECRET);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token, env().SESSION_SECRET, env().ALLOWED_EMAILS);
}

/** Use at the top of every page/API that shows private data (defense in depth beyond proxy.ts). */
export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
