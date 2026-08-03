ALTER TABLE "expense_shares" DROP CONSTRAINT "expense_shares_expense_id_expenses_id_fk";
--> statement-breakpoint
ALTER TABLE "expense_shares" DROP CONSTRAINT "expense_shares_friend_id_friends_id_fk";
--> statement-breakpoint
ALTER TABLE "repayment_allocations" DROP CONSTRAINT "repayment_allocations_repayment_id_repayments_id_fk";
--> statement-breakpoint
ALTER TABLE "repayment_allocations" DROP CONSTRAINT "repayment_allocations_expense_share_id_expense_shares_id_fk";
--> statement-breakpoint
ALTER TABLE "repayments" DROP CONSTRAINT "repayments_friend_id_friends_id_fk";
--> statement-breakpoint
DROP INDEX "expense_shares_friend_id_idx";--> statement-breakpoint
DROP INDEX "expenses_outing_id_idx";--> statement-breakpoint
DROP INDEX "expenses_occurred_at_idx";--> statement-breakpoint
DROP INDEX "friends_name_idx";--> statement-breakpoint
DROP INDEX "friends_archived_at_idx";--> statement-breakpoint
DROP INDEX "outings_occurred_at_idx";--> statement-breakpoint
DROP INDEX "repayment_allocations_expense_share_id_idx";--> statement-breakpoint
DROP INDEX "repayments_friend_id_idx";--> statement-breakpoint
DROP INDEX "repayments_paid_at_idx";--> statement-breakpoint
ALTER TABLE "expense_shares" ADD COLUMN "owner_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "owner_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "friends" ADD COLUMN "owner_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "outings" ADD COLUMN "owner_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD COLUMN "owner_user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "repayments" ADD COLUMN "owner_user_id" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_shares_owner_user_id_id_uidx" ON "expense_shares" USING btree ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_owner_user_id_id_uidx" ON "expenses" USING btree ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "friends_owner_user_id_id_uidx" ON "friends" USING btree ("owner_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "repayments_owner_user_id_id_uidx" ON "repayments" USING btree ("owner_user_id","id");--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_owner_expense_fk" FOREIGN KEY ("owner_user_id","expense_id") REFERENCES "public"."expenses"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_owner_friend_fk" FOREIGN KEY ("owner_user_id","friend_id") REFERENCES "public"."friends"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outings" ADD CONSTRAINT "outings_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_owner_repayment_fk" FOREIGN KEY ("owner_user_id","repayment_id") REFERENCES "public"."repayments"("owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_owner_expense_share_fk" FOREIGN KEY ("owner_user_id","expense_share_id") REFERENCES "public"."expense_shares"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_owner_friend_fk" FOREIGN KEY ("owner_user_id","friend_id") REFERENCES "public"."friends"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_shares_friend_id_idx" ON "expense_shares" USING btree ("owner_user_id","friend_id");--> statement-breakpoint
CREATE INDEX "expenses_outing_id_idx" ON "expenses" USING btree ("owner_user_id","outing_id");--> statement-breakpoint
CREATE INDEX "expenses_occurred_at_idx" ON "expenses" USING btree ("owner_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "friends_name_idx" ON "friends" USING btree ("owner_user_id","name");--> statement-breakpoint
CREATE INDEX "friends_archived_at_idx" ON "friends" USING btree ("owner_user_id","archived_at");--> statement-breakpoint
CREATE INDEX "outings_occurred_at_idx" ON "outings" USING btree ("owner_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "repayment_allocations_expense_share_id_idx" ON "repayment_allocations" USING btree ("owner_user_id","expense_share_id");--> statement-breakpoint
CREATE INDEX "repayments_friend_id_idx" ON "repayments" USING btree ("owner_user_id","friend_id");--> statement-breakpoint
CREATE INDEX "repayments_paid_at_idx" ON "repayments" USING btree ("owner_user_id","paid_at");
