import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { blockSender } from "@/lib/pipeline/manage";

const Body = z.object({ address: z.string().email().max(320) });

/** POST /api/sender-rules { address } — never add events from this sender again. */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await blockSender(parsed.data.address);
  return NextResponse.json({ ok: true });
}
