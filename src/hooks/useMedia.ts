"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

/** True when a CSS media query matches (false during server render). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Current time, refreshed every `ms` (default: each minute, aligned to the minute). */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const align = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), ms);
    }, ms - (Date.now() % ms));
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, [ms]);
  return now;
}
