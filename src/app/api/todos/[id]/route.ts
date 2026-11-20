import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { deleteTodo, updateTodo } from "@/lib/todo/service";

type Ctx = { params: Promise<{ id: string }> };
const Patch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  done: z.boolean().optional(),
  section: z.enum(["urgent", "later", "list"]).optional(),
  listId: z.string().uuid().nullish(),
  dueAt: z.string().datetime().nullish(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const b = Patch.safeParse(await req.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !b.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { dueAt, ...rest } = b.data;
  const item = await updateTodo(id, { ...rest, ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}) });
  return item ? NextResponse.json(item) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  return (await deleteTodo(id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
