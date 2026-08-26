CREATE TABLE "group_avatars" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"media_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_avatars_media_type_allowed" CHECK ("group_avatars"."media_type" = 'image/webp'),
	CONSTRAINT "group_avatars_byte_size_valid" CHECK ("group_avatars"."byte_size" BETWEEN 1 AND 5242880),
	CONSTRAINT "group_avatars_content_size_matches" CHECK (octet_length("group_avatars"."content") = "group_avatars"."byte_size"),
	CONSTRAINT "group_avatars_sha256_hex" CHECK ("group_avatars"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "group_memberships" (
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"participant_id" uuid NOT NULL,
	"role" varchar(16) DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_memberships_group_id_user_id_pk" PRIMARY KEY("group_id","user_id"),
	CONSTRAINT "group_memberships_role_allowed" CHECK ("group_memberships"."role" IN ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "group_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" text,
	"display_name" varchar(160),
	"label" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_participants_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_participants_group_user_id_unique" UNIQUE("group_id","user_id","id"),
	CONSTRAINT "group_participants_identity_shape" CHECK (("group_participants"."user_id" IS NOT NULL AND "group_participants"."display_name" IS NULL) OR ("group_participants"."user_id" IS NULL AND "group_participants"."display_name" IS NOT NULL AND btrim("group_participants"."display_name") <> '')),
	CONSTRAINT "group_participants_label_not_blank" CHECK ("group_participants"."label" IS NULL OR btrim("group_participants"."label") <> '')
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_not_blank" CHECK (btrim("groups"."name") <> ''),
	CONSTRAINT "groups_description_not_blank" CHECK ("groups"."description" IS NULL OR btrim("groups"."description") <> '')
);
--> statement-breakpoint
ALTER TABLE "group_avatars" ADD CONSTRAINT "group_avatars_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_participant_fk" FOREIGN KEY ("group_id","participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_registered_participant_fk" FOREIGN KEY ("group_id","user_id","participant_id") REFERENCES "public"."group_participants"("group_id","user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_participants" ADD CONSTRAINT "group_participants_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_participants" ADD CONSTRAINT "group_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_memberships_group_participant_uidx" ON "group_memberships" USING btree ("group_id","participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_memberships_one_owner_uidx" ON "group_memberships" USING btree ("group_id") WHERE "group_memberships"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "group_memberships_user_idx" ON "group_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_participants_registered_user_uidx" ON "group_participants" USING btree ("group_id","user_id") WHERE "group_participants"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "group_participants_group_idx" ON "group_participants" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "groups_name_idx" ON "groups" USING btree ("name");--> statement-breakpoint
CREATE INDEX "groups_created_by_user_idx" ON "groups" USING btree ("created_by_user_id");