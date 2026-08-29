CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"organization_id" uuid,
	"group_id" uuid,
	"sender_user_id" text NOT NULL,
	"sender_participant_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" text,
	CONSTRAINT "chat_messages_body_not_blank" CHECK (btrim("chat_messages"."body") <> ''),
	CONSTRAINT "chat_messages_body_length_valid" CHECK (length("chat_messages"."body") <= 4000),
	CONSTRAINT "chat_messages_parent_xor" CHECK (("chat_messages"."organization_id" IS NOT NULL AND "chat_messages"."group_id" IS NULL) OR ("chat_messages"."organization_id" IS NULL AND "chat_messages"."group_id" IS NOT NULL)),
	CONSTRAINT "chat_messages_participant_scope" CHECK (("chat_messages"."group_id" IS NULL AND "chat_messages"."sender_participant_id" IS NULL) OR ("chat_messages"."group_id" IS NOT NULL AND "chat_messages"."sender_participant_id" IS NOT NULL)),
	CONSTRAINT "chat_messages_deleted_identity_shape" CHECK (("chat_messages"."deleted_at" IS NULL AND "chat_messages"."deleted_by_user_id" IS NULL) OR ("chat_messages"."deleted_at" IS NOT NULL AND "chat_messages"."deleted_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_threads_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "chat_threads_id_group_unique" UNIQUE("id","group_id"),
	CONSTRAINT "chat_threads_parent_xor" CHECK (("chat_threads"."organization_id" IS NOT NULL AND "chat_threads"."group_id" IS NULL) OR ("chat_threads"."organization_id" IS NULL AND "chat_threads"."group_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_organization_thread_fk" FOREIGN KEY ("thread_id","organization_id") REFERENCES "public"."chat_threads"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_group_thread_fk" FOREIGN KEY ("thread_id","group_id") REFERENCES "public"."chat_threads"("id","group_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_participant_fk" FOREIGN KEY ("group_id","sender_user_id","sender_participant_id") REFERENCES "public"."group_participants"("group_id","user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_thread_created_idx" ON "chat_messages" USING btree ("thread_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_organization_uidx" ON "chat_threads" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_threads_group_uidx" ON "chat_threads" USING btree ("group_id");