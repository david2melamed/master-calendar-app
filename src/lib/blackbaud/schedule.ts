import "server-only";
import { runOnce } from "@/lib/jobs/runner";
import { dateKeyET, inET } from "@/lib/time";
import { getBlackbaudState, syncBlackbaud } from "./sync";

/** Pure: which scheduled Blackbaud checks are due at this instant (ET)? Keys make them run once. */
export function blackbaudJobKeys(at: Date): { hourly: string; fivePm: string | null } {
  const et = inET(at);
  const day = dateKeyET(at);
  const hour = String(et.getHours()).padStart(2, "0");
  return {
    hourly: `blackbaud:${day}T${hour}`,
    // The guaranteed daily check: any tick at or after 5:00 PM ET claims it once per day.
    fivePm: et.getHours() >= 17 ? `blackbaud-5pm:${day}` : null,
  };
}

/**
 * Called by the 5-minute heartbeat. Runs the hourly check once per ET hour and
 * the 5 PM check once per day (a full re-download, ignoring "not modified").
 * If a run fails, the next tick tries again.
 */
export async function runScheduledBlackbaud(at = new Date()) {
  const { hourly, fivePm } = blackbaudJobKeys(at);
  const out: Record<string, unknown> = {};
  if (fivePm) {
    const r = await runOnce(fivePm, () => syncBlackbaud({ force: true }));
    out.fivePm = r.ran ? r.result : "done earlier";
  }
  const r = await runOnce(hourly, () => syncBlackbaud());
  out.hourly = r.ran ? r.result : "done this hour";
  return out;
}

/** When the app is opened: check Blackbaud too, if the last check is over 15 minutes old. */
export async function blackbaudOnOpen() {
  const s = await getBlackbaudState();
  if (s.lastCheckedAt && Date.now() - +new Date(s.lastCheckedAt) < 15 * 60_000) return { skipped: "recent" };
  return syncBlackbaud();
}
