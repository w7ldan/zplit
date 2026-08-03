CREATE TABLE "expense_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"friend_id" uuid NOT NULL,
	"amount_owed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_shares_amount_owed_positive" CHECK ("expense_shares"."amount_owed" > 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outing_id" uuid,
	"description" varchar(200) NOT NULL,
	"amount" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_description_not_blank" CHECK (btrim("expenses"."description") <> ''),
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "friends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone_number" varchar(32),
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friends_name_not_blank" CHECK (btrim("friends"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "outings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(160) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outings_title_not_blank" CHECK (btrim("outings"."title") <> '')
);
--> statement-breakpoint
CREATE TABLE "repayment_allocations" (
	"repayment_id" uuid NOT NULL,
	"expense_share_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repayment_allocations_repayment_id_expense_share_id_pk" PRIMARY KEY("repayment_id","expense_share_id"),
	CONSTRAINT "repayment_allocations_amount_positive" CHECK ("repayment_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "repayments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"friend_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"payment_method" varchar(40),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repayments_amount_positive" CHECK ("repayments"."amount" > 0),
	CONSTRAINT "repayments_payment_method_not_blank" CHECK ("repayments"."payment_method" IS NULL OR btrim("repayments"."payment_method") <> '')
);
--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_friend_id_friends_id_fk" FOREIGN KEY ("friend_id") REFERENCES "public"."friends"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_outing_id_outings_id_fk" FOREIGN KEY ("outing_id") REFERENCES "public"."outings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_repayment_id_repayments_id_fk" FOREIGN KEY ("repayment_id") REFERENCES "public"."repayments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_expense_share_id_expense_shares_id_fk" FOREIGN KEY ("expense_share_id") REFERENCES "public"."expense_shares"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_friend_id_friends_id_fk" FOREIGN KEY ("friend_id") REFERENCES "public"."friends"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_shares_expense_friend_uidx" ON "expense_shares" USING btree ("expense_id","friend_id");--> statement-breakpoint
CREATE INDEX "expense_shares_friend_id_idx" ON "expense_shares" USING btree ("friend_id");--> statement-breakpoint
CREATE INDEX "expenses_outing_id_idx" ON "expenses" USING btree ("outing_id");--> statement-breakpoint
CREATE INDEX "expenses_occurred_at_idx" ON "expenses" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "friends_name_idx" ON "friends" USING btree ("name");--> statement-breakpoint
CREATE INDEX "friends_archived_at_idx" ON "friends" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "outings_occurred_at_idx" ON "outings" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "repayment_allocations_expense_share_id_idx" ON "repayment_allocations" USING btree ("expense_share_id");--> statement-breakpoint
CREATE INDEX "repayments_friend_id_idx" ON "repayments" USING btree ("friend_id");--> statement-breakpoint
CREATE INDEX "repayments_paid_at_idx" ON "repayments" USING btree ("paid_at");