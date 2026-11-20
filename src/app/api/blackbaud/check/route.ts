import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { syncBlackbaud } from "@/lib/blackbaud/sync";
import { env } from "@/lib/env";

/** POST /api/blackbaud/check — the "Check now" button on Settings. Full re-download. */
export async function POST() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let q = "bb=ok";
  try {
    await syncBlackbaud({ force: true });
  } catch {
    q = "bb=error"; // details are on the Status page
  }
  return NextResponse.redirect(new URL(`/settings?${q}`, env().APP_URL), 303);
}
