"use client";
import { format } from "date-fns";
import { keyToDate, monthMatrix, todayKey, weekNumber } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/events/types";
import { EventChip } from "./EventCard";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_ITEMS = 3;

/** Clean month grid: up to 3 items per day, then "+N more". */
export function MonthView({
  cursor,
  byDay,
  onSelect,
  onOpenDay,
  onOpenWeek,
  onToggleDone,
}: {
  cursor: string;
  byDay: Map<string, CalendarEvent[]>;
  onSelect: (e: CalendarEvent) => void;
  onOpenDay: (k: string) => void;
  onOpenWeek: (k: string) => void;
  onToggleDone: (e: CalendarEvent) => void;
}) {
  const weeks = monthMatrix(cursor);
  const month = keyToDate(cursor).getMonth();
  const today = todayKey();

  return (
    <div className="flex h-full min-h-0 flex-col px-2 pb-2 sm:px-4 sm:pb-4">
      <div className="grid shrink-0 grid-cols-[1.75rem_repeat(7,minmax(0,1fr))] sm:grid-cols-[2.25rem_repeat(7,minmax(0,1fr))]">
        <div />
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-faint">
            <span className="sm:hidden">{d[0]}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-6 overflow-hidden rounded-xl border border-border">
        {weeks.map((week) => (
          <div
            key={week[0]}
            className="grid min-h-0 grid-cols-[1.75rem_repeat(7,minmax(0,1fr))] border-t border-border first:border-t-0 sm:grid-cols-[2.25rem_repeat(7,minmax(0,1fr))]"
          >
            <button
              type="button"
              onClick={() => onOpenWeek(week[0])}
              className="flex items-start justify-center bg-surface pt-2 text-[10.5px] font-medium tabular-nums text-faint transition-colors hover:text-accent"
              aria-label={`Open week ${weekNumber(week[0])}`}
              title="Open week"
            >
              {weekNumber(week[0])}
            </button>
            {week.map((k) => {
              const d = keyToDate(k);
              const inMonth = d.getMonth() === month;
              const items = byDay.get(k) ?? [];
              const extra = items.length - MAX_ITEMS;
              return (
                <div
                  key={k}
                  className={`flex min-h-0 min-w-0 flex-col gap-0.5 border-l border-border p-1 ${inMonth ? "" : "bg-surface/60"}`}
                >
                  <button
                    type="button"
                    onClick={() => onOpenDay(k)}
                    className={`mb-0.5 flex size-6 shrink-0 items-center justify-center self-start rounded-full text-[12.5px] font-semibold tabular-nums transition-colors ${
                      k === today
                        ? "bg-accent text-accent-fg"
                        : inMonth
                          ? "text-text hover:bg-surface-2"
                          : "text-faint hover:bg-surface-2"
                    }`}
                    aria-label={`Open ${format(d, "EEEE, MMMM d")}`}
                  >
                    {format(d, "d")}
                  </button>
                  {/* Phones: dots only. Larger screens: chips. */}
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {items.slice(0, 4).map((e) => (
                      <span key={e.id} className="size-1.5 rounded-full" style={{ background: e.color }} />
                    ))}
                  </div>
                  <div className="hidden min-h-0 flex-col gap-0.5 overflow-hidden sm:flex">
                    {items.slice(0, MAX_ITEMS).map((e) => (
                      <EventChip key={e.id} event={e} onSelect={onSelect} onToggleDone={onToggleDone} showTime />
                    ))}
                    {extra > 0 && (
                      <button
                        type="button"
                        onClick={() => onOpenDay(k)}
                        className="self-start rounded px-1.5 text-[11.5px] font-medium text-muted hover:text-accent"
                      >
                        +{extra} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
