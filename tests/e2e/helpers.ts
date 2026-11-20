import { config } from "dotenv";
import type { BrowserContext } from "@playwright/test";
import { signSession } from "../../src/lib/auth/session-token";

config();

/** Sign the test browser in as the owner (same signing as real sign-in). */
export async function signIn(context: BrowserContext, baseURL: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET missing from .env");
  const value = await signSession({ email: "you@example.com" }, secret);
  await context.addCookies([{ name: "mc_session", value, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}
