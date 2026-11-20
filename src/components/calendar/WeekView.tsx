"use client";
import { format } from "date-fns";
import { keyToDate, todayKey, weekKeys } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/events/types";
import { EventChip } from "./EventCard";
import { TimeGrid } from "./TimeGrid";
import { isTopItem } from "./util";

/** 7-day time grid with a pinned row for all-day / due / to-do items. */
export function WeekView({
  cursor,
  byDay,
  events,
  onSelect,
  onOpenDay,
  onToggleDone,
}: {
  cursor: string;
  byDay: Map<string, CalendarEvent[]>;
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  onOpenDay: (k: string) => void;
  onToggleDone: (e: CalendarEvent) => void;
}) {
  const days = weekKeys(cursor);
  const today = todayKey();
  const anyTop = days.some((k) => (byDay.get(k) ?? []).some(isTopItem));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-border pr-[var(--sbw,0px)]">
        <div className="w-14 shrink-0 sm:w-16" />
        {days.map((k) => {
          const d = keyToDate(k);
          const isToday = k === today;
          const top = (byDay.get(k) ?? []).filter(isTopItem);
          return (
            <div key={k} className="min-w-0 flex-1 border-l border-border/70 px-1 pb-1.5 first:border-l-0">
              <button
                type="button"
                onClick={() => onOpenDay(k)}
                className="mx-auto flex flex-col items-center rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2"
                aria-label={`Open ${format(d, "EEEE, MMMM d")}`}
              >
                <span className={`text-[11px] font-semibold uppercase tracking-wider ${isToday ? "text-accent" : "text-faint"}`}>
                  {format(d, "EEE")}
                </span>
                <span
                  className={`mt-0.5 flex size-8 items-center justify-center rounded-full text-[17px] font-semibold tabular-nums ${
                    isToday ? "bg-accent text-accent-fg" : "text-text"
                  }`}
                >
                  {format(d, "d")}
                </span>
              </button>
              {anyTop && (
                <ul className="mt-1 flex max-h-24 flex-col gap-0.5 overflow-y-auto">
                  {top.map((e) => (
                    <li key={e.id}>
                      <EventChip event={e} onSelect={onSelect} onToggleDone={onToggleDone} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <TimeGrid dayKeys={days} events={events} onSelect={onSelect} scrollKey={`week:${days[0]}`} />
    </div>
  );
}
