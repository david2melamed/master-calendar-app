CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"month" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" real NOT NULL,
	"purpose" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"conflicts_with" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sender_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pattern" text NOT NULL,
	"rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_rules_pattern_unique" UNIQUE("pattern")
);
--> statement-breakpoint
ALTER TABLE "pending_conflicts" ADD CONSTRAINT "pending_conflicts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_messages" ADD CONSTRAINT "processed_messages_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_month_idx" ON "ai_usage" USING btree ("month");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_messages_uq" ON "processed_messages" USING btree ("account_id","message_id");--> statement-breakpoint
CREATE INDEX "processed_messages_status_idx" ON "processed_messages" USING btree ("status");