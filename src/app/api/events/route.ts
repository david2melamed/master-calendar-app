import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { eventsInRange } from "@/lib/events/query";

/** GET /api/events?from=ISO&to=ISO → events overlapping that range + legend. */
export async function GET(req: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const from = new Date(req.nextUrl.searchParams.get("from") ?? "");
  const to = new Date(req.nextUrl.searchParams.get("to") ?? "");
  if (isNaN(+from) || isNaN(+to) || to <= from || +to - +from > 400 * 86400_000) {
    return NextResponse.json({ error: "bad range" }, { status: 400 });
  }
  const data = await eventsInRange(from, to);
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
