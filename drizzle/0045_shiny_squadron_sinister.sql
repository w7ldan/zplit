CREATE TABLE "budget_personal_repayment_exclusions" (
	"owner_user_id" text NOT NULL,
	"repayment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_personal_repayment_exclusions_pkey" PRIMARY KEY("owner_user_id","repayment_id")
);
--> statement-breakpoint
ALTER TABLE "budget_profiles" ADD COLUMN "include_new_repayments_by_default" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_personal_repayment_exclusions" ADD CONSTRAINT "budget_personal_repayment_exclusions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_personal_repayment_exclusions" ADD CONSTRAINT "budget_personal_repayment_exclusions_repayment_id_repayments_id_fk" FOREIGN KEY ("repayment_id") REFERENCES "public"."repayments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_personal_repayment_exclusions_repayment_idx" ON "budget_personal_repayment_exclusions" USING btree ("repayment_id");