CREATE TABLE "friend_link_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"friend_id" uuid NOT NULL,
	"target_user_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "friend_link_requests_status_allowed" CHECK ("friend_link_requests"."status" IN ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "friend_link_requests_transition_timestamps" CHECK (("friend_link_requests"."status" = 'pending' AND "friend_link_requests"."accepted_at" IS NULL AND "friend_link_requests"."declined_at" IS NULL AND "friend_link_requests"."cancelled_at" IS NULL) OR ("friend_link_requests"."status" = 'accepted' AND "friend_link_requests"."accepted_at" IS NOT NULL AND "friend_link_requests"."declined_at" IS NULL AND "friend_link_requests"."cancelled_at" IS NULL) OR ("friend_link_requests"."status" = 'declined' AND "friend_link_requests"."accepted_at" IS NULL AND "friend_link_requests"."declined_at" IS NOT NULL AND "friend_link_requests"."cancelled_at" IS NULL) OR ("friend_link_requests"."status" = 'cancelled' AND "friend_link_requests"."accepted_at" IS NULL AND "friend_link_requests"."declined_at" IS NULL AND "friend_link_requests"."cancelled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "friends" ADD COLUMN "linked_user_id" text;--> statement-breakpoint
ALTER TABLE "friend_link_requests" ADD CONSTRAINT "friend_link_requests_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_link_requests" ADD CONSTRAINT "friend_link_requests_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_link_requests" ADD CONSTRAINT "friend_link_requests_owner_friend_fk" FOREIGN KEY ("owner_user_id","friend_id") REFERENCES "public"."friends"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friend_link_requests_pending_uidx" ON "friend_link_requests" USING btree ("owner_user_id","friend_id","target_user_id") WHERE "friend_link_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "friend_link_requests_owner_friend_idx" ON "friend_link_requests" USING btree ("owner_user_id","friend_id");--> statement-breakpoint
CREATE INDEX "friend_link_requests_target_status_idx" ON "friend_link_requests" USING btree ("target_user_id","status");--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friends_owner_linked_user_uidx" ON "friends" USING btree ("owner_user_id","linked_user_id") WHERE "friends"."linked_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "friends_linked_user_idx" ON "friends" USING btree ("owner_user_id","linked_user_id");