CREATE TABLE "budget_group_expense_exclusions" (
	"owner_user_id" text NOT NULL,
	"group_expense_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_group_expense_exclusions_pkey" PRIMARY KEY("owner_user_id","group_expense_id")
);
--> statement-breakpoint
CREATE TABLE "budget_personal_expense_exclusions" (
	"owner_user_id" text NOT NULL,
	"expense_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_personal_expense_exclusions_pkey" PRIMARY KEY("owner_user_id","expense_id")
);
--> statement-breakpoint
ALTER TABLE "budget_profiles" ADD COLUMN "include_new_expenses_by_default" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_group_expense_exclusions" ADD CONSTRAINT "budget_group_expense_exclusions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_group_expense_exclusions" ADD CONSTRAINT "budget_group_expense_exclusions_group_expense_id_group_expenses_id_fk" FOREIGN KEY ("group_expense_id") REFERENCES "public"."group_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_personal_expense_exclusions" ADD CONSTRAINT "budget_personal_expense_exclusions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_personal_expense_exclusions" ADD CONSTRAINT "budget_personal_expense_exclusions_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_group_expense_exclusions_expense_idx" ON "budget_group_expense_exclusions" USING btree ("group_expense_id");--> statement-breakpoint
CREATE INDEX "budget_personal_expense_exclusions_expense_idx" ON "budget_personal_expense_exclusions" USING btree ("expense_id");