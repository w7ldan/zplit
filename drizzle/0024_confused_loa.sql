CREATE TABLE "group_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"participant_id" uuid,
	"target_user_id" text NOT NULL,
	"requester_user_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "group_join_requests_target_not_requester" CHECK ("group_join_requests"."target_user_id" <> "group_join_requests"."requester_user_id"),
	CONSTRAINT "group_join_requests_kind_participant_shape" CHECK (("group_join_requests"."kind" = 'member_invitation' AND "group_join_requests"."participant_id" IS NULL) OR ("group_join_requests"."kind" = 'participant_link' AND "group_join_requests"."participant_id" IS NOT NULL)),
	CONSTRAINT "group_join_requests_kind_allowed" CHECK ("group_join_requests"."kind" IN ('member_invitation', 'participant_link')),
	CONSTRAINT "group_join_requests_status_allowed" CHECK ("group_join_requests"."status" IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
	CONSTRAINT "group_join_requests_expires_after_created" CHECK ("group_join_requests"."expires_at" > "group_join_requests"."created_at"),
	CONSTRAINT "group_join_requests_transition_timestamps" CHECK (("group_join_requests"."status" = 'pending' AND "group_join_requests"."accepted_at" IS NULL AND "group_join_requests"."declined_at" IS NULL AND "group_join_requests"."revoked_at" IS NULL AND "group_join_requests"."expired_at" IS NULL) OR ("group_join_requests"."status" = 'accepted' AND "group_join_requests"."accepted_at" IS NOT NULL AND "group_join_requests"."declined_at" IS NULL AND "group_join_requests"."revoked_at" IS NULL AND "group_join_requests"."expired_at" IS NULL) OR ("group_join_requests"."status" = 'declined' AND "group_join_requests"."accepted_at" IS NULL AND "group_join_requests"."declined_at" IS NOT NULL AND "group_join_requests"."revoked_at" IS NULL AND "group_join_requests"."expired_at" IS NULL) OR ("group_join_requests"."status" = 'revoked' AND "group_join_requests"."accepted_at" IS NULL AND "group_join_requests"."declined_at" IS NULL AND "group_join_requests"."revoked_at" IS NOT NULL AND "group_join_requests"."expired_at" IS NULL) OR ("group_join_requests"."status" = 'expired' AND "group_join_requests"."accepted_at" IS NULL AND "group_join_requests"."declined_at" IS NULL AND "group_join_requests"."revoked_at" IS NULL AND "group_join_requests"."expired_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD CONSTRAINT "group_join_requests_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD CONSTRAINT "group_join_requests_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD CONSTRAINT "group_join_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD CONSTRAINT "group_join_requests_participant_fk" FOREIGN KEY ("group_id","participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_join_requests_pending_group_target_uidx" ON "group_join_requests" USING btree ("group_id","target_user_id") WHERE "group_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "group_join_requests_pending_group_participant_uidx" ON "group_join_requests" USING btree ("group_id","participant_id") WHERE "group_join_requests"."status" = 'pending' AND "group_join_requests"."participant_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "group_join_requests_group_status_idx" ON "group_join_requests" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "group_join_requests_target_status_idx" ON "group_join_requests" USING btree ("target_user_id","status");--> statement-breakpoint
CREATE INDEX "group_join_requests_expires_at_idx" ON "group_join_requests" USING btree ("expires_at");