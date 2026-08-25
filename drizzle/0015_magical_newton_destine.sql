CREATE TABLE "user_avatars" (
	"user_id" text PRIMARY KEY NOT NULL,
	"media_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_avatars_media_type_allowed" CHECK ("user_avatars"."media_type" = 'image/webp'),
	CONSTRAINT "user_avatars_byte_size_valid" CHECK ("user_avatars"."byte_size" BETWEEN 1 AND 5242880),
	CONSTRAINT "user_avatars_content_size_matches" CHECK (octet_length("user_avatars"."content") = "user_avatars"."byte_size"),
	CONSTRAINT "user_avatars_sha256_hex" CHECK ("user_avatars"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;