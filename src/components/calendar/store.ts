"use client";
import { useSyncExternalStore } from "react";
import { useLocalStore } from "@/hooks/useLocalStore";
import type { SourceInfo } from "@/lib/events/types";

/**
 * Shared calendar state that lives outside any one component:
 *  - the list of sources (calendars) from the latest fetch — in memory
 *  - which sources are hidden — saved in localStorage so it's remembered
 */
let sources: SourceInfo[] = [];
const subs = new Set<() => void>();

export function setSources(next: SourceInfo[]) {
  if (JSON.stringify(next) === JSON.stringify(sources)) return;
  sources = next;
  subs.forEach((s) => s());
}

export function useSources(): SourceInfo[] {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => sources,
    () => sources,
  );
}

export function useHiddenSources() {
  const [hidden, setHidden] = useLocalStore<string[]>("mc:hidden-sources", []);
  const toggle = (key: string) =>
    setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));
  return { hidden, toggle, setHidden };
}
