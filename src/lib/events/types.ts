/** What the calendar UI receives for each event (JSON-safe; dates are ISO strings). */
export type EventSource = "google" | "ai" | "blackbaud" | "todo";

export type CalendarEvent = {
  id: string;
  source: EventSource;
  /** Filter key: "cal:<calendarId>", "ai", "blackbaud", or "todo". */
  sourceKey: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  /** e.g. "Family · you@example.com" */
  sourceLabel: string;
  color: string;
  htmlLink: string | null;
  aiGuessed: boolean;
  aiConfidence: number | null;
  aiQuote: string | null;
  gmailLink: string | null;
  meta: Record<string, unknown> | null;
  done: boolean;
  /** True only for events this app created (AI / To-Do): those can be edited or deleted here. */
  appOwned: boolean;
};

/** One row in the legend / filter list. */
export type SourceInfo = {
  key: string;
  label: string;
  group: string;
  color: string;
};

export type EventsResponse = {
  events: CalendarEvent[];
  sources: SourceInfo[];
  lastSync: string | null;
  demo: boolean;
};
