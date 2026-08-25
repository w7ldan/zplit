CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"target_user_id" text NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"role" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "organization_invitations_target_not_inviter" CHECK ("organization_invitations"."target_user_id" <> "organization_invitations"."invited_by_user_id"),
	CONSTRAINT "organization_invitations_role_allowed" CHECK ("organization_invitations"."role" IN ('admin', 'treasurer', 'member')),
	CONSTRAINT "organization_invitations_status_allowed" CHECK ("organization_invitations"."status" IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
	CONSTRAINT "organization_invitations_expires_after_created" CHECK ("organization_invitations"."expires_at" > "organization_invitations"."created_at"),
	CONSTRAINT "organization_invitations_transition_timestamps" CHECK (("organization_invitations"."status" = 'pending' AND "organization_invitations"."accepted_at" IS NULL AND "organization_invitations"."declined_at" IS NULL AND "organization_invitations"."revoked_at" IS NULL AND "organization_invitations"."expired_at" IS NULL) OR ("organization_invitations"."status" = 'accepted' AND "organization_invitations"."accepted_at" IS NOT NULL AND "organization_invitations"."declined_at" IS NULL AND "organization_invitations"."revoked_at" IS NULL AND "organization_invitations"."expired_at" IS NULL) OR ("organization_invitations"."status" = 'declined' AND "organization_invitations"."accepted_at" IS NULL AND "organization_invitations"."declined_at" IS NOT NULL AND "organization_invitations"."revoked_at" IS NULL AND "organization_invitations"."expired_at" IS NULL) OR ("organization_invitations"."status" = 'revoked' AND "organization_invitations"."accepted_at" IS NULL AND "organization_invitations"."declined_at" IS NULL AND "organization_invitations"."revoked_at" IS NOT NULL AND "organization_invitations"."expired_at" IS NULL) OR ("organization_invitations"."status" = 'expired' AND "organization_invitations"."accepted_at" IS NULL AND "organization_invitations"."declined_at" IS NULL AND "organization_invitations"."revoked_at" IS NULL AND "organization_invitations"."expired_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitations_pending_organization_target_uidx" ON "organization_invitations" USING btree ("organization_id","target_user_id") WHERE "organization_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "organization_invitations_organization_status_idx" ON "organization_invitations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "organization_invitations_target_status_idx" ON "organization_invitations" USING btree ("target_user_id","status");--> statement-breakpoint
CREATE INDEX "organization_invitations_expires_at_idx" ON "organization_invitations" USING btree ("expires_at");