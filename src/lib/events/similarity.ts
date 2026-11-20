/**
 * Free, local "are these the same event?" checks used for de-duplication
 * and for matching updates/cancellations to earlier events.
 */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "at", "with", "my", "your", "our",
  "is", "be", "will", "meeting", "event", "appointment", "appt", "reminder", "re", "fwd", "fw",
]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)); // crude plural folding
}

/** Dice coefficient over word tokens: 1 = same words, 0 = nothing in common. */
export function titleSimilarity(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  // One title fully containing the other's words ("Dentist" vs "Dentist appointment Dr. Lee") counts strongly.
  const containment = both / Math.min(x.size, y.size);
  const dice = (2 * both) / (x.size + y.size);
  return Math.max(dice, containment * 0.85);
}

export type Slot = { title: string; start: Date; end: Date; allDay: boolean };

/** Distinctive codes in a title: flight numbers, confirmation codes, room numbers ("1199", "BIU4E4"). */
export function codes(s: string): Set<string> {
  return new Set((s.toUpperCase().match(/\b[A-Z]*\d[A-Z0-9]*\b/g) ?? []).filter((c) => c.replace(/\D/g, "").length >= 3));
}

/**
 * Same event? Either:
 *  - same day (all-day) or starts within 2 hours, and titles ≥ 0.6 similar; or
 *  - same day and the titles share a distinctive code (e.g. flight "1199"),
 *    even when worded differently ("Return flight from Chicago" vs "Flight to Wash. D.C.").
 */
export function isProbableDuplicate(a: Slot, b: Slot, dayKey: (d: Date) => string): boolean {
  const ca = codes(a.title);
  if (ca.size && dayKey(a.start) === dayKey(b.start) && [...codes(b.title)].some((c) => ca.has(c))) return true;
  const sameTime = a.allDay || b.allDay
    ? dayKey(a.start) === dayKey(b.start)
    : Math.abs(+a.start - +b.start) <= 2 * 3600_000;
  return sameTime && titleSimilarity(a.title, b.title) >= 0.6;
}

/** Do two timed events overlap? (All-day events never "conflict".) */
export function overlaps(a: Slot, b: Slot): boolean {
  if (a.allDay || b.allDay) return false;
  return +a.start < +b.end && +b.start < +a.end;
}
