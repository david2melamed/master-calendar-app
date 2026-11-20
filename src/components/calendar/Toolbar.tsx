"use client";
import { formatDistanceToNowStrict } from "date-fns";
import { useNow } from "@/hooks/useMedia";
import { ChevronLeft, ChevronRight, FilterIcon, RefreshIcon } from "@/components/ui/icons";
import type { View } from "@/lib/calendar/dates";

const VIEWS: { v: View; label: string; key: string }[] = [
  { v: "year", label: "Year", key: "Y" },
  { v: "month", label: "Month", key: "M" },
  { v: "week", label: "Week", key: "W" },
  { v: "day", label: "Day", key: "D" },
];

/** One-tap view switcher with a sliding highlight. */
export function SegmentedControl({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  const idx = VIEWS.findIndex((x) => x.v === value);
  return (
    <div role="tablist" aria-label="Calendar view" className="relative grid grid-cols-4 rounded-xl bg-surface-2 p-1">
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 rounded-[9px] bg-bg shadow-sm ring-1 ring-border transition-transform duration-200 ease-out"
        style={{ width: "calc((100% - 0.5rem) / 4)", transform: `translateX(${idx * 100}%)` }}
      />
      {VIEWS.map(({ v, label, key }) => (
        <button
          key={v}
          role="tab"
          type="button"
          aria-selected={v === value}
          aria-keyshortcuts={key}
          title={`${label} (${key})`}
          onClick={() => onChange(v)}
          className={`relative z-10 px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
            v === value ? "text-text" : "text-muted hover:text-text"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function SyncIndicator({
  lastSync,
  syncing,
  error,
  onSync,
  compact = false,
}: {
  lastSync: string | null;
  syncing: boolean;
  error: boolean;
  onSync: () => void;
  compact?: boolean;
}) {
  useNow(30_000); // re-render so "2 min ago" stays fresh
  const label = syncing
    ? "Syncing…"
    : error
      ? "Sync problem"
      : lastSync
        ? compact
          ? shortAgo(lastSync)
          : `Synced ${longAgo(lastSync)}`
        : "Not synced yet";
  return (
    <button
      type="button"
      onClick={onSync}
      disabled={syncing}
      title="Sync now"
      aria-label={compact ? `Sync now. Last synced ${label}` : undefined}
      className="group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      <span className={`size-1.5 rounded-full ${error ? "bg-danger" : syncing ? "animate-pulse bg-accent" : "bg-success"}`} />
      <span className="whitespace-nowrap">{label}</span>
      <RefreshIcon size={13} className={`opacity-0 transition-opacity group-hover:opacity-100 ${syncing ? "animate-spin opacity-100" : ""}`} />
    </button>
  );
}

function longAgo(iso: string) {
  if (Date.now() - +new Date(iso) < 60_000) return "just now";
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

function shortAgo(iso: string) {
  const s = Math.max(0, (Date.now() - +new Date(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function NavButtons({
  onPrev,
  onNext,
  onToday,
}: {
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const btn =
    "flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text";
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onToday} className="mr-1 rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-surface-2" title="Today (T)">
        Today
      </button>
      <button type="button" onClick={onPrev} className={btn} aria-label="Previous (←)" title="Previous (←)">
        <ChevronLeft size={18} />
      </button>
      <button type="button" onClick={onNext} className={btn} aria-label="Next (→)" title="Next (→)">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

export function FilterButton({ onClick, hiddenCount }: { onClick: () => void; hiddenCount: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
      aria-label="Calendars and filters"
    >
      <FilterIcon size={19} />
      {hiddenCount > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent" />}
    </button>
  );
}
