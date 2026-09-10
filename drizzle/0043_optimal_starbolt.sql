CREATE TABLE "budget_recurring_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"recurring_template_id" uuid NOT NULL,
	"scheduled_period_id" uuid NOT NULL,
	"scheduled_on" date NOT NULL,
	"amount" integer NOT NULL,
	"category_id" uuid NOT NULL,
	"spread_count" integer NOT NULL,
	"status" varchar(16) DEFAULT 'due' NOT NULL,
	"budget_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_recurring_occurrences_owner_id_unique" UNIQUE("owner_user_id","id"),
	CONSTRAINT "budget_recurring_occurrences_identity_unique" UNIQUE("owner_user_id","recurring_template_id","scheduled_on"),
	CONSTRAINT "budget_recurring_occurrences_amount_positive" CHECK ("budget_recurring_occurrences"."amount" > 0),
	CONSTRAINT "budget_recurring_occurrences_spread_count_range" CHECK ("budget_recurring_occurrences"."spread_count" BETWEEN 1 AND 24),
	CONSTRAINT "budget_recurring_occurrences_spread_count_fits_amount" CHECK ("budget_recurring_occurrences"."spread_count" <= "budget_recurring_occurrences"."amount"),
	CONSTRAINT "budget_recurring_occurrences_status_allowed" CHECK ("budget_recurring_occurrences"."status" IN ('due', 'recorded', 'skipped')),
	CONSTRAINT "budget_recurring_occurrences_lifecycle" CHECK (("budget_recurring_occurrences"."status" = 'recorded' AND "budget_recurring_occurrences"."budget_transaction_id" IS NOT NULL) OR ("budget_recurring_occurrences"."status" IN ('due', 'skipped') AND "budget_recurring_occurrences"."budget_transaction_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "budget_recurring_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" varchar(240) NOT NULL,
	"amount" integer NOT NULL,
	"category_id" uuid NOT NULL,
	"frequency" varchar(32) NOT NULL,
	"starts_on" date NOT NULL,
	"spread_count" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_recurring_templates_owner_id_unique" UNIQUE("owner_user_id","id"),
	CONSTRAINT "budget_recurring_templates_name_not_blank" CHECK (btrim("budget_recurring_templates"."name") <> ''),
	CONSTRAINT "budget_recurring_templates_amount_positive" CHECK ("budget_recurring_templates"."amount" > 0),
	CONSTRAINT "budget_recurring_templates_frequency_allowed" CHECK ("budget_recurring_templates"."frequency" IN ('every_budget_period', 'monthly')),
	CONSTRAINT "budget_recurring_templates_spread_count_range" CHECK ("budget_recurring_templates"."spread_count" BETWEEN 1 AND 24),
	CONSTRAINT "budget_recurring_templates_spread_count_fits_amount" CHECK ("budget_recurring_templates"."spread_count" <= "budget_recurring_templates"."amount")
);
--> statement-breakpoint
ALTER TABLE "budget_recurring_occurrences" ADD CONSTRAINT "budget_recurring_occurrences_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_recurring_occurrences" ADD CONSTRAINT "budget_recurring_occurrences_owner_template_fk" FOREIGN KEY ("owner_user_id","recurring_template_id") REFERENCES "public"."budget_recurring_templates"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_recurring_occurrences" ADD CONSTRAINT "budget_recurring_occurrences_owner_period_fk" FOREIGN KEY ("owner_user_id","scheduled_period_id") REFERENCES "public"."budget_periods"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_recurring_occurrences" ADD CONSTRAINT "budget_recurring_occurrences_owner_category_fk" FOREIGN KEY ("owner_user_id","category_id") REFERENCES "public"."budget_categories"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_recurring_occurrences" ADD CONSTRAINT "budget_recurring_occurrences_owner_transaction_fk" FOREIGN KEY ("owner_user_id","budget_transaction_id") REFERENCES "public"."budget_transactions"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_recurring_templates" ADD CONSTRAINT "budget_recurring_templates_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_recurring_templates" ADD CONSTRAINT "budget_recurring_templates_owner_category_fk" FOREIGN KEY ("owner_user_id","category_id") REFERENCES "public"."budget_categories"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_recurring_occurrences_owner_transaction_uidx" ON "budget_recurring_occurrences" USING btree ("owner_user_id","budget_transaction_id") WHERE "budget_recurring_occurrences"."budget_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "budget_recurring_occurrences_owner_status_scheduled_idx" ON "budget_recurring_occurrences" USING btree ("owner_user_id","status","scheduled_on","id");--> statement-breakpoint
CREATE INDEX "budget_recurring_occurrences_owner_period_idx" ON "budget_recurring_occurrences" USING btree ("owner_user_id","scheduled_period_id");--> statement-breakpoint
CREATE INDEX "budget_recurring_occurrences_owner_template_idx" ON "budget_recurring_occurrences" USING btree ("owner_user_id","recurring_template_id");--> statement-breakpoint
CREATE INDEX "budget_recurring_templates_owner_archived_idx" ON "budget_recurring_templates" USING btree ("owner_user_id","archived_at");