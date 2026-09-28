ALTER TABLE "group_expense_receipts" DROP CONSTRAINT "group_expense_receipts_expense_sha256_unique";--> statement-breakpoint
DROP INDEX "expense_receipts_owner_expense_sha256_uidx";