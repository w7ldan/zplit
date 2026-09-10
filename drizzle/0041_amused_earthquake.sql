CREATE TABLE "budget_group_expense_sources" (
	"owner_user_id" text NOT NULL,
	"budget_transaction_id" uuid NOT NULL,
	"group_expense_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_group_expense_sources_owner_expense_unique" UNIQUE("owner_user_id","group_expense_id"),
	CONSTRAINT "budget_group_expense_sources_owner_transaction_unique" UNIQUE("owner_user_id","budget_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "budget_group_obligation_classifications" (
	"owner_user_id" text NOT NULL,
	"group_obligation_id" uuid NOT NULL,
	"budget_category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_group_obligation_classifications_owner_obligation_unique" UNIQUE("owner_user_id","group_obligation_id")
);
--> statement-breakpoint
CREATE TABLE "budget_group_settlement_sources" (
	"owner_user_id" text NOT NULL,
	"budget_transaction_id" uuid NOT NULL,
	"group_settlement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_group_settlement_sources_owner_settlement_unique" UNIQUE("owner_user_id","group_settlement_id"),
	CONSTRAINT "budget_group_settlement_sources_owner_transaction_unique" UNIQUE("owner_user_id","budget_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "budget_group_expense_sources" ADD CONSTRAINT "budget_group_expense_sources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_group_expense_sources" ADD CONSTRAINT "budget_group_expense_sources_group_expense_id_group_expenses_id_fk" FOREIGN KEY ("group_expense_id") REFERENCES "public"."group_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_group_expense_sources" ADD CONSTRAINT "budget_group_expense_sources_owner_transaction_fk" FOREIGN KEY ("owner_user_id","budget_transaction_id") REFERENCES "public"."budget_transactions"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_group_obligation_classifications" ADD CONSTRAINT "budget_group_obligation_classifications_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_group_obligation_classifications" ADD CONSTRAINT "budget_group_obligation_classifications_group_obligation_id_group_obligations_id_fk" FOREIGN KEY ("group_obligation_id") REFERENCES "public"."group_obligations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_group_obligation_classifications" ADD CONSTRAINT "budget_group_obligation_classifications_owner_category_fk" FOREIGN KEY ("owner_user_id","budget_category_id") REFERENCES "public"."budget_categories"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_group_settlement_sources" ADD CONSTRAINT "budget_group_settlement_sources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_group_settlement_sources" ADD CONSTRAINT "budget_group_settlement_sources_group_settlement_id_group_settlements_id_fk" FOREIGN KEY ("group_settlement_id") REFERENCES "public"."group_settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_group_settlement_sources" ADD CONSTRAINT "budget_group_settlement_sources_owner_transaction_fk" FOREIGN KEY ("owner_user_id","budget_transaction_id") REFERENCES "public"."budget_transactions"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_group_expense_sources_expense_idx" ON "budget_group_expense_sources" USING btree ("group_expense_id");--> statement-breakpoint
CREATE INDEX "budget_group_obligation_classifications_obligation_idx" ON "budget_group_obligation_classifications" USING btree ("group_obligation_id");--> statement-breakpoint
CREATE INDEX "budget_group_settlement_sources_settlement_idx" ON "budget_group_settlement_sources" USING btree ("group_settlement_id");