import { NextResponse } from "next/server";
import { runScheduledBlackbaud } from "@/lib/blackbaud/schedule";
import { pollGmail } from "@/lib/gmail/poll";
import { sendPendingConflicts } from "@/lib/pipeline/conflicts";
import { lastCalendarSync, syncAllCalendars } from "@/lib/google/calendar-sync";
import { isCronAuthorized } from "@/lib/jobs/cron-auth";
import { log } from "@/lib/log";
import { recordError } from "@/lib/status";
import { runOnce } from "@/lib/jobs/runner";
import { inET, dateKeyET } from "@/lib/time";
import { rollover, sendOverdueSummary } from "@/lib/todo/service";
import { emailProblems } from "@/lib/problems";

/**
 * The heartbeat. cron-job.org calls this every 5 minutes (free).
 * Each task decides for itself whether it's due, so extra or missed calls are harmless.
 * Tasks: Google calendars (~10 min), Blackbaud (hourly + guaranteed 5 PM ET),
 * Gmail → AI (every tick), batched conflict emails.
 * To-Do: rollover once per ET day (first tick after midnight); overdue email
 * once per day from 7 AM ET.
 */
const CALENDAR_EVERY_MS = 9 * 60_000; // ~every 10 minutes

export const maxDuration = 60;

async function handle(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const results: Record<string, unknown> = {};

  const started = Date.now();
  // Each task is isolated: one failing never stops the others.
  try {
    const last = await lastCalendarSync();
    if (!last || Date.now() - +last >= CALENDAR_EVERY_MS) {
      results.calendar = await syncAllCalendars();
    } else {
      results.calendar = "not due";
    }
  } catch (e) {
    results.calendar = "error";
    await recordError("cron:calendar", e instanceof Error ? e.message : String(e));
  }

  try {
    results.blackbaud = await runScheduledBlackbaud();
  } catch (e) {
    // Already recorded on the Status page by syncBlackbaud; the next tick retries.
    results.blackbaud = "error";
    log.warn("blackbaud tick failed", { msg: e instanceof Error ? e.message : String(e) });
  }

  try {
    // Leave a safety margin under the 60-second limit; unfinished emails wait for the next tick.
    results.gmail = await pollGmail({ deadline: started + 45_000 });
  } catch (e) {
    results.gmail = "error";
    await recordError("cron:gmail", e instanceof Error ? e.message : String(e));
  }

  try {
    results.conflicts = await sendPendingConflicts();
  } catch (e) {
    results.conflicts = "error";
    await recordError("conflict-email", e instanceof Error ? e.message : String(e));
  }

  try {
    const day = dateKeyET(new Date());
    const r = await runOnce(`rollover:${day}`, () => rollover());
    results.rollover = r.ran ? r.result : "done today";
    if (inET(new Date()).getHours() >= 7) {
      const s = await runOnce(`todo-summary:${day}`, () => sendOverdueSummary());
      results.todoSummary = s.ran ? s.result : "done today";
    }
  } catch (e) {
    results.rollover = "error";
    await recordError("todo", e instanceof Error ? e.message : String(e));
  }

  try {
    // At most one problem email a day (from 8 AM ET).
    if (inET(new Date()).getHours() >= 8) {
      const r = await runOnce(`problems-email:${dateKeyET(new Date())}`, () => emailProblems());
      results.problems = r.ran ? r.result : "done today";
    }
  } catch (e) {
    results.problems = "error";
    log.warn("problem email failed", { msg: e instanceof Error ? e.message : String(e) });
  }

  log.info("cron tick", { results });
  return NextResponse.json({ ok: true, at: new Date().toISOString(), results });
}

export const GET = handle;
export const POST = handle;
