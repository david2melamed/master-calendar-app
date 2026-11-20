"use client";
import { CheckIcon, SparkleIcon } from "@/components/ui/icons";
import { fmtTime, fmtTimeRange } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/events/types";
import { tint } from "./util";

type Select = (e: CalendarEvent) => void;

/** Short label for which account / calendar / app source an event came from. */
export function sourceBadge(e: CalendarEvent): string {
  if (e.source === "blackbaud") return "Blackbaud";
  if (e.source === "todo") return "To-Do";
  if (e.source === "ai") return `From email · ${e.sourceLabel}`;
  return e.sourceLabel.split(" · ")[0];
}

/** Timed event block in the Day/Week time grid. */
export function EventBlock({
  event: e,
  style,
  compact,
  onSelect,
}: {
  event: CalendarEvent;
  style: React.CSSProperties;
  compact: boolean;
  onSelect: Select;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(e)}
      style={{
        ...style,
        background: tint(e.color, e.aiGuessed ? 9 : 15),
        borderColor: e.aiGuessed ? e.color : "transparent",
      }}
      className={`group absolute overflow-hidden rounded-md border text-left shadow-[0_0_0_1px_var(--bg)] transition-[filter,box-shadow] duration-150 hover:brightness-[0.97] hover:shadow-sm dark:hover:brightness-110 ${
        e.aiGuessed ? "border-dashed" : ""
      }`}
      aria-label={`${e.title}, ${fmtTimeRange(e.start, e.end)}`}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: e.color }} aria-hidden />
      <span className={`flex h-full flex-col pl-2 pr-1.5 ${compact ? "justify-center py-0" : "py-1"}`}>
        <span className={`flex min-w-0 items-baseline gap-1.5 ${compact ? "" : "flex-col items-start gap-0"}`}>
          <span className="truncate text-[12.5px] font-semibold leading-tight text-text">{e.title}</span>
          <span className="shrink-0 truncate text-[11.5px] leading-tight text-muted">
            {compact ? fmtTime(e.start) : fmtTimeRange(e.start, e.end)}
          </span>
        </span>
        {!compact && e.location && <span className="mt-0.5 truncate text-[11.5px] leading-tight text-muted">{e.location}</span>}
        {!compact && (
          <span className="mt-auto flex items-center gap-1 pt-0.5">
            {e.aiGuessed && <AiTag />}
            <span className="truncate text-[10.5px] font-medium text-faint">{sourceBadge(e)}</span>
          </span>
        )}
      </span>
    </button>
  );
}

/** Compact pill for all-day events, due items, to-dos, and Month view entries. */
export function EventChip({
  event: e,
  onSelect,
  showTime = false,
  onToggleDone,
}: {
  event: CalendarEvent;
  onSelect: Select;
  showTime?: boolean;
  onToggleDone?: (e: CalendarEvent) => void;
}) {
  const solid = e.allDay && e.source === "google";
  const due = e.source === "blackbaud";
  const todo = e.source === "todo";
  // "AP Calculus AB - 1" → "AP Calculus AB" (the section number is noise on a chip)
  const className = typeof e.meta?.className === "string" ? e.meta.className.replace(/ - [^-]{1,20}$/, "") : null;

  return (
    <div
      className={`group flex min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-[3px] text-[12px] leading-tight transition-colors duration-150 ${
        e.aiGuessed ? "border-dashed" : "border-transparent"
      }`}
      style={{
        background: solid ? tint(e.color, 22) : tint(e.color, 10),
        borderColor: e.aiGuessed ? e.color : undefined,
      }}
    >
      {todo ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={e.done}
          aria-label={e.done ? "Mark not done" : "Mark done"}
          onClick={() => onToggleDone?.(e)}
          className="flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border-[1.5px]"
          style={{ borderColor: e.color, background: e.done ? e.color : "transparent" }}
        >
          {e.done && <CheckIcon size={9} className="text-white [stroke-width:3.5]" />}
        </button>
      ) : (
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: e.color }} aria-hidden />
      )}
      <button type="button" onClick={() => onSelect(e)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        {due && <span className="shrink-0 font-semibold" style={{ color: e.color }}>Due</span>}
        {showTime && !e.allDay && !due && !todo && (
          <span className="shrink-0 tabular-nums text-muted">{fmtTime(e.start)}</span>
        )}
        <span className={`truncate font-medium ${e.done ? "text-faint line-through" : "text-text"}`}>{e.title}</span>
        {className && <span className="hidden shrink-0 truncate text-faint sm:inline">· {className}</span>}
        {e.aiGuessed && <AiTag />}
      </button>
    </div>
  );
}

export function AiTag() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide text-[#7559d6] ring-1 ring-[#7559d6]/40 dark:text-[#a993ff]">
      <SparkleIcon size={9} /> AI-guessed
    </span>
  );
}
