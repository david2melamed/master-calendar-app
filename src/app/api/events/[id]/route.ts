import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { deleteAiEvent } from "@/lib/pipeline/manage";

/** DELETE /api/events/:id — only events the app created (AI). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const r = await deleteAiEvent(id);
  if (r === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
  if (r === "not_allowed") return NextResponse.json({ error: "only app-created events can be deleted here" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
