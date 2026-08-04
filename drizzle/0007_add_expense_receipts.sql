CREATE TABLE "expense_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"expense_id" uuid NOT NULL,
	"original_filename" varchar(160) NOT NULL,
	"media_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_receipts_media_type_allowed" CHECK ("expense_receipts"."media_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "expense_receipts_byte_size_valid" CHECK ("expense_receipts"."byte_size" BETWEEN 1 AND 5242880),
	CONSTRAINT "expense_receipts_content_size_matches" CHECK (octet_length("expense_receipts"."content") = "expense_receipts"."byte_size"),
	CONSTRAINT "expense_receipts_filename_not_blank" CHECK (btrim("expense_receipts"."original_filename") <> ''),
	CONSTRAINT "expense_receipts_sha256_hex" CHECK ("expense_receipts"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_owner_expense_fk" FOREIGN KEY ("owner_user_id","expense_id") REFERENCES "public"."expenses"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_receipts_owner_expense_sha256_uidx" ON "expense_receipts" USING btree ("owner_user_id","expense_id","sha256");--> statement-breakpoint
CREATE INDEX "expense_receipts_owner_expense_created_id_idx" ON "expense_receipts" USING btree ("owner_user_id","expense_id","created_at","id");