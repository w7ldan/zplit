CREATE TABLE "budget_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"normalized_name" varchar(80) NOT NULL,
	"system_key" varchar(64),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_categories_owner_id_unique" UNIQUE("owner_user_id","id"),
	CONSTRAINT "budget_categories_name_not_blank" CHECK (btrim("budget_categories"."name") <> ''),
	CONSTRAINT "budget_categories_normalized_name_not_blank" CHECK (btrim("budget_categories"."normalized_name") <> '')
);
--> statement-breakpoint
CREATE TABLE "budget_impacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"budget_transaction_id" uuid NOT NULL,
	"budget_category_id" uuid NOT NULL,
	"budget_period_id" uuid,
	"amount" integer NOT NULL,
	"status" varchar(16) DEFAULT 'applied' NOT NULL,
	"target_period_ordinal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_impacts_owner_id_unique" UNIQUE("owner_user_id","id"),
	CONSTRAINT "budget_impacts_amount_positive" CHECK ("budget_impacts"."amount" > 0),
	CONSTRAINT "budget_impacts_target_period_ordinal_positive" CHECK ("budget_impacts"."target_period_ordinal" >= 1),
	CONSTRAINT "budget_impacts_status_allowed" CHECK ("budget_impacts"."status" IN ('applied', 'pending')),
	CONSTRAINT "budget_impacts_period_shape" CHECK (("budget_impacts"."status" = 'applied' AND "budget_impacts"."budget_period_id" IS NOT NULL) OR ("budget_impacts"."status" = 'pending' AND "budget_impacts"."budget_period_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "budget_period_categories" (
	"owner_user_id" text NOT NULL,
	"budget_period_id" uuid NOT NULL,
	"budget_category_id" uuid NOT NULL,
	"allocated_amount" integer NOT NULL,
	"display_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_period_categories_owner_user_id_budget_period_id_budget_category_id_pk" PRIMARY KEY("owner_user_id","budget_period_id","budget_category_id"),
	CONSTRAINT "budget_period_categories_allocated_amount_nonnegative" CHECK ("budget_period_categories"."allocated_amount" >= 0),
	CONSTRAINT "budget_period_categories_display_order_nonnegative" CHECK ("budget_period_categories"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "budget_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"total_budget" integer NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_periods_owner_id_unique" UNIQUE("owner_user_id","id"),
	CONSTRAINT "budget_periods_ordinal_positive" CHECK ("budget_periods"."ordinal" >= 1),
	CONSTRAINT "budget_periods_name_not_blank" CHECK (btrim("budget_periods"."name") <> ''),
	CONSTRAINT "budget_periods_date_range_valid" CHECK ("budget_periods"."starts_on" <= "budget_periods"."ends_on"),
	CONSTRAINT "budget_periods_total_budget_positive" CHECK ("budget_periods"."total_budget" > 0),
	CONSTRAINT "budget_periods_status_allowed" CHECK ("budget_periods"."status" IN ('active', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "budget_profiles" (
	"owner_user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"direction" varchar(16) NOT NULL,
	"amount" integer NOT NULL,
	"description" varchar(240) NOT NULL,
	"occurred_on" date NOT NULL,
	"status" varchar(16) DEFAULT 'posted' NOT NULL,
	"origin" varchar(16) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	CONSTRAINT "budget_transactions_owner_id_unique" UNIQUE("owner_user_id","id"),
	CONSTRAINT "budget_transactions_direction_allowed" CHECK ("budget_transactions"."direction" IN ('outflow', 'inflow')),
	CONSTRAINT "budget_transactions_amount_positive" CHECK ("budget_transactions"."amount" > 0),
	CONSTRAINT "budget_transactions_description_not_blank" CHECK (btrim("budget_transactions"."description") <> ''),
	CONSTRAINT "budget_transactions_status_allowed" CHECK ("budget_transactions"."status" IN ('posted', 'voided')),
	CONSTRAINT "budget_transactions_origin_allowed" CHECK ("budget_transactions"."origin" IN ('manual', 'linked', 'recurring')),
	CONSTRAINT "budget_transactions_void_timestamp_shape" CHECK (("budget_transactions"."status" = 'posted' AND "budget_transactions"."voided_at" IS NULL) OR ("budget_transactions"."status" = 'voided' AND "budget_transactions"."voided_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_impacts" ADD CONSTRAINT "budget_impacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_impacts" ADD CONSTRAINT "budget_impacts_owner_transaction_fk" FOREIGN KEY ("owner_user_id","budget_transaction_id") REFERENCES "public"."budget_transactions"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_impacts" ADD CONSTRAINT "budget_impacts_owner_category_fk" FOREIGN KEY ("owner_user_id","budget_category_id") REFERENCES "public"."budget_categories"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_impacts" ADD CONSTRAINT "budget_impacts_owner_period_fk" FOREIGN KEY ("owner_user_id","budget_period_id") REFERENCES "public"."budget_periods"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_categories" ADD CONSTRAINT "budget_period_categories_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_categories" ADD CONSTRAINT "budget_period_categories_owner_period_fk" FOREIGN KEY ("owner_user_id","budget_period_id") REFERENCES "public"."budget_periods"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_categories" ADD CONSTRAINT "budget_period_categories_owner_category_fk" FOREIGN KEY ("owner_user_id","budget_category_id") REFERENCES "public"."budget_categories"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_profiles" ADD CONSTRAINT "budget_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_transactions" ADD CONSTRAINT "budget_transactions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_categories_owner_normalized_name_uidx" ON "budget_categories" USING btree ("owner_user_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_categories_owner_system_key_uidx" ON "budget_categories" USING btree ("owner_user_id","system_key") WHERE "budget_categories"."system_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "budget_categories_owner_archived_idx" ON "budget_categories" USING btree ("owner_user_id","archived_at");--> statement-breakpoint
CREATE INDEX "budget_impacts_owner_period_status_idx" ON "budget_impacts" USING btree ("owner_user_id","budget_period_id","status");--> statement-breakpoint
CREATE INDEX "budget_impacts_owner_transaction_idx" ON "budget_impacts" USING btree ("owner_user_id","budget_transaction_id");--> statement-breakpoint
CREATE INDEX "budget_period_categories_owner_period_order_idx" ON "budget_period_categories" USING btree ("owner_user_id","budget_period_id","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_periods_owner_ordinal_uidx" ON "budget_periods" USING btree ("owner_user_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_periods_active_owner_uidx" ON "budget_periods" USING btree ("owner_user_id") WHERE "budget_periods"."status" = 'active';--> statement-breakpoint
CREATE INDEX "budget_periods_owner_status_idx" ON "budget_periods" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "budget_transactions_owner_occurred_idx" ON "budget_transactions" USING btree ("owner_user_id","occurred_on","id");