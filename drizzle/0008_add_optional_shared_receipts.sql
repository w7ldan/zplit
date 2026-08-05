CREATE TABLE "debtor_share_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"debtor_share_link_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"expense_receipt_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "debtor_share_links_owner_user_id_id_uidx" ON "debtor_share_links" USING btree ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_receipts_owner_expense_id_uidx" ON "expense_receipts" USING btree ("owner_user_id","expense_id","id");--> statement-breakpoint
ALTER TABLE "debtor_share_receipts" ADD CONSTRAINT "debtor_share_receipts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debtor_share_receipts" ADD CONSTRAINT "debtor_share_receipts_owner_link_fk" FOREIGN KEY ("owner_user_id","debtor_share_link_id") REFERENCES "public"."debtor_share_links"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debtor_share_receipts" ADD CONSTRAINT "debtor_share_receipts_owner_expense_receipt_fk" FOREIGN KEY ("owner_user_id","expense_id","expense_receipt_id") REFERENCES "public"."expense_receipts"("owner_user_id","expense_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "debtor_share_receipts_link_receipt_uidx" ON "debtor_share_receipts" USING btree ("owner_user_id","debtor_share_link_id","expense_receipt_id");--> statement-breakpoint
CREATE INDEX "debtor_share_receipts_link_idx" ON "debtor_share_receipts" USING btree ("owner_user_id","debtor_share_link_id");--> statement-breakpoint
CREATE INDEX "debtor_share_receipts_public_id_idx" ON "debtor_share_receipts" USING btree ("id");
