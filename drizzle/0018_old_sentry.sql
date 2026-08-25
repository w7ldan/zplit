CREATE TABLE "friend_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a_id" text NOT NULL,
	"user_b_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'connected' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_connections_distinct_users" CHECK ("friend_connections"."user_a_id" <> "friend_connections"."user_b_id"),
	CONSTRAINT "friend_connections_canonical_pair" CHECK ("friend_connections"."user_a_id" < "friend_connections"."user_b_id"),
	CONSTRAINT "friend_connections_status_allowed" CHECK ("friend_connections"."status" IN ('connected', 'disconnected')),
	CONSTRAINT "friend_connections_transition_timestamps" CHECK (("friend_connections"."status" = 'connected' AND "friend_connections"."connected_at" IS NOT NULL AND "friend_connections"."disconnected_at" IS NULL) OR ("friend_connections"."status" = 'disconnected' AND "friend_connections"."connected_at" IS NOT NULL AND "friend_connections"."disconnected_at" IS NOT NULL))
);
--> statement-breakpoint
WITH ranked AS (
	SELECT
		id,
		row_number() OVER (PARTITION BY owner_user_id, friend_id ORDER BY created_at, id) AS friend_rank,
		row_number() OVER (PARTITION BY owner_user_id, target_user_id ORDER BY created_at, id) AS target_rank
	FROM friend_link_requests
	WHERE status = 'pending'
), cancelled AS (
	UPDATE friend_link_requests AS requests
	SET status = 'cancelled', cancelled_at = now()
	FROM ranked
	WHERE requests.id = ranked.id AND (ranked.friend_rank > 1 OR ranked.target_rank > 1)
	RETURNING requests.id
)
UPDATE notifications
SET read_at = now()
WHERE type = 'friend.link.request' AND read_at IS NULL AND metadata->>'requestId' IN (SELECT id::text FROM cancelled);
--> statement-breakpoint
DROP INDEX "friend_link_requests_pending_uidx";--> statement-breakpoint
ALTER TABLE "friend_connections" ADD CONSTRAINT "friend_connections_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_connections" ADD CONSTRAINT "friend_connections_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friend_connections_pair_uidx" ON "friend_connections" USING btree ("user_a_id","user_b_id");--> statement-breakpoint
CREATE INDEX "friend_connections_user_a_idx" ON "friend_connections" USING btree ("user_a_id");--> statement-breakpoint
CREATE INDEX "friend_connections_user_b_idx" ON "friend_connections" USING btree ("user_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friend_link_requests_pending_owner_friend_uidx" ON "friend_link_requests" USING btree ("owner_user_id","friend_id") WHERE "friend_link_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "friend_link_requests_pending_owner_target_uidx" ON "friend_link_requests" USING btree ("owner_user_id","target_user_id") WHERE "friend_link_requests"."status" = 'pending';
