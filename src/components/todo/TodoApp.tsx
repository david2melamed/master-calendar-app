"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { CheckIcon, TrashIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { dateKeyET, etWallTime, fmtET } from "@/lib/time";

type Section = "urgent" | "later" | "list";
type Item = {
  id: string;
  section: Section;
  listId: string | null;
  title: string;
  dueAt: string | null;
  rolledDays: number;
  doneAt: string | null;
};
type List = { id: string; name: string };
type Data = { items: Item[]; lists: List[] };

const KEY = ["todos"];

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) window.location.assign("/login");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** "Today", "Tomorrow", "Fri", "Nov 24", plus time if not 11:59 PM. */
function dueLabel(iso: string): string {
  const d = new Date(iso);
  const k = dateKeyET(d);
  const today = dateKeyET(new Date());
  const tomorrow = dateKeyET(new Date(+etWallTime(today, 12) + 86400_000));
  const day = k === today ? "Today" : k === tomorrow ? "Tomorrow" : +d - Date.now() < 6 * 86400_000 && d > new Date() ? fmtET(d, "EEE") : fmtET(d, "MMM d");
  const hm = fmtET(d, "HH:mm");
  return hm === "23:59" ? day : `${day} ${fmtET(d, "h:mm a")}`;
}

export function TodoApp() {
  const qc = useQueryClient();
  const q = useQuery<Data>({ queryKey: KEY, queryFn: () => api("/api/todos", "GET") });
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const run = async (fn: () => Promise<unknown>, optimistic?: (d: Data) => Data) => {
    setError(null);
    if (optimistic) qc.setQueryData<Data>(KEY, (d) => (d ? optimistic(d) : d));
    try {
      await fn();
    } catch {
      setError("Couldn't save that — please try again.");
    }
    await qc.invalidateQueries({ queryKey: KEY });
    void qc.invalidateQueries({ queryKey: ["events"] }); // Urgent items live on the calendar too
  };
  const patchItem = (id: string, patch: Partial<Item> & { done?: boolean }) =>
    run(
      () => api(`/api/todos/${id}`, "PATCH", patch),
      (d) => ({
        ...d,
        items: d.items.map((i) =>
          i.id === id
            ? { ...i, ...patch, doneAt: patch.done === undefined ? i.doneAt : patch.done ? new Date().toISOString() : null }
            : i,
        ),
      }),
    );
  const add = (text: string, section: Section, listId?: string) =>
    run(() => api("/api/todos", "POST", { text, section, listId }));
  const remove = (id: string) =>
    run(() => api(`/api/todos/${id}`, "DELETE"), (d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));

  if (!q.data) {
    return (
      <Shell>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="mt-6 h-32 w-full rounded-2xl" />
        ))}
      </Shell>
    );
  }

  const { items, lists } = q.data;
  const open = items.filter((i) => !i.doneAt);
  const urgent = open.filter((i) => i.section === "urgent").sort((a, b) => +new Date(a.dueAt!) - +new Date(b.dueAt!));
  const later = open.filter((i) => i.section === "later");
  const done = items.filter((i) => i.doneAt).sort((a, b) => +new Date(b.doneAt!) - +new Date(a.doneAt!));
  const moveTargets = [
    { value: "urgent", label: "Urgent" },
    { value: "later", label: "If I Have Time" },
    ...lists.map((l) => ({ value: `list:${l.id}`, label: l.name })),
  ];
  const row = (i: Item) => (
    <Row key={i.id} item={i} targets={moveTargets} onPatch={(p) => patchItem(i.id, p)} onDelete={() => remove(i.id)} />
  );

  return (
    <Shell>
      {error && <p role="alert" className="mb-4 rounded-xl bg-danger-soft px-4 py-2.5 text-sm text-danger">{error}</p>}

      <Card title="Urgent" hint="On your calendar · unfinished ones roll to tomorrow" accent="#d0475f" count={urgent.length}>
        <AddBox placeholder="Add urgent… try “essay fri” or “call dentist 4pm”" onAdd={(t) => add(t, "urgent")} />
        {urgent.length ? urgent.map(row) : <Empty>Nothing urgent. Nice.</Empty>}
      </Card>

      <Card title="If I Have Time" accent="#3b6fe0" count={later.length}>
        <AddBox placeholder="Add something for later…" onAdd={(t) => add(t, "later")} />
        {later.length ? later.map(row) : <Empty>Empty.</Empty>}
      </Card>

      <h2 className="mb-2 mt-8 text-[13px] font-semibold uppercase tracking-wider text-faint">My Lists</h2>
      {lists.map((l) => {
        const its = open.filter((i) => i.section === "list" && i.listId === l.id);
        return (
          <Card
            key={l.id}
            title={l.name}
            accent="#14958a"
            count={its.length}
            action={
              <button
                type="button"
                aria-label={`Delete list ${l.name}`}
                onClick={() =>
                  window.confirm(`Delete the list “${l.name}” and its items?`) &&
                  run(() => api(`/api/todo-lists/${l.id}`, "DELETE"))
                }
                className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-danger"
              >
                <TrashIcon size={15} />
              </button>
            }
          >
            <AddBox placeholder={`Add to ${l.name}…`} onAdd={(t) => add(t, "list", l.id)} />
            {its.length ? its.map(row) : <Empty>Empty.</Empty>}
          </Card>
        );
      })}
      <AddBox
        placeholder="+ New list (e.g. Groceries, College apps)"
        onAdd={(name) => run(() => api("/api/todo-lists", "POST", { name }))}
        bare
      />

      {done.length > 0 && (
        <div className="mt-8">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="text-[13px] font-semibold uppercase tracking-wider text-faint hover:text-text"
          >
            {showDone ? "▾" : "▸"} Done ({done.length})
          </button>
          {showDone && <div className="mt-2 rounded-2xl border border-border bg-bg">{done.map(row)}</div>}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 md:pb-16">
        <h1 className="mb-5 text-2xl font-semibold tracking-tight">To-Do</h1>
        {children}
      </div>
    </div>
  );
}

function Card(props: { title: string; hint?: string; accent: string; count: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-border bg-bg shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="size-2 rounded-full" style={{ background: props.accent }} />
            {props.title}
            <span className="font-normal text-faint">{props.count}</span>
          </h2>
          {props.hint && <p className="mt-0.5 text-xs text-muted">{props.hint}</p>}
        </div>
        {props.action}
      </div>
      <div className="divide-y divide-border">{props.children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-sm text-faint">{children}</p>;
}

function AddBox({ placeholder, onAdd, bare }: { placeholder: string; onAdd: (text: string) => void; bare?: boolean }) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
  };
  return (
    <form onSubmit={submit} className={bare ? "mt-2" : ""}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        enterKeyHint="done"
        className={`w-full bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-faint focus:bg-surface ${
          bare ? "rounded-2xl border border-dashed border-border" : ""
        }`}
      />
    </form>
  );
}

function Row({
  item: i,
  targets,
  onPatch,
  onDelete,
}: {
  item: Item;
  targets: { value: string; label: string }[];
  onPatch: (p: Partial<Item> & { done?: boolean }) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const done = !!i.doneAt;
  const overdue = !done && i.rolledDays > 0;
  const current = i.section === "list" ? `list:${i.listId}` : i.section;

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark “${i.title}” not done` : `Mark “${i.title}” done`}
        onClick={() => onPatch({ done: !done })}
        className={`flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] transition-colors ${
          done ? "border-accent bg-accent text-white" : "border-border hover:border-accent"
        }`}
      >
        {done && <CheckIcon size={12} className="[stroke-width:3]" />}
      </button>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            defaultValue={i.title}
            onBlur={(e) => {
              setEditing(false);
              const t = e.target.value.trim();
              if (t && t !== i.title) onPatch({ title: t });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded-md bg-surface px-1.5 py-0.5 text-[15px] outline-none ring-1 ring-accent"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={`block w-full truncate text-left text-[15px] ${done ? "text-faint line-through" : ""}`}
          >
            {i.title}
          </button>
        )}
        {(i.dueAt || overdue) && !done && (
          <p className={`mt-0.5 text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}>
            {i.dueAt && dueLabel(i.dueAt)}
            {overdue && ` · overdue ${i.rolledDays} day${i.rolledDays === 1 ? "" : "s"}`}
          </p>
        )}
      </div>

      {!done && i.section === "urgent" && (
        <input
          type="date"
          aria-label="Due date"
          value={i.dueAt ? dateKeyET(new Date(i.dueAt)) : ""}
          onChange={(e) => e.target.value && onPatch({ dueAt: etWallTime(e.target.value, 23, 59).toISOString() })}
          className="w-[7.2rem] shrink-0 rounded-md border border-border bg-transparent px-1.5 py-1 text-xs text-muted"
        />
      )}
      {!done && (
        <select
          aria-label="Move to"
          value={current}
          onChange={(e) => {
            const v = e.target.value;
            onPatch(v.startsWith("list:") ? { section: "list", listId: v.slice(5) } : { section: v as Section });
          }}
          className="w-[6.5rem] shrink-0 truncate rounded-md border border-border bg-transparent px-1.5 py-1 text-xs text-muted"
        >
          {targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.value === current ? t.label : `Move to ${t.label}`}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        aria-label={`Delete “${i.title}”`}
        onClick={onDelete}
        className="shrink-0 rounded-md p-1 text-faint opacity-60 hover:bg-surface-2 hover:text-danger group-hover:opacity-100"
      >
        <TrashIcon size={15} />
      </button>
    </div>
  );
}
