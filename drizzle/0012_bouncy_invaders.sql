CREATE TABLE "repayment_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"repayment_id" uuid NOT NULL,
	"original_filename" varchar(160) NOT NULL,
	"media_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repayment_proofs_media_type_allowed" CHECK ("repayment_proofs"."media_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "repayment_proofs_byte_size_valid" CHECK ("repayment_proofs"."byte_size" BETWEEN 1 AND 5242880),
	CONSTRAINT "repayment_proofs_content_size_matches" CHECK (octet_length("repayment_proofs"."content") = "repayment_proofs"."byte_size"),
	CONSTRAINT "repayment_proofs_filename_not_blank" CHECK (btrim("repayment_proofs"."original_filename") <> ''),
	CONSTRAINT "repayment_proofs_sha256_hex" CHECK ("repayment_proofs"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "repayment_proofs" ADD CONSTRAINT "repayment_proofs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_proofs" ADD CONSTRAINT "repayment_proofs_owner_repayment_fk" FOREIGN KEY ("owner_user_id","repayment_id") REFERENCES "public"."repayments"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repayment_proofs_owner_repayment_uidx" ON "repayment_proofs" USING btree ("owner_user_id","repayment_id");