CREATE TABLE "debtor_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"owner_user_id" text NOT NULL,
	"friend_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "debtor_share_links_token_hash_hex" CHECK ("debtor_share_links"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "debtor_share_links_expires_after_created" CHECK ("debtor_share_links"."expires_at" > "debtor_share_links"."created_at"),
	CONSTRAINT "debtor_share_links_revoked_after_created" CHECK ("debtor_share_links"."revoked_at" IS NULL OR "debtor_share_links"."revoked_at" >= "debtor_share_links"."created_at")
);
--> statement-breakpoint
ALTER TABLE "debtor_share_links" ADD CONSTRAINT "debtor_share_links_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debtor_share_links" ADD CONSTRAINT "debtor_share_links_owner_friend_fk" FOREIGN KEY ("owner_user_id","friend_id") REFERENCES "public"."friends"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "debtor_share_links_token_hash_uidx" ON "debtor_share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "debtor_share_links_active_owner_friend_uidx" ON "debtor_share_links" USING btree ("owner_user_id","friend_id") WHERE "debtor_share_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "debtor_share_links_owner_friend_idx" ON "debtor_share_links" USING btree ("owner_user_id","friend_id");--> statement-breakpoint
CREATE INDEX "debtor_share_links_expires_at_idx" ON "debtor_share_links" USING btree ("expires_at");