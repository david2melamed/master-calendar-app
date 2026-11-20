"use client";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { useLocalStore } from "@/hooks/useLocalStore";
import { useMediaQuery } from "@/hooks/useMedia";
import { rangeFor, shiftKey, titleFor, todayKey, type View } from "@/lib/calendar/dates";
import type { CalendarEvent, EventsResponse } from "@/lib/events/types";
import { CalendarSkeleton } from "./CalendarSkeleton";
import { DayView } from "./DayView";
import { EventDetail } from "./EventDetail";
import { MonthView } from "./MonthView";
import { SourceFilterList } from "./SourceFilter";
import { SwipePager } from "./SwipePager";
import { setSources, useHiddenSources } from "./store";
import { FilterButton, NavButtons, SegmentedControl, SyncIndicator } from "./Toolbar";
import { byDay } from "./util";
import { WeekView } from "./WeekView";
import { YearView } from "./YearView";

const VIEW_KEYS: Record<string, View> = { y: "year", m: "month", w: "week", d: "day" };
const BACKGROUND_SYNC_MS = 10 * 60 * 1000;

async function fetchEvents(from: Date, to: Date): Promise<EventsResponse> {
  const res = await fetch(`/api/events?from=${from.toISOString()}&to=${to.toISOString()}`, { cache: "no-store" });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("signed out");
  }
  if (!res.ok) throw new Error(`Could not load events (${res.status})`);
  return res.json();
}

export function CalendarApp() {
  const qc = useQueryClient();
  const wide = useMediaQuery("(min-width: 768px)");
  const [savedView, setSavedView, hydrated] = useLocalStore<View | null>("mc:view", null);
  const [cursor, setCursor] = useState<string>(() => todayKey());
  const [urlView, setUrlView] = useState<View | null>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { hidden } = useHiddenSources();

  // Default: Day on iPhone, Week on Mac — unless you picked a view before (remembered).
  const view: View = urlView ?? savedView ?? (wide ? "week" : "day");

  // Deep links like /calendar?view=day&date=2026-11-19 (used by alert emails).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const v = p.get("view");
    const d = p.get("date");
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the URL on mount */
    if (v && ["year", "month", "week", "day"].includes(v)) setUrlView(v as View);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setCursor(d);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const changeView = useCallback(
    (v: View) => {
      setUrlView(null);
      setSavedView(v);
    },
    [setSavedView],
  );

  // Keep the address bar in sync so reload / share returns to the same place.
  useEffect(() => {
    if (!hydrated) return;
    const url = `/calendar?view=${view}&date=${cursor}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [view, cursor, hydrated]);

  // Load one page either side too, so the neighbouring page is ready while you swipe.
  // (Year view loads just its year; three years would be a lot of data.)
  const { from, to } = useMemo(() => {
    if (view === "year") return rangeFor(cursor, view);
    return {
      from: rangeFor(shiftKey(cursor, view, -1), view).from,
      to: rangeFor(shiftKey(cursor, view, 1), view).to,
    };
  }, [cursor, view]);
  const query = useQuery({
    queryKey: ["events", from.toISOString(), to.toISOString()],
    queryFn: () => fetchEvents(from, to),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (query.data?.sources) setSources(query.data.sources);
  }, [query.data?.sources]);

  // ---- Syncing: on open, when the app comes back to the front, and every 10 min while open.
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const syncingRef = useRef(false);
  const sync = useCallback(
    async (force = false) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      try {
        const res = await fetch(`/api/sync${force ? "?force=1" : ""}`, { method: "POST" });
        const body = await res.json().catch(() => ({}));
        setSyncError(!res.ok || (body.errors ?? 0) > 0);
        await qc.invalidateQueries({ queryKey: ["events"] });
      } catch {
        setSyncError(true);
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [qc],
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kick off a sync when the calendar opens
    void sync();
    const onVisible = () => document.visibilityState === "visible" && void sync();
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(() => void sync(), BACKGROUND_SYNC_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [sync]);

  // ---- Navigation
  // `nav` tells the pager which way to slide after a button / arrow-key press.
  const [nav, setNav] = useState<{ dir: 1 | -1 | 0; n: number }>({ dir: 0, n: 0 });
  const go = useCallback(
    (dir: 1 | -1) => {
      setCursor((c) => shiftKey(c, view, dir));
      setNav((p) => ({ dir, n: p.n + 1 }));
    },
    [view],
  );
  // Swipes already animated themselves, so they skip the slide.
  const swipeTo = useCallback((dir: 1 | -1) => setCursor((c) => shiftKey(c, view, dir)), [view]);
  const shiftPage = useCallback((k: string, dir: 1 | -1) => shiftKey(k, view, dir), [view]);
  const goToday = useCallback(() => setCursor(todayKey()), []);
  const openDay = useCallback(
    (k: string) => {
      setCursor(k);
      changeView("day");
    },
    [changeView],
  );
  const openWeek = useCallback(
    (k: string) => {
      setCursor(k);
      changeView("week");
    },
    [changeView],
  );
  const openMonth = useCallback(
    (k: string) => {
      setCursor(k);
      changeView("month");
    },
    [changeView],
  );

  // Keyboard shortcuts (Mac): Y / M / W / D, T = today, ← / → = previous / next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || selected || filtersOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (VIEW_KEYS[k]) changeView(VIEW_KEYS[k]);
      else if (k === "t") goToday();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changeView, go, goToday, selected, filtersOpen]);

  // Hidden sources are filtered out everywhere.
  // ---- Delete AI events, with 5 seconds to undo (nothing is sent until then).
  const [removing, setRemoving] = useState<string[]>([]);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showToast = useCallback((text: string, undo?: () => void, ms = 5000) => {
    clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);
  const deleteEvent = useCallback(
    (e: CalendarEvent) => {
      setSelected(null);
      setRemoving((r) => [...r, e.id]);
      const send = setTimeout(async () => {
        const res = await fetch(`/api/events/${e.id}`, { method: "DELETE" }).catch(() => null);
        if (res?.ok) await qc.invalidateQueries({ queryKey: ["events"] });
        else showToast("Couldn't delete — please try again.");
        setRemoving((r) => r.filter((id) => id !== e.id));
      }, 5000);
      showToast(`Deleted “${e.title}”`, () => {
        clearTimeout(send);
        setRemoving((r) => r.filter((id) => id !== e.id));
        setToast(null);
      });
    },
    [qc, showToast],
  );
  const blockSender = useCallback(
    async (e: CalendarEvent) => {
      const from = String(e.meta?.from ?? "");
      if (!from || !window.confirm(`Ignore all future emails from ${from}?\n\nEvents already added stay on your calendar.`)) return;
      const res = await fetch("/api/sender-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: from }),
      }).catch(() => null);
      showToast(res?.ok ? `Emails from ${from} will be ignored.` : "Couldn't save that — please try again.");
    },
    [showToast],
  );

  const visible = useMemo(
    () => (query.data?.events ?? []).filter((e) => !hidden.includes(e.sourceKey) && !removing.includes(e.id)),
    [query.data?.events, hidden, removing],
  );
  const days = useMemo(() => byDay(visible), [visible]);

  // To-do checkboxes on the calendar: same item as on the To-Do page.
  const toggleDone = useCallback(
    async (e: CalendarEvent) => {
      const id = typeof e.meta?.todoId === "string" ? e.meta.todoId : null;
      if (!id) return;
      qc.setQueriesData<EventsResponse>({ queryKey: ["events"] }, (d) =>
        d ? { ...d, events: d.events.map((x) => (x.id === e.id ? { ...x, done: !e.done } : x)) } : d,
      );
      const res = await fetch(`/api/todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !e.done }),
      }).catch(() => null);
      if (!res?.ok) showToast("Couldn't update that to-do.");
      void qc.invalidateQueries({ queryKey: ["events"] });
      void qc.invalidateQueries({ queryKey: ["todos"] });
    },
    [qc, showToast],
  );

  const renderPage = useCallback(
    (k: string) => {
      if (view === "day") {
        return <DayView dayKey={k} events={days.get(k) ?? []} onSelect={setSelected} onToggleDone={toggleDone} />;
      }
      if (view === "week") {
        return (
          <WeekView
            cursor={k}
            byDay={days}
            events={visible}
            onSelect={setSelected}
            onOpenDay={openDay}
            onToggleDone={toggleDone}
          />
        );
      }
      if (view === "month") {
        return (
          <MonthView
            cursor={k}
            byDay={days}
            onSelect={setSelected}
            onOpenDay={openDay}
            onOpenWeek={openWeek}
            onToggleDone={toggleDone}
          />
        );
      }
      return <YearView cursor={k} byDay={days} onOpenDay={openDay} onOpenMonth={openMonth} />;
    },
    [view, days, visible, openDay, openWeek, openMonth, toggleDone],
  );

  if (!hydrated || (query.isPending && !query.data)) return <CalendarSkeleton />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="shrink-0 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-[19px] font-semibold tracking-tight sm:text-[22px]">
              {view === "day" ? (
                <>
                  <span className="sm:hidden">{titleFor(cursor, "month")}</span>
                  <span className="hidden sm:inline">{titleFor(cursor, "day")}</span>
                </>
              ) : (
                titleFor(cursor, view)
              )}
            </h1>
            <div className="hidden sm:block">
              <NavButtons onPrev={() => go(-1)} onNext={() => go(1)} onToday={goToday} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
            <div className="sm:hidden">
              <SyncIndicator compact lastSync={query.data?.lastSync ?? null} syncing={syncing} error={syncError || query.isError} onSync={() => void sync(true)} />
            </div>
            <div className="hidden sm:block">
              <SyncIndicator lastSync={query.data?.lastSync ?? null} syncing={syncing} error={syncError || query.isError} onSync={() => void sync(true)} />
            </div>
            <div className="md:hidden">
              <FilterButton onClick={() => setFiltersOpen(true)} hiddenCount={hidden.length} />
            </div>
            <div className="hidden sm:block">
              <SegmentedControl value={view} onChange={changeView} />
            </div>
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-2 sm:hidden">
          <div className="flex-1">
            <SegmentedControl value={view} onChange={changeView} />
          </div>
          <button
            type="button"
            onClick={goToday}
            className="rounded-xl border border-border px-3 py-1.5 text-[13px] font-medium"
          >
            Today
          </button>
        </div>
        {query.data?.demo && (
          <p className="mt-2 rounded-lg bg-warning-soft px-3 py-1.5 text-[12px] text-warning">
            Demo mode — showing sample data.
          </p>
        )}
      </div>

      {/* Current view — swipe sideways on iPhone to move between pages */}
      <div key={view} className="min-h-0 flex-1 animate-[mc-view-in_200ms_ease-out]">
        <SwipePager cursor={cursor} shift={shiftPage} render={renderPage} onNavigate={swipeTo} nav={nav} />
      </div>

      <EventDetail event={selected} onClose={() => setSelected(null)} onDelete={deleteEvent} onBlockSender={blockSender} />
      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-50 flex justify-center px-4 md:bottom-6"
        >
          <div className="flex max-w-md items-center gap-3 rounded-xl bg-navy px-4 py-2.5 text-[13px] text-white shadow-lg animate-[mc-view-in_200ms_ease-out]">
            <span className="min-w-0 truncate">{toast.text}</span>
            {toast.undo && (
              <button type="button" onClick={toast.undo} className="shrink-0 font-semibold text-[#9cc0ff] hover:underline">
                Undo
              </button>
            )}
          </div>
        </div>
      )}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} title="Calendars" side="bottom">
        <h2 className="mb-3 text-lg font-semibold">Calendars</h2>
        <SourceFilterList />
      </Sheet>
    </div>
  );
}
