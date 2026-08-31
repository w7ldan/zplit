CREATE TABLE "organization_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text,
	"source_personal_friend_id" uuid,
	"display_name" varchar(160),
	"label" varchar(120),
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_participants_organization_id_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "organization_participants_identity_shape" CHECK (("organization_participants"."user_id" IS NOT NULL AND "organization_participants"."display_name" IS NULL) OR ("organization_participants"."user_id" IS NULL AND "organization_participants"."display_name" IS NOT NULL AND btrim("organization_participants"."display_name") <> '')),
	CONSTRAINT "organization_participants_label_not_blank" CHECK ("organization_participants"."label" IS NULL OR btrim("organization_participants"."label") <> '')
);
--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD COLUMN "participant_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD COLUMN "participant_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_participants" ADD CONSTRAINT "organization_participants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_participants" ADD CONSTRAINT "organization_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_participants" ADD CONSTRAINT "organization_participants_source_personal_friend_id_friends_id_fk" FOREIGN KEY ("source_personal_friend_id") REFERENCES "public"."friends"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_participants" ADD CONSTRAINT "organization_participants_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_participants_registered_user_uidx" ON "organization_participants" USING btree ("organization_id","user_id") WHERE "organization_participants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_participants_source_personal_friend_uidx" ON "organization_participants" USING btree ("organization_id","source_personal_friend_id") WHERE "organization_participants"."source_personal_friend_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "organization_participants_organization_idx" ON "organization_participants" USING btree ("organization_id");--> statement-breakpoint
INSERT INTO "organization_participants" ("organization_id", "user_id", "created_by_user_id", "created_at", "updated_at")
SELECT "organization_id", "user_id", "user_id", "joined_at", "joined_at"
FROM "organization_memberships"
ON CONFLICT ("organization_id", "user_id") DO NOTHING;--> statement-breakpoint
UPDATE "organization_memberships" AS memberships
SET "participant_id" = participants."id"
FROM "organization_participants" AS participants
WHERE participants."organization_id" = memberships."organization_id"
  AND participants."user_id" = memberships."user_id";--> statement-breakpoint
ALTER TABLE "organization_memberships" ALTER COLUMN "participant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_participant_fk" FOREIGN KEY ("organization_id","participant_id") REFERENCES "public"."organization_participants"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_participant_fk" FOREIGN KEY ("organization_id","participant_id") REFERENCES "public"."organization_participants"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_participant_uidx" ON "organization_memberships" USING btree ("organization_id","participant_id");
