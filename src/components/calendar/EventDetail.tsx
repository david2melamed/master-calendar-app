"use client";
import { format } from "date-fns";
import { Sheet } from "@/components/ui/Sheet";
import { BlockIcon, BookIcon, ClockIcon, ExternalIcon, MailIcon, PinIcon, TrashIcon } from "@/components/ui/icons";
import { addDaysKey, fmtTimeRange, keyToDate } from "@/lib/calendar/dates";
import type { CalendarEvent } from "@/lib/events/types";
import { dateKeyET, inET } from "@/lib/time";
import { AiTag, sourceBadge } from "./EventCard";
import { htmlToText, tint } from "./util";

function whenText(e: CalendarEvent): string {
  if (e.allDay) {
    const first = dateKeyET(new Date(e.start));
    const last = addDaysKey(dateKeyET(new Date(e.end)), -1);
    const f = (k: string) => format(keyToDate(k), "EEEE, MMMM d");
    return first >= last ? `${f(first)} · All day` : `${f(first)} – ${f(last)}`;
  }
  const s = inET(e.start);
  const sameDay = dateKeyET(new Date(e.start)) === dateKeyET(new Date(+new Date(e.end) - 1));
  if (e.source === "blackbaud") {
    // Date-only assignments are due "by end of day"; timed ones at their (end) time.
    const due = inET(e.end);
    return e.meta?.dateOnly ? `Due ${format(due, "EEEE, MMMM d")} · end of day` : `Due ${format(due, "EEEE, MMMM d 'at' h:mm a")}`;
  }
  if (sameDay) return `${format(s, "EEEE, MMMM d")} · ${fmtTimeRange(e.start, e.end)}`;
  return `${format(s, "EEE, MMM d, h:mm a")} – ${format(inET(e.end), "EEE, MMM d, h:mm a")}`;
}

/** Full details for one event (slide-over on Mac, bottom sheet on iPhone). */
export function EventDetail({
  event,
  onClose,
  onDelete,
  onBlockSender,
}: {
  event: CalendarEvent | null;
  onClose: () => void;
  /** AI events only: delete (with a few seconds to undo). */
  onDelete?: (e: CalendarEvent) => void;
  /** AI events only: never add events from this sender again. */
  onBlockSender?: (e: CalendarEvent) => void;
}) {
  const e = event;
  const desc = e?.description ? htmlToText(e.description) : "";
  const bb = e?.source === "blackbaud" ? e.meta ?? {} : null;

  return (
    <Sheet open={!!e} onOpenChange={(o) => !o && onClose()} title={e?.title ?? "Event"}>
      {e && (
        <article className="flex flex-col gap-5">
          <header className="flex gap-3">
            <span className="mt-1.5 size-3 shrink-0 rounded-[4px]" style={{ background: e.color }} aria-hidden />
            <div className="min-w-0">
              <h2 className={`text-xl font-semibold leading-snug tracking-tight ${e.done ? "text-faint line-through" : ""}`}>
                {e.title}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span
                  className="rounded-full px-2 py-0.5 text-[11.5px] font-medium"
                  style={{ background: tint(e.color, 16), color: "var(--text)" }}
                >
                  {sourceBadge(e)}
                </span>
                {e.aiGuessed && <AiTag />}
                {e.status === "tentative" && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] text-muted">Tentative</span>
                )}
              </div>
            </div>
          </header>

          <ul className="flex flex-col gap-3 text-[14px]">
            <li className="flex gap-3">
              <ClockIcon size={17} className="mt-0.5 shrink-0 text-faint" />
              <span>{whenText(e)}</span>
            </li>
            {e.location && (
              <li className="flex gap-3">
                <PinIcon size={17} className="mt-0.5 shrink-0 text-faint" />
                <a
                  href={`https://maps.apple.com/?q=${encodeURIComponent(e.location)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="break-words text-accent hover:underline"
                >
                  {e.location}
                </a>
              </li>
            )}
            {bb && (
              <li className="flex gap-3">
                <BookIcon size={17} className="mt-0.5 shrink-0 text-faint" />
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  {(
                    [
                      ["Class", bb.className],
                      ["Assigned", typeof bb.assigned === "string" ? format(keyToDate(bb.assigned), "EEE, MMM d") : undefined],
                      ["Type", bb.type],
                      ["Points", bb.points],
                      ["Status", bb.status],
                    ] as const
                  )
                    .filter(([, v]) => v !== undefined && v !== null && v !== "")
                    .map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted">{k}</dt>
                        <dd className="font-medium">{String(v)}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            )}
          </ul>

          {e.source === "ai" && (
            <section className="rounded-xl border border-border bg-surface p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Why the AI added this</h3>
              {e.aiQuote && (
                <blockquote className="mt-2 border-l-2 border-[#7559d6] pl-3 text-[14px] italic leading-relaxed">
                  “{e.aiQuote}”
                </blockquote>
              )}
              {e.aiConfidence !== null && (
                <p className="mt-2 text-[12px] text-muted">Confidence: {Math.round(e.aiConfidence * 100)}%</p>
              )}
              {e.gmailLink && (
                <a
                  href={e.gmailLink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
                >
                  <MailIcon size={15} /> Open in Gmail
                </a>
              )}
            </section>
          )}

          {desc && <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-muted">{desc}</p>}

          <footer className="flex flex-wrap gap-2 border-t border-border pt-4">
            {e.htmlLink && /^https?:\/\//i.test(e.htmlLink) && (
              <a
                href={e.htmlLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium transition-colors hover:bg-surface-2"
              >
                <ExternalIcon size={15} /> {e.source === "blackbaud" ? "Open in Blackbaud" : "Open in Google Calendar"}
              </a>
            )}
            {e.source === "ai" && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(e)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-danger transition-colors hover:bg-danger-soft"
              >
                <TrashIcon size={15} /> Delete
              </button>
            )}
            {e.source === "ai" && onBlockSender && typeof e.meta?.from === "string" && (
              <button
                type="button"
                onClick={() => onBlockSender(e)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
                title={`Never add events from ${e.meta.from}`}
              >
                <BlockIcon size={15} /> Ignore this sender
              </button>
            )}
            {!e.appOwned && e.source === "google" && (
              <p className="w-full text-[12px] text-faint">
                Events from your Google calendars are edited in Google Calendar. This app only changes events it created.
              </p>
            )}
          </footer>
        </article>
      )}
    </Sheet>
  );
}
