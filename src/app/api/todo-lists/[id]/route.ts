import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { deleteList } from "@/lib/todo/service";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await deleteList(id);
  return NextResponse.json({ ok: true });
}
