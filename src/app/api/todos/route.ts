import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { parseQuickAdd } from "@/lib/todo/nl-date";
import { createTodo, listTodos } from "@/lib/todo/service";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await listTodos(), { headers: { "Cache-Control": "private, no-store" } });
}

const Body = z.object({
  text: z.string().trim().min(1).max(300),
  section: z.enum(["urgent", "later", "list"]),
  listId: z.string().uuid().nullish(),
});

/** POST { text: "essay fri", section } — the date words become the due date. */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success || (b.data.section === "list" && !b.data.listId)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { title, dueAt } = parseQuickAdd(b.data.text);
  return NextResponse.json(await createTodo({ title, dueAt, section: b.data.section, listId: b.data.listId }));
}
