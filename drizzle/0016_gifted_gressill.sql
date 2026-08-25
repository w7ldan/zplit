CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" text NOT NULL,
	"type" varchar(64) NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"dedupe_key" varchar(160),
	CONSTRAINT "notifications_type_not_blank" CHECK (btrim("notifications"."type") <> ''),
	CONSTRAINT "notifications_metadata_bounded" CHECK (pg_column_size("notifications"."metadata") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notifications_unread_recipient_idx" ON "notifications" USING btree ("recipient_user_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_recipient_dedupe_idx" ON "notifications" USING btree ("recipient_user_id","type","dedupe_key");
