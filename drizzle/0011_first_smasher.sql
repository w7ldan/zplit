CREATE TABLE "expense_charge_targets" (
	"owner_user_id" text NOT NULL,
	"expense_id" uuid NOT NULL,
	"expense_charge_id" uuid NOT NULL,
	"expense_share_id" uuid NOT NULL,
	CONSTRAINT "expense_charge_targets_owner_user_id_expense_charge_id_expense_share_id_pk" PRIMARY KEY("owner_user_id","expense_charge_id","expense_share_id")
);
--> statement-breakpoint
CREATE TABLE "expense_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"expense_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"percentage_basis_points" integer NOT NULL,
	"scope" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_charges_name_not_blank" CHECK (btrim("expense_charges"."name") <> ''),
	CONSTRAINT "expense_charges_percentage_basis_points_valid" CHECK ("expense_charges"."percentage_basis_points" BETWEEN 0 AND 1000000),
	CONSTRAINT "expense_charges_scope_valid" CHECK ("expense_charges"."scope" IN ('all', 'selected'))
);
--> statement-breakpoint
ALTER TABLE "expense_shares" ADD COLUMN "base_amount" integer;--> statement-breakpoint
UPDATE "expense_shares" SET "base_amount" = "amount_owed";--> statement-breakpoint
ALTER TABLE "expense_shares" ALTER COLUMN "base_amount" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_charge_targets" ADD CONSTRAINT "expense_charge_targets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_charges" ADD CONSTRAINT "expense_charges_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_charges" ADD CONSTRAINT "expense_charges_owner_expense_fk" FOREIGN KEY ("owner_user_id","expense_id") REFERENCES "public"."expenses"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_charge_targets_owner_charge_idx" ON "expense_charge_targets" USING btree ("owner_user_id","expense_charge_id");--> statement-breakpoint
CREATE INDEX "expense_charge_targets_owner_share_idx" ON "expense_charge_targets" USING btree ("owner_user_id","expense_share_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_charges_owner_user_id_id_uidx" ON "expense_charges" USING btree ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_charges_owner_expense_id_id_uidx" ON "expense_charges" USING btree ("owner_user_id","expense_id","id");--> statement-breakpoint
CREATE INDEX "expense_charges_owner_expense_id_idx" ON "expense_charges" USING btree ("owner_user_id","expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_shares_owner_expense_id_id_uidx" ON "expense_shares" USING btree ("owner_user_id","expense_id","id");--> statement-breakpoint
ALTER TABLE "expense_charge_targets" ADD CONSTRAINT "expense_charge_targets_owner_charge_fk" FOREIGN KEY ("owner_user_id","expense_id","expense_charge_id") REFERENCES "public"."expense_charges"("owner_user_id","expense_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_charge_targets" ADD CONSTRAINT "expense_charge_targets_owner_share_fk" FOREIGN KEY ("owner_user_id","expense_id","expense_share_id") REFERENCES "public"."expense_shares"("owner_user_id","expense_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_base_amount_positive" CHECK ("expense_shares"."base_amount" > 0);
