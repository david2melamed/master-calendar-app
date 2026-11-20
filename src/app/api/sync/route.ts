import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { blackbaudOnOpen } from "@/lib/blackbaud/schedule";
import { lastCalendarSync, syncAllCalendars } from "@/lib/google/calendar-sync";

/**
 * POST /api/sync — called when the app is opened or brought to the front.
 * Skips if we synced in the last minute (the 10-minute background job covers the rest).
 */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.DEMO_MODE === "1") return NextResponse.json({ skipped: "demo" });

  const force = new URL(req.url).searchParams.get("force") === "1";
  const last = await lastCalendarSync();
  if (!force && last && Date.now() - +last < 60_000) {
    return NextResponse.json({ skipped: "recent", lastSync: last.toISOString() });
  }
  // Blackbaud runs alongside; its problems show on the Status page, never block the calendar.
  const [summary, blackbaud] = await Promise.all([syncAllCalendars(), blackbaudOnOpen().catch(() => "error")]);
  const now = await lastCalendarSync();
  return NextResponse.json({ ...summary, blackbaud, lastSync: now?.toISOString() ?? null });
}
