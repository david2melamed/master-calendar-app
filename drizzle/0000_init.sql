CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text,
	"encrypted_refresh_token" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"status_detail" text,
	"gmail_history_id" text,
	"gmail_watch_expires_at" timestamp with time zone,
	"last_connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"google_calendar_id" text NOT NULL,
	"summary" text NOT NULL,
	"color_hex" text,
	"access_role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_token" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_key" text NOT NULL,
	"account_id" uuid,
	"calendar_id" uuid,
	"google_event_id" text,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"html_link" text,
	"recurring_event_id" text,
	"ai_confidence" real,
	"ai_guessed" boolean DEFAULT false NOT NULL,
	"ai_quote" text,
	"gmail_message_id" text,
	"gmail_link" text,
	"meta" jsonb,
	"todo_item_id" uuid,
	"done" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"key" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "sync_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"message" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_at_idx" ON "activity_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "calendars_account_gcal_uq" ON "calendars" USING btree ("account_id","google_calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_key_uq" ON "events" USING btree ("source","external_key");--> statement-breakpoint
CREATE INDEX "events_time_idx" ON "events" USING btree ("start_at","end_at");--> statement-breakpoint
CREATE INDEX "sync_errors_source_idx" ON "sync_errors" USING btree ("source");