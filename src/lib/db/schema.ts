import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Database tables. After editing this file run `npm run db:generate` to create
 * a migration, then `npm run db:migrate` to apply it.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });
const created = () => ts("created_at").notNull().defaultNow();
const updated = () => ts("updated_at").notNull().defaultNow();

/** A connected Google account (mailbox + calendars). */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  /** "personal" = main account (read/write). "school" = read-only. */
  role: text("role", { enum: ["personal", "school"] }).notNull(),
  displayName: text("display_name"),
  /** AES-256-GCM ciphertext — see src/lib/crypto.ts. Never store plaintext. */
  encryptedRefreshToken: text("encrypted_refresh_token"),
  scopes: text("scopes").array().notNull().default([]),
  status: text("status", {
    enum: ["connected", "needs_reconnect", "blocked", "missing_scopes", "error"],
  })
    .notNull()
    .default("connected"),
  statusDetail: text("status_detail"),
  gmailHistoryId: text("gmail_history_id"),
  gmailWatchExpiresAt: ts("gmail_watch_expires_at"),
  lastConnectedAt: ts("last_connected_at"),
  createdAt: created(),
  updatedAt: updated(),
});

/** Every Google calendar we can see in a connected account. */
export const calendars = pgTable(
  "calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    googleCalendarId: text("google_calendar_id").notNull(),
    summary: text("summary").notNull(),
    colorHex: text("color_hex"),
    accessRole: text("access_role"),
    isPrimary: boolean("is_primary").notNull().default(false),
    /** Shown in the app (user can toggle in Settings). */
    enabled: boolean("enabled").notNull().default(true),
    /** Google's incremental sync token. */
    syncToken: text("sync_token"),
    lastSyncedAt: ts("last_synced_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex("calendars_account_gcal_uq").on(t.accountId, t.googleCalendarId)],
);

/**
 * Unified read model: every event from every source, normalized.
 * (source, external_key) is unique, which makes every sync idempotent.
 * All-day events: start_at = 00:00 ET of the first day, end_at = 00:00 ET of the day after the last day.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source", { enum: ["google", "ai", "blackbaud", "todo"] }).notNull(),
    externalKey: text("external_key").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    calendarId: uuid("calendar_id").references(() => calendars.id, { onDelete: "cascade" }),
    googleEventId: text("google_event_id"),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    allDay: boolean("all_day").notNull().default(false),
    status: text("status", { enum: ["confirmed", "tentative", "cancelled"] })
      .notNull()
      .default("confirmed"),
    htmlLink: text("html_link"),
    recurringEventId: text("recurring_event_id"),
    // AI-specific
    aiConfidence: real("ai_confidence"),
    aiGuessed: boolean("ai_guessed").notNull().default(false),
    aiQuote: text("ai_quote"),
    gmailMessageId: text("gmail_message_id"),
    gmailLink: text("gmail_link"),
    /** Source-specific extras (e.g. Blackbaud class/points/type). */
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    todoItemId: uuid("todo_item_id"),
    done: boolean("done").notNull().default(false),
    deletedAt: ts("deleted_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("events_source_key_uq").on(t.source, t.externalKey),
    index("events_time_idx").on(t.startAt, t.endAt),
  ],
);

/** "Added 'Dentist appt' from …" — shown on the Status page. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: ts("at").notNull().defaultNow(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
  },
  (t) => [index("activity_at_idx").on(t.at)],
);

/** Errors are never silent: each one lands here and on the Status page. */
export const syncErrors = pgTable(
  "sync_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** e.g. "calendar:<accountEmail>", "gmail:<email>", "blackbaud", "oauth:<email>" */
    source: text("source").notNull(),
    message: text("message").notNull(),
    count: integer("count").notNull().default(1),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
    notifiedAt: ts("notified_at"),
  },
  (t) => [index("sync_errors_source_idx").on(t.source)],
);

/** Idempotency ledger for scheduled jobs, keyed like "rollover:2026-11-20". */
export const jobRuns = pgTable("job_runs", {
  key: text("key").primaryKey(),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  detail: text("detail"),
});

/**
 * Small key → JSON store for per-source sync bookkeeping, e.g.
 * "blackbaud" → { etag, lastModified, lastCheckedAt, lastChangedAt, count }.
 */
export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: updated(),
});

/**
 * Gmail messages we've seen. The unique (account, message) pair is the
 * idempotency key: a message is claimed here BEFORE any AI call, so it is
 * never processed twice. Doubles as a small work queue (status "pending").
 * Never stores email bodies or subjects.
 */
export const processedMessages = pgTable(
  "processed_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    threadId: text("thread_id"),
    status: text("status", { enum: ["pending", "processing", "done", "skipped", "error"] })
      .notNull()
      .default("pending"),
    /** Why skipped / what happened, e.g. "filtered:newsletter", "ai:none", "ai:2 events". */
    outcome: text("outcome"),
    attempts: integer("attempts").notNull().default(0),
    receivedAt: ts("received_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex("processed_messages_uq").on(t.accountId, t.messageId),
    index("processed_messages_status_idx").on(t.status),
  ],
);

/** Every Claude call and what it cost, for the monthly budget caps. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: ts("at").notNull().defaultNow(),
    /** ET month, "2026-11". */
    month: text("month").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: real("cost_usd").notNull(),
    purpose: text("purpose").notNull(),
  },
  (t) => [index("ai_usage_month_idx").on(t.month)],
);

/** Conflicts waiting to go out in one batched email. */
export const pendingConflicts = pgTable("pending_conflicts", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  conflictsWith: jsonb("conflicts_with").$type<{ title: string; start: string; end: string }[]>().notNull(),
  createdAt: created(),
  sentAt: ts("sent_at"),
});

/** Senders you've told the app to always ignore ("deny") or always read ("allow"). */
export const senderRules = pgTable("sender_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** An email address or "@domain.com". Lower-case. */
  pattern: text("pattern").notNull().unique(),
  rule: text("rule", { enum: ["allow", "deny"] }).notNull(),
  createdAt: created(),
});

/** Your own to-do lists ("My Lists"). Urgent and If I Have Time are built in. */
export const todoLists = pgTable("todo_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: created(),
});

/**
 * One to-do. section: "urgent" (goes on the calendar), "later" (If I Have Time),
 * or "list" (in todo_lists). Urgent items always have a due time.
 */
export const todoItems = pgTable(
  "todo_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    section: text("section", { enum: ["urgent", "later", "list"] }).notNull(),
    listId: uuid("list_id").references(() => todoLists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    dueAt: ts("due_at"),
    position: integer("position").notNull().default(0),
    /** How many midnights this unfinished Urgent item has rolled over. */
    rolledDays: integer("rolled_days").notNull().default(0),
    doneAt: ts("done_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("todo_items_section_idx").on(t.section)],
);
