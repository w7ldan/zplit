CREATE TABLE "ledger_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(16) NOT NULL,
	"user_id" text,
	"organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_scopes_kind_allowed" CHECK ("ledger_scopes"."kind" IN ('personal', 'organization')),
	CONSTRAINT "ledger_scopes_subject_xor" CHECK (("ledger_scopes"."kind" = 'personal' AND "ledger_scopes"."user_id" IS NOT NULL AND "ledger_scopes"."organization_id" IS NULL) OR ("ledger_scopes"."kind" = 'organization' AND "ledger_scopes"."user_id" IS NULL AND "ledger_scopes"."organization_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "debtor_share_links" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "debtor_share_receipts" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_charge_targets" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_charges" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "friends" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "outings" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "repayment_destinations" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "repayment_proofs" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "repayments" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "ledger_scope_id" uuid;--> statement-breakpoint
ALTER TABLE "debtor_share_links" DROP CONSTRAINT "debtor_share_links_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "debtor_share_links" DROP CONSTRAINT "debtor_share_links_owner_friend_fk";
--> statement-breakpoint
ALTER TABLE "debtor_share_receipts" DROP CONSTRAINT "debtor_share_receipts_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "debtor_share_receipts" DROP CONSTRAINT "debtor_share_receipts_owner_link_fk";
--> statement-breakpoint
ALTER TABLE "debtor_share_receipts" DROP CONSTRAINT "debtor_share_receipts_owner_expense_receipt_fk";
--> statement-breakpoint
ALTER TABLE "expense_charge_targets" DROP CONSTRAINT "expense_charge_targets_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expense_charge_targets" DROP CONSTRAINT "expense_charge_targets_owner_charge_fk";
--> statement-breakpoint
ALTER TABLE "expense_charge_targets" DROP CONSTRAINT "expense_charge_targets_owner_share_fk";
--> statement-breakpoint
ALTER TABLE "expense_charges" DROP CONSTRAINT "expense_charges_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expense_charges" DROP CONSTRAINT "expense_charges_owner_expense_fk";
--> statement-breakpoint
ALTER TABLE "expense_receipts" DROP CONSTRAINT "expense_receipts_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expense_receipts" DROP CONSTRAINT "expense_receipts_owner_expense_fk";
--> statement-breakpoint
ALTER TABLE "expense_shares" DROP CONSTRAINT "expense_shares_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expense_shares" DROP CONSTRAINT "expense_shares_owner_expense_fk";
--> statement-breakpoint
ALTER TABLE "expense_shares" DROP CONSTRAINT "expense_shares_owner_friend_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_owner_outing_fk";
--> statement-breakpoint
ALTER TABLE "friend_link_requests" DROP CONSTRAINT "friend_link_requests_owner_friend_fk";
--> statement-breakpoint
ALTER TABLE "friends" DROP CONSTRAINT "friends_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "outings" DROP CONSTRAINT "outings_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "outings" DROP CONSTRAINT "outings_owner_trip_fk";
--> statement-breakpoint
ALTER TABLE "repayment_allocations" DROP CONSTRAINT "repayment_allocations_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "repayment_allocations" DROP CONSTRAINT "repayment_allocations_owner_repayment_fk";
--> statement-breakpoint
ALTER TABLE "repayment_allocations" DROP CONSTRAINT "repayment_allocations_owner_expense_share_fk";
--> statement-breakpoint
ALTER TABLE "repayment_destinations" DROP CONSTRAINT "repayment_destinations_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "repayment_proofs" DROP CONSTRAINT "repayment_proofs_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "repayment_proofs" DROP CONSTRAINT "repayment_proofs_owner_repayment_fk";
--> statement-breakpoint
ALTER TABLE "repayments" DROP CONSTRAINT "repayments_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "repayments" DROP CONSTRAINT "repayments_owner_friend_fk";
--> statement-breakpoint
ALTER TABLE "trips" DROP CONSTRAINT "trips_owner_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "debtor_share_links_owner_user_id_id_uidx";--> statement-breakpoint
DROP INDEX "expense_charges_owner_user_id_id_uidx";--> statement-breakpoint
DROP INDEX "expense_shares_owner_user_id_id_uidx";--> statement-breakpoint
DROP INDEX "expenses_owner_user_id_id_uidx";--> statement-breakpoint
DROP INDEX "friends_owner_user_id_id_uidx";--> statement-breakpoint
DROP INDEX "friends_owner_linked_user_uidx";--> statement-breakpoint
DROP INDEX "outings_owner_user_id_id_uidx";--> statement-breakpoint
DROP INDEX "outings_owner_user_id_trip_id_idx";--> statement-breakpoint
DROP INDEX "repayments_owner_user_id_id_uidx";--> statement-breakpoint
DROP INDEX "trips_owner_user_id_id_uidx";--> statement-breakpoint
DROP INDEX "trips_owner_user_id_name_idx";--> statement-breakpoint
DROP INDEX "trips_owner_user_id_dates_idx";--> statement-breakpoint
DROP INDEX "debtor_share_links_active_owner_friend_uidx";--> statement-breakpoint
DROP INDEX "debtor_share_links_owner_friend_idx";--> statement-breakpoint
DROP INDEX "debtor_share_receipts_link_receipt_uidx";--> statement-breakpoint
DROP INDEX "debtor_share_receipts_link_idx";--> statement-breakpoint
DROP INDEX "expense_charge_targets_owner_charge_idx";--> statement-breakpoint
DROP INDEX "expense_charge_targets_owner_share_idx";--> statement-breakpoint
DROP INDEX "expense_charges_owner_expense_id_id_uidx";--> statement-breakpoint
DROP INDEX "expense_charges_owner_expense_id_idx";--> statement-breakpoint
DROP INDEX "expense_receipts_owner_expense_id_uidx";--> statement-breakpoint
DROP INDEX "expense_receipts_owner_expense_sha256_uidx";--> statement-breakpoint
DROP INDEX "expense_receipts_owner_expense_created_id_idx";--> statement-breakpoint
DROP INDEX "expense_shares_owner_expense_id_id_uidx";--> statement-breakpoint
DROP INDEX "expense_shares_friend_id_idx";--> statement-breakpoint
DROP INDEX "expenses_outing_id_idx";--> statement-breakpoint
DROP INDEX "friends_name_idx";--> statement-breakpoint
DROP INDEX "friends_linked_user_idx";--> statement-breakpoint
DROP INDEX "friends_archived_at_idx";--> statement-breakpoint
DROP INDEX "outings_occurred_at_idx";--> statement-breakpoint
DROP INDEX "repayment_allocations_expense_share_id_idx";--> statement-breakpoint
DROP INDEX "repayment_destinations_owner_order_idx";--> statement-breakpoint
DROP INDEX "repayment_proofs_owner_repayment_uidx";--> statement-breakpoint
DROP INDEX "repayments_friend_id_idx";--> statement-breakpoint
DROP INDEX "repayments_paid_at_idx";--> statement-breakpoint
ALTER TABLE "expense_charge_targets" DROP CONSTRAINT "expense_charge_targets_owner_user_id_expense_charge_id_expense_share_id_pk";--> statement-breakpoint
ALTER TABLE "repayment_allocations" DROP CONSTRAINT "repayment_allocations_repayment_id_expense_share_id_pk";--> statement-breakpoint
ALTER TABLE "friend_link_requests" ADD COLUMN "friend_ledger_scope_id" uuid;--> statement-breakpoint
INSERT INTO "ledger_scopes" ("kind", "user_id")
SELECT 'personal', "id" FROM "users";
--> statement-breakpoint
INSERT INTO "ledger_scopes" ("kind", "organization_id")
SELECT 'organization', "id" FROM "organizations";
--> statement-breakpoint
UPDATE "friends" f SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = f."owner_user_id";
--> statement-breakpoint
UPDATE "trips" t SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = t."owner_user_id";
--> statement-breakpoint
UPDATE "outings" o SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = o."owner_user_id";
--> statement-breakpoint
UPDATE "expenses" e SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = e."owner_user_id";
--> statement-breakpoint
UPDATE "expense_receipts" r SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = r."owner_user_id";
--> statement-breakpoint
UPDATE "expense_shares" es SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = es."owner_user_id";
--> statement-breakpoint
UPDATE "expense_charges" ec SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = ec."owner_user_id";
--> statement-breakpoint
UPDATE "expense_charge_targets" ect SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = ect."owner_user_id";
--> statement-breakpoint
UPDATE "repayments" r SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = r."owner_user_id";
--> statement-breakpoint
UPDATE "repayment_destinations" rd SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = rd."owner_user_id";
--> statement-breakpoint
UPDATE "repayment_proofs" rp SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = rp."owner_user_id";
--> statement-breakpoint
UPDATE "repayment_allocations" ra SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = ra."owner_user_id";
--> statement-breakpoint
UPDATE "debtor_share_links" dsl SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = dsl."owner_user_id";
--> statement-breakpoint
UPDATE "debtor_share_receipts" dsr SET "ledger_scope_id" = s."id"
FROM "ledger_scopes" s WHERE s."kind" = 'personal' AND s."user_id" = dsr."owner_user_id";
--> statement-breakpoint
UPDATE "friend_link_requests" r SET "friend_ledger_scope_id" = f."ledger_scope_id"
FROM "friends" f WHERE f."owner_user_id" = r."owner_user_id" AND f."id" = r."friend_id";
--> statement-breakpoint
DO $$
DECLARE table_name text; missing_count bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['friends','trips','outings','expenses','expense_receipts','expense_shares','expense_charges','expense_charge_targets','repayments','repayment_destinations','repayment_proofs','repayment_allocations','debtor_share_links','debtor_share_receipts'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE ledger_scope_id IS NULL', table_name) INTO missing_count;
    IF missing_count > 0 THEN RAISE EXCEPTION '0022 backfill left % ledger rows without a ledger scope', missing_count USING ERRCODE = '23514'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM friend_link_requests WHERE friend_ledger_scope_id IS NULL) THEN
    RAISE EXCEPTION '0022 backfill left friend-link rows without a Personal ledger scope' USING ERRCODE = '23514';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "friends" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "trips" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "outings" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "expenses" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "expense_receipts" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "expense_shares" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "expense_charges" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "expense_charge_targets" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "repayments" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "repayment_destinations" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "repayment_proofs" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "repayment_allocations" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "debtor_share_links" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "debtor_share_receipts" ALTER COLUMN "ledger_scope_id" SET NOT NULL;
ALTER TABLE "friend_link_requests" ALTER COLUMN "friend_ledger_scope_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "expense_charge_targets" ADD CONSTRAINT "expense_charge_targets_ledger_scope_id_expense_charge_id_expense_share_id_pk" PRIMARY KEY("ledger_scope_id","expense_charge_id","expense_share_id");
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_ledger_scope_id_repayment_id_expense_share_id_pk" PRIMARY KEY("ledger_scope_id","repayment_id","expense_share_id");
--> statement-breakpoint
ALTER TABLE "friends" DROP COLUMN "owner_user_id";
ALTER TABLE "trips" DROP COLUMN "owner_user_id";
ALTER TABLE "outings" DROP COLUMN "owner_user_id";
ALTER TABLE "expenses" DROP COLUMN "owner_user_id";
ALTER TABLE "expense_receipts" DROP COLUMN "owner_user_id";
ALTER TABLE "expense_shares" DROP COLUMN "owner_user_id";
ALTER TABLE "expense_charges" DROP COLUMN "owner_user_id";
ALTER TABLE "expense_charge_targets" DROP COLUMN "owner_user_id";
ALTER TABLE "repayments" DROP COLUMN "owner_user_id";
ALTER TABLE "repayment_destinations" DROP COLUMN "owner_user_id";
ALTER TABLE "repayment_proofs" DROP COLUMN "owner_user_id";
ALTER TABLE "repayment_allocations" DROP COLUMN "owner_user_id";
ALTER TABLE "debtor_share_links" DROP COLUMN "owner_user_id";
ALTER TABLE "debtor_share_receipts" DROP COLUMN "owner_user_id";
--> statement-breakpoint
ALTER TABLE "ledger_scopes" ADD CONSTRAINT "ledger_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_scopes" ADD CONSTRAINT "ledger_scopes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_scopes_id_user_uidx" ON "ledger_scopes" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_scopes_personal_user_uidx" ON "ledger_scopes" USING btree ("user_id") WHERE "ledger_scopes"."kind" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_scopes_organization_uidx" ON "ledger_scopes" USING btree ("organization_id") WHERE "ledger_scopes"."kind" = 'organization';--> statement-breakpoint
CREATE UNIQUE INDEX "debtor_share_links_ledger_scope_id_id_uidx" ON "debtor_share_links" USING btree ("ledger_scope_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_charges_ledger_scope_id_id_uidx" ON "expense_charges" USING btree ("ledger_scope_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_charges_owner_expense_id_id_uidx" ON "expense_charges" USING btree ("ledger_scope_id","expense_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_receipts_owner_expense_id_uidx" ON "expense_receipts" USING btree ("ledger_scope_id","expense_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_shares_ledger_scope_id_id_uidx" ON "expense_shares" USING btree ("ledger_scope_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_shares_owner_expense_id_id_uidx" ON "expense_shares" USING btree ("ledger_scope_id","expense_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_ledger_scope_id_id_uidx" ON "expenses" USING btree ("ledger_scope_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "friends_ledger_scope_id_id_uidx" ON "friends" USING btree ("ledger_scope_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "outings_ledger_scope_id_id_uidx" ON "outings" USING btree ("ledger_scope_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "repayments_ledger_scope_id_id_uidx" ON "repayments" USING btree ("ledger_scope_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "trips_ledger_scope_id_id_uidx" ON "trips" USING btree ("ledger_scope_id","id");--> statement-breakpoint
ALTER TABLE "debtor_share_links" ADD CONSTRAINT "debtor_share_links_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debtor_share_links" ADD CONSTRAINT "debtor_share_links_owner_friend_fk" FOREIGN KEY ("ledger_scope_id","friend_id") REFERENCES "public"."friends"("ledger_scope_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debtor_share_receipts" ADD CONSTRAINT "debtor_share_receipts_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debtor_share_receipts" ADD CONSTRAINT "debtor_share_receipts_owner_link_fk" FOREIGN KEY ("ledger_scope_id","debtor_share_link_id") REFERENCES "public"."debtor_share_links"("ledger_scope_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debtor_share_receipts" ADD CONSTRAINT "debtor_share_receipts_owner_expense_receipt_fk" FOREIGN KEY ("ledger_scope_id","expense_id","expense_receipt_id") REFERENCES "public"."expense_receipts"("ledger_scope_id","expense_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_charge_targets" ADD CONSTRAINT "expense_charge_targets_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_charge_targets" ADD CONSTRAINT "expense_charge_targets_owner_charge_fk" FOREIGN KEY ("ledger_scope_id","expense_id","expense_charge_id") REFERENCES "public"."expense_charges"("ledger_scope_id","expense_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_charge_targets" ADD CONSTRAINT "expense_charge_targets_owner_share_fk" FOREIGN KEY ("ledger_scope_id","expense_id","expense_share_id") REFERENCES "public"."expense_shares"("ledger_scope_id","expense_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_charges" ADD CONSTRAINT "expense_charges_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_charges" ADD CONSTRAINT "expense_charges_owner_expense_fk" FOREIGN KEY ("ledger_scope_id","expense_id") REFERENCES "public"."expenses"("ledger_scope_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_owner_expense_fk" FOREIGN KEY ("ledger_scope_id","expense_id") REFERENCES "public"."expenses"("ledger_scope_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_owner_expense_fk" FOREIGN KEY ("ledger_scope_id","expense_id") REFERENCES "public"."expenses"("ledger_scope_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_owner_friend_fk" FOREIGN KEY ("ledger_scope_id","friend_id") REFERENCES "public"."friends"("ledger_scope_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_owner_outing_fk" FOREIGN KEY ("ledger_scope_id","outing_id") REFERENCES "public"."outings"("ledger_scope_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_link_requests" ADD CONSTRAINT "friend_link_requests_personal_scope_fk" FOREIGN KEY ("friend_ledger_scope_id","owner_user_id") REFERENCES "public"."ledger_scopes"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_link_requests" ADD CONSTRAINT "friend_link_requests_owner_friend_fk" FOREIGN KEY ("friend_ledger_scope_id","friend_id") REFERENCES "public"."friends"("ledger_scope_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friends" ADD CONSTRAINT "friends_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outings" ADD CONSTRAINT "outings_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outings" ADD CONSTRAINT "outings_owner_trip_fk" FOREIGN KEY ("ledger_scope_id","trip_id") REFERENCES "public"."trips"("ledger_scope_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_owner_repayment_fk" FOREIGN KEY ("ledger_scope_id","repayment_id") REFERENCES "public"."repayments"("ledger_scope_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_owner_expense_share_fk" FOREIGN KEY ("ledger_scope_id","expense_share_id") REFERENCES "public"."expense_shares"("ledger_scope_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_destinations" ADD CONSTRAINT "repayment_destinations_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_proofs" ADD CONSTRAINT "repayment_proofs_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_proofs" ADD CONSTRAINT "repayment_proofs_owner_repayment_fk" FOREIGN KEY ("ledger_scope_id","repayment_id") REFERENCES "public"."repayments"("ledger_scope_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayments" ADD CONSTRAINT "repayments_owner_friend_fk" FOREIGN KEY ("ledger_scope_id","friend_id") REFERENCES "public"."friends"("ledger_scope_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_ledger_scope_id_ledger_scopes_id_fk" FOREIGN KEY ("ledger_scope_id") REFERENCES "public"."ledger_scopes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friends_ledger_scope_linked_user_uidx" ON "friends" USING btree ("ledger_scope_id","linked_user_id") WHERE "friends"."linked_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "outings_ledger_scope_id_trip_id_idx" ON "outings" USING btree ("ledger_scope_id","trip_id");--> statement-breakpoint
CREATE INDEX "trips_ledger_scope_id_name_idx" ON "trips" USING btree ("ledger_scope_id","name");--> statement-breakpoint
CREATE INDEX "trips_ledger_scope_id_dates_idx" ON "trips" USING btree ("ledger_scope_id","starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "debtor_share_links_active_owner_friend_uidx" ON "debtor_share_links" USING btree ("ledger_scope_id","friend_id") WHERE "debtor_share_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "debtor_share_links_owner_friend_idx" ON "debtor_share_links" USING btree ("ledger_scope_id","friend_id");--> statement-breakpoint
CREATE UNIQUE INDEX "debtor_share_receipts_link_receipt_uidx" ON "debtor_share_receipts" USING btree ("ledger_scope_id","debtor_share_link_id","expense_receipt_id");--> statement-breakpoint
CREATE INDEX "debtor_share_receipts_link_idx" ON "debtor_share_receipts" USING btree ("ledger_scope_id","debtor_share_link_id");--> statement-breakpoint
CREATE INDEX "expense_charge_targets_owner_charge_idx" ON "expense_charge_targets" USING btree ("ledger_scope_id","expense_charge_id");--> statement-breakpoint
CREATE INDEX "expense_charge_targets_owner_share_idx" ON "expense_charge_targets" USING btree ("ledger_scope_id","expense_share_id");--> statement-breakpoint
CREATE INDEX "expense_charges_owner_expense_id_idx" ON "expense_charges" USING btree ("ledger_scope_id","expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_receipts_owner_expense_sha256_uidx" ON "expense_receipts" USING btree ("ledger_scope_id","expense_id","sha256");--> statement-breakpoint
CREATE INDEX "expense_receipts_owner_expense_created_id_idx" ON "expense_receipts" USING btree ("ledger_scope_id","expense_id","created_at","id");--> statement-breakpoint
CREATE INDEX "expense_shares_friend_id_idx" ON "expense_shares" USING btree ("ledger_scope_id","friend_id");--> statement-breakpoint
CREATE INDEX "expenses_outing_id_idx" ON "expenses" USING btree ("ledger_scope_id","outing_id");--> statement-breakpoint
CREATE INDEX "friends_name_idx" ON "friends" USING btree ("ledger_scope_id","name");--> statement-breakpoint
CREATE INDEX "friends_linked_user_idx" ON "friends" USING btree ("ledger_scope_id","linked_user_id");--> statement-breakpoint
CREATE INDEX "friends_archived_at_idx" ON "friends" USING btree ("ledger_scope_id","archived_at");--> statement-breakpoint
CREATE INDEX "outings_occurred_at_idx" ON "outings" USING btree ("ledger_scope_id","occurred_at");--> statement-breakpoint
CREATE INDEX "repayment_allocations_expense_share_id_idx" ON "repayment_allocations" USING btree ("ledger_scope_id","expense_share_id");--> statement-breakpoint
CREATE INDEX "repayment_destinations_owner_order_idx" ON "repayment_destinations" USING btree ("ledger_scope_id","sort_order","id");--> statement-breakpoint
CREATE UNIQUE INDEX "repayment_proofs_owner_repayment_uidx" ON "repayment_proofs" USING btree ("ledger_scope_id","repayment_id");--> statement-breakpoint
CREATE INDEX "repayments_friend_id_idx" ON "repayments" USING btree ("ledger_scope_id","friend_id");--> statement-breakpoint
CREATE INDEX "repayments_paid_at_idx" ON "repayments" USING btree ("ledger_scope_id","paid_at");
