"use client";
import { useCallback, useSyncExternalStore } from "react";

/**
 * A value saved in localStorage that every component sees live (e.g. the
 * calendar sidebar and the calendar itself share the hidden-sources list).
 * Falls back to in-memory if storage is blocked (private mode, etc).
 */
const memory = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
  listeners.get(key)?.forEach((l) => l());
}

export function useLocalStore<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void, boolean] {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(cb);
      const onStorage = (e: StorageEvent) => e.key === key && cb();
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.get(key)!.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );
  const raw = useSyncExternalStore(subscribe, () => read(key), () => "__ssr__");
  const hydrated = raw !== "__ssr__";
  let value = fallback;
  if (hydrated && raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      const prevRaw = read(key);
      let prev = fallback;
      try {
        if (prevRaw !== null) prev = JSON.parse(prevRaw) as T;
      } catch {}
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      write(key, JSON.stringify(next));
    },
    // fallback is intentionally captured once per key
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set, hydrated];
}
