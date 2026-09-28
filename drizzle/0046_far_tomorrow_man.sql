ALTER TABLE "expense_receipts" ADD COLUMN "normalization_version" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_expense_receipts" ADD COLUMN "normalization_version" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "group_settlement_proofs" ADD COLUMN "normalization_version" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repayment_proofs" ADD COLUMN "normalization_version" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "expense_receipts_normalization_pending_idx" ON "expense_receipts" USING btree ("id") WHERE "expense_receipts"."normalization_version" = 0;--> statement-breakpoint
CREATE INDEX "group_expense_receipts_normalization_pending_idx" ON "group_expense_receipts" USING btree ("id") WHERE "group_expense_receipts"."normalization_version" = 0;--> statement-breakpoint
CREATE INDEX "group_settlement_proofs_normalization_pending_idx" ON "group_settlement_proofs" USING btree ("id") WHERE "group_settlement_proofs"."normalization_version" = 0;--> statement-breakpoint
CREATE INDEX "repayment_proofs_normalization_pending_idx" ON "repayment_proofs" USING btree ("id") WHERE "repayment_proofs"."normalization_version" = 0;--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_normalization_version_valid" CHECK ("expense_receipts"."normalization_version" IN (0, 1));--> statement-breakpoint
ALTER TABLE "group_expense_receipts" ADD CONSTRAINT "group_expense_receipts_normalization_version_valid" CHECK ("group_expense_receipts"."normalization_version" IN (0, 1));--> statement-breakpoint
ALTER TABLE "group_settlement_proofs" ADD CONSTRAINT "group_settlement_proofs_normalization_version_valid" CHECK ("group_settlement_proofs"."normalization_version" IN (0, 1));--> statement-breakpoint
ALTER TABLE "repayment_proofs" ADD CONSTRAINT "repayment_proofs_normalization_version_valid" CHECK ("repayment_proofs"."normalization_version" IN (0, 1));