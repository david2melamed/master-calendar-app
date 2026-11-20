import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Scheduled-job endpoints are public URLs, so each one checks for the secret
 * `Authorization: Bearer <CRON_SECRET>` header (cron-job.org and Vercel Cron both send it).
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
