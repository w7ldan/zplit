CREATE TABLE "budget_personal_expense_sources" (
	"owner_user_id" text NOT NULL,
	"budget_transaction_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_personal_expense_sources_owner_expense_unique" UNIQUE("owner_user_id","expense_id"),
	CONSTRAINT "budget_personal_expense_sources_owner_transaction_unique" UNIQUE("owner_user_id","budget_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "budget_personal_repayment_sources" (
	"owner_user_id" text NOT NULL,
	"budget_transaction_id" uuid NOT NULL,
	"repayment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_personal_repayment_sources_owner_repayment_unique" UNIQUE("owner_user_id","repayment_id"),
	CONSTRAINT "budget_personal_repayment_sources_owner_transaction_unique" UNIQUE("owner_user_id","budget_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "budget_personal_expense_sources" ADD CONSTRAINT "budget_personal_expense_sources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_personal_expense_sources" ADD CONSTRAINT "budget_personal_expense_sources_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_personal_expense_sources" ADD CONSTRAINT "budget_personal_expense_sources_owner_transaction_fk" FOREIGN KEY ("owner_user_id","budget_transaction_id") REFERENCES "public"."budget_transactions"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_personal_repayment_sources" ADD CONSTRAINT "budget_personal_repayment_sources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_personal_repayment_sources" ADD CONSTRAINT "budget_personal_repayment_sources_repayment_id_repayments_id_fk" FOREIGN KEY ("repayment_id") REFERENCES "public"."repayments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_personal_repayment_sources" ADD CONSTRAINT "budget_personal_repayment_sources_owner_transaction_fk" FOREIGN KEY ("owner_user_id","budget_transaction_id") REFERENCES "public"."budget_transactions"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_personal_expense_sources_expense_idx" ON "budget_personal_expense_sources" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "budget_personal_repayment_sources_repayment_idx" ON "budget_personal_repayment_sources" USING btree ("repayment_id");