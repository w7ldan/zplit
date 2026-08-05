ALTER TABLE "expenses" DROP CONSTRAINT "expenses_owner_outing_fk";
--> statement-breakpoint
ALTER TABLE "repayment_allocations" DROP CONSTRAINT "repayment_allocations_owner_expense_share_fk";
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_owner_outing_fk" FOREIGN KEY ("owner_user_id","outing_id") REFERENCES "public"."outings"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_owner_expense_share_fk" FOREIGN KEY ("owner_user_id","expense_share_id") REFERENCES "public"."expense_shares"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;