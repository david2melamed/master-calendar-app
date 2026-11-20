"use client";
import { useEffect, useMemo, useRef } from "react";
import { useNow } from "@/hooks/useMedia";
import { minutesOfDayET, todayKey } from "@/lib/calendar/dates";
import { layoutDay } from "@/lib/events/layout";
import type { CalendarEvent } from "@/lib/events/types";
import { EventBlock } from "./EventCard";
import { swipeScroll } from "./swipe-state";
import { segmentsForDay } from "./util";

export const HOUR_PX = 56;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const label = (h: number) => (h === 0 ? "" : h === 12 ? "Noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);

/**
 * Vertical 24-hour timeline with one column per day (1 for Day, 7 for Week).
 * Overlapping events sit side by side; today gets a live red "now" line.
 */
export function TimeGrid({
  dayKeys,
  events,
  onSelect,
  scrollKey,
}: {
  dayKeys: string[];
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
  /** Changing this re-runs the initial auto-scroll. */
  scrollKey: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const now = useNow();
  const today = todayKey();
  const nowMin = minutesOfDayET(new Date(now));

  // Scroll to "now" (today) or 7 AM, once per date/view change.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (swipeScroll.active) {
      el.scrollTop = swipeScroll.top; // mid-swipe: keep the same time of day in view
      return;
    }
    const isToday = dayKeys.includes(todayKey());
    const target = isToday ? (minutesOfDayET(new Date()) / 60 - 1.5) * HOUR_PX : 7 * HOUR_PX;
    el.scrollTop = Math.max(0, target);
    swipeScroll.top = el.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const columns = useMemo(
    () =>
      dayKeys.map((k) => {
        const segs = segmentsForDay(events, k);
        const boxes = layoutDay(
          segs.map((s) => ({ id: s.event.id, start: s.startMin * 60_000, end: s.endMin * 60_000 })),
        );
        return { key: k, segs, boxes };
      }),
    [dayKeys, events],
  );

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        if (!swipeScroll.active) swipeScroll.top = e.currentTarget.scrollTop;
      }}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <div className="relative flex" style={{ height: 24 * HOUR_PX }}>
        {/* Hour labels */}
        <div className="relative w-14 shrink-0 select-none sm:w-16" aria-hidden>
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute right-2 -translate-y-1/2 text-[10.5px] font-medium tabular-nums text-faint"
              style={{ top: h * HOUR_PX }}
            >
              {label(h)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div className="relative flex min-w-0 flex-1">
          {HOURS.map((h) => (
            <div
              key={h}
              className="pointer-events-none absolute inset-x-0 border-t border-border/70"
              style={{ top: h * HOUR_PX }}
              aria-hidden
            />
          ))}
          {columns.map(({ key, segs, boxes }) => (
            <div key={key} className="relative min-w-0 flex-1 border-l border-border/70 first:border-l-0">
              {segs.map(({ event, startMin, endMin }) => {
                const b = boxes.get(event.id)!;
                const top = (startMin / 60) * HOUR_PX;
                const height = Math.max(((endMin - startMin) / 60) * HOUR_PX - 2, 20);
                return (
                  <EventBlock
                    key={event.id}
                    event={event}
                    compact={height < 44}
                    onSelect={onSelect}
                    style={{
                      top: top + 1,
                      height,
                      left: `calc(${b.left * 100}% + 2px)`,
                      width: `calc(${b.width * 100}% - 4px)`,
                      zIndex: 1 + b.col,
                    }}
                  />
                );
              })}
              {key === today && (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                  style={{ top: (nowMin / 60) * HOUR_PX }}
                  aria-label="Current time"
                >
                  <span className="-ml-[5px] size-2.5 rounded-full bg-danger" />
                  <span className="h-[2px] flex-1 bg-danger" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
