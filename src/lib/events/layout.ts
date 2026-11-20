/**
 * Side-by-side layout for overlapping timed events (Day and Week views).
 *
 * 1. Sort by start (longer first on ties).
 * 2. Group events into "clusters" that transitively overlap.
 * 3. Within a cluster, put each event in the first column where it fits.
 * 4. Each event then stretches right into any columns that stay free during its time.
 * Result: left/width as fractions (0–1) of the day column.
 */
export type LayoutInput = { id: string; start: number; end: number };
export type LayoutBox = { id: string; left: number; width: number; col: number; cols: number };

/** Very short events still get a minimum visual height, so treat them as at least this long. */
const MIN_MS = 20 * 60 * 1000;

export function layoutDay(items: LayoutInput[]): Map<string, LayoutBox> {
  const evs = items
    .map((e) => ({ ...e, end: Math.max(e.end, e.start + MIN_MS) }))
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.id.localeCompare(b.id));

  const out = new Map<string, LayoutBox>();
  let cluster: typeof evs = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const columns: (typeof evs)[] = [];
    const colOf = new Map<string, number>();
    for (const ev of cluster) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const last = columns[c][columns[c].length - 1];
        if (last.end <= ev.start) {
          columns[c].push(ev);
          colOf.set(ev.id, c);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([ev]);
        colOf.set(ev.id, columns.length - 1);
      }
    }
    const n = columns.length;
    for (const ev of cluster) {
      const c = colOf.get(ev.id)!;
      // Expand right while the neighbouring columns are free during this event.
      let span = 1;
      for (let k = c + 1; k < n; k++) {
        const blocked = columns[k].some((o) => o.start < ev.end && o.end > ev.start);
        if (blocked) break;
        span++;
      }
      out.set(ev.id, { id: ev.id, col: c, cols: n, left: c / n, width: span / n });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const ev of evs) {
    if (ev.start >= clusterEnd) flush();
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.end);
  }
  flush();
  return out;
}
