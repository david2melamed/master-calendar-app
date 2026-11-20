"use client";
import { format } from "date-fns";
import { dateToKey, keyToDate, monthMatrix, todayKey } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/events/types";

/** 12 mini-months; each day's dot gets stronger the busier the day is. */
export function YearView({
  cursor,
  byDay,
  onOpenDay,
  onOpenMonth,
}: {
  cursor: string;
  byDay: Map<string, CalendarEvent[]>;
  onOpenDay: (k: string) => void;
  onOpenMonth: (k: string) => void;
}) {
  const year = keyToDate(cursor).getFullYear();
  const today = todayKey();
  const months = Array.from({ length: 12 }, (_, m) => dateToKey(new Date(year, m, 15)));

  return (
    <div className="h-full overflow-y-auto px-4 pb-8 sm:px-6">
      <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 xl:grid-cols-4">
        {months.map((mk) => {
          const month = keyToDate(mk).getMonth();
          return (
            <section key={mk} className="min-w-0">
              <button
                type="button"
                onClick={() => onOpenMonth(mk)}
                className={`mb-1.5 rounded-md px-1 text-[14px] font-semibold transition-colors hover:text-accent ${
                  keyToDate(today).getMonth() === month && keyToDate(today).getFullYear() === year ? "text-accent" : ""
                }`}
              >
                {format(keyToDate(mk), "MMMM")}
              </button>
              <div className="grid grid-cols-7 gap-y-0.5 text-center">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <span key={i} className="text-[10px] font-semibold text-faint">
                    {d}
                  </span>
                ))}
                {monthMatrix(mk)
                  .flat()
                  .map((k) => {
                    const inMonth = keyToDate(k).getMonth() === month;
                    if (!inMonth) return <span key={k} />;
                    const n = (byDay.get(k) ?? []).length;
                    const level = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : 3;
                    const isToday = k === today;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => onOpenDay(k)}
                        aria-label={`${format(keyToDate(k), "EEEE, MMMM d")}: ${n} item${n === 1 ? "" : "s"}`}
                        className={`relative mx-auto flex aspect-square w-full max-w-7 items-center justify-center rounded-md text-[11px] tabular-nums transition-colors hover:ring-1 hover:ring-accent ${
                          isToday ? "bg-accent font-bold text-accent-fg" : "text-text"
                        }`}
                        style={
                          !isToday && level
                            ? { background: `color-mix(in srgb, var(--accent) ${[0, 12, 26, 42][level]}%, transparent)` }
                            : undefined
                        }
                      >
                        {keyToDate(k).getDate()}
                      </button>
                    );
                  })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="mt-6 flex items-center justify-end gap-1.5 text-[11px] text-faint" aria-hidden>
        Less
        {[0, 12, 26, 42].map((p) => (
          <span
            key={p}
            className="size-3 rounded-[4px] ring-1 ring-border"
            style={{ background: `color-mix(in srgb, var(--accent) ${p}%, transparent)` }}
          />
        ))}
        More
      </div>
    </div>
  );
}
