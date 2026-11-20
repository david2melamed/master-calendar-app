"use client";
import { keyToDate, todayKey } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/events/types";
import { format } from "date-fns";
import { EventChip } from "./EventCard";
import { TimeGrid } from "./TimeGrid";
import { isTopItem } from "./util";

/** The showpiece: full date header, summary line, pinned items, then the timeline. */
export function DayView({
  dayKey,
  events,
  onSelect,
  onToggleDone,
}: {
  dayKey: string;
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  onToggleDone: (e: CalendarEvent) => void;
}) {
  const top = events.filter(isTopItem);
  const timed = events.filter((e) => !isTopItem(e));
  const nEvents = events.filter((e) => e.source === "google" || e.source === "ai").length;
  const nDue = events.filter((e) => e.source === "blackbaud").length;
  const nTodo = events.filter((e) => e.source === "todo").length;
  const isToday = dayKey === todayKey();
  const d = keyToDate(dayKey);

  const summary = [
    `${nEvents} event${nEvents === 1 ? "" : "s"}`,
    nDue ? `${nDue} due` : null,
    nTodo ? `${nTodo} to-do${nTodo === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 px-4 pb-3 pt-1 sm:px-6">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[22px] font-semibold tracking-tight sm:text-[26px]">
            {format(d, "EEEE")}, <span className="text-muted">{format(d, "MMMM d")}</span>
          </h2>
          {isToday && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Today</span>
          )}
        </div>
        <p className="mt-0.5 text-[13px] text-muted">{events.length ? summary : "Nothing scheduled"}</p>

        {top.length > 0 && (
          <ul className="mt-3 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {top.map((e) => (
              <li key={e.id}>
                <EventChip event={e} onSelect={onSelect} onToggleDone={onToggleDone} />
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col border-t border-border">
        <TimeGrid dayKeys={[dayKey]} events={timed} onSelect={onSelect} scrollKey={`day:${dayKey}`} />
        {events.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl bg-bg/90 px-6 py-5 text-center shadow-md ring-1 ring-border backdrop-blur">
              <p className="text-[15px] font-medium">Nothing scheduled</p>
              <p className="mt-0.5 text-[13px] text-muted">Enjoy the free day.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
