CREATE TABLE "organization_avatars" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"media_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_avatars_media_type_allowed" CHECK ("organization_avatars"."media_type" = 'image/webp'),
	CONSTRAINT "organization_avatars_byte_size_valid" CHECK ("organization_avatars"."byte_size" BETWEEN 1 AND 5242880),
	CONSTRAINT "organization_avatars_content_size_matches" CHECK (octet_length("organization_avatars"."content") = "organization_avatars"."byte_size"),
	CONSTRAINT "organization_avatars_sha256_hex" CHECK ("organization_avatars"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(32) DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "organization_memberships_role_allowed" CHECK ("organization_memberships"."role" IN ('owner', 'admin', 'treasurer', 'member', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_name_not_blank" CHECK (btrim("organizations"."name") <> ''),
	CONSTRAINT "organizations_description_not_blank" CHECK ("organizations"."description" IS NULL OR btrim("organizations"."description") <> '')
);
--> statement-breakpoint
ALTER TABLE "organization_avatars" ADD CONSTRAINT "organization_avatars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_memberships_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "organizations_name_idx" ON "organizations" USING btree ("name");--> statement-breakpoint
UPDATE friends AS f
SET archived_at = NULL, updated_at = now()
FROM friend_connections AS c
WHERE c.status = 'connected'
  AND ((f.owner_user_id = c.user_a_id AND f.linked_user_id = c.user_b_id)
    OR (f.owner_user_id = c.user_b_id AND f.linked_user_id = c.user_a_id));--> statement-breakpoint
INSERT INTO friends (owner_user_id, linked_user_id, name)
SELECT c.user_a_id, c.user_b_id, peer.name
FROM friend_connections AS c
INNER JOIN users AS peer ON peer.id = c.user_b_id
WHERE c.status = 'connected'
  AND NOT EXISTS (
    SELECT 1 FROM friends AS f
    WHERE f.owner_user_id = c.user_a_id AND f.linked_user_id = c.user_b_id
  );--> statement-breakpoint
INSERT INTO friends (owner_user_id, linked_user_id, name)
SELECT c.user_b_id, c.user_a_id, peer.name
FROM friend_connections AS c
INNER JOIN users AS peer ON peer.id = c.user_a_id
WHERE c.status = 'connected'
  AND NOT EXISTS (
    SELECT 1 FROM friends AS f
    WHERE f.owner_user_id = c.user_b_id AND f.linked_user_id = c.user_a_id
  );
