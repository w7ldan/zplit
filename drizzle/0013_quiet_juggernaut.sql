CREATE TABLE "repayment_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"type" varchar(16) NOT NULL,
	"name" varchar(120) NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"account_name" varchar(120),
	"note" varchar(1000),
	"share_on_balance_links" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repayment_destinations_type_allowed" CHECK ("repayment_destinations"."type" IN ('bank_account', 'e_wallet', 'other')),
	CONSTRAINT "repayment_destinations_name_not_blank" CHECK (btrim("repayment_destinations"."name") <> ''),
	CONSTRAINT "repayment_destinations_identifier_not_blank" CHECK (btrim("repayment_destinations"."identifier") <> ''),
	CONSTRAINT "repayment_destinations_account_name_not_blank" CHECK ("repayment_destinations"."account_name" IS NULL OR btrim("repayment_destinations"."account_name") <> ''),
	CONSTRAINT "repayment_destinations_note_not_blank" CHECK ("repayment_destinations"."note" IS NULL OR btrim("repayment_destinations"."note") <> ''),
	CONSTRAINT "repayment_destinations_sort_order_nonnegative" CHECK ("repayment_destinations"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "repayment_destinations" ADD CONSTRAINT "repayment_destinations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repayment_destinations_owner_order_idx" ON "repayment_destinations" USING btree ("owner_user_id","sort_order","id");
