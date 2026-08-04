CREATE TABLE "account_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"email" varchar(254) NOT NULL,
	"suggested_name" varchar(120),
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "account_invitations_token_hash_hex" CHECK ("account_invitations"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "account_invitations_email_lowercase" CHECK ("account_invitations"."email" = lower("account_invitations"."email")),
	CONSTRAINT "account_invitations_suggested_name_not_blank" CHECK ("account_invitations"."suggested_name" IS NULL OR btrim("account_invitations"."suggested_name") <> ''),
	CONSTRAINT "account_invitations_expires_after_created" CHECK ("account_invitations"."expires_at" > "account_invitations"."created_at"),
	CONSTRAINT "account_invitations_claimed_after_created" CHECK ("account_invitations"."claimed_at" IS NULL OR "account_invitations"."claimed_at" >= "account_invitations"."created_at"),
	CONSTRAINT "account_invitations_accepted_pair" CHECK (("account_invitations"."accepted_at" IS NULL) = ("account_invitations"."accepted_user_id" IS NULL)),
	CONSTRAINT "account_invitations_accepted_after_claimed" CHECK ("account_invitations"."accepted_at" IS NULL OR ("account_invitations"."claimed_at" IS NOT NULL AND "account_invitations"."accepted_at" >= "account_invitations"."claimed_at")),
	CONSTRAINT "account_invitations_revoked_after_created" CHECK ("account_invitations"."revoked_at" IS NULL OR "account_invitations"."revoked_at" >= "account_invitations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "account_invitations" ADD CONSTRAINT "account_invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_invitations" ADD CONSTRAINT "account_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_invitations_token_hash_uidx" ON "account_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "account_invitations_created_by_user_id_idx" ON "account_invitations" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "account_invitations_email_idx" ON "account_invitations" USING btree ("email");