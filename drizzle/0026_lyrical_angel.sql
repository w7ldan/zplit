CREATE TABLE "group_expense_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"original_filename" varchar(160) NOT NULL,
	"media_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_expense_receipts_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_expense_receipts_expense_sha256_unique" UNIQUE("group_id","expense_id","sha256"),
	CONSTRAINT "group_expense_receipts_media_type_allowed" CHECK ("group_expense_receipts"."media_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "group_expense_receipts_byte_size_valid" CHECK ("group_expense_receipts"."byte_size" BETWEEN 1 AND 5242880),
	CONSTRAINT "group_expense_receipts_content_size_matches" CHECK (octet_length("group_expense_receipts"."content") = "group_expense_receipts"."byte_size"),
	CONSTRAINT "group_expense_receipts_filename_not_blank" CHECK (btrim("group_expense_receipts"."original_filename") <> ''),
	CONSTRAINT "group_expense_receipts_sha256_hex" CHECK ("group_expense_receipts"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "group_expense_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_expense_shares_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_expense_shares_group_expense_id_unique" UNIQUE("group_id","expense_id","id"),
	CONSTRAINT "group_expense_shares_expense_participant_unique" UNIQUE("expense_id","participant_id"),
	CONSTRAINT "group_expense_shares_amount_positive" CHECK ("group_expense_shares"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "group_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"creator_participant_id" uuid NOT NULL,
	"payer_participant_id" uuid NOT NULL,
	"description" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"total_amount" integer NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_expenses_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_expenses_description_not_blank" CHECK (btrim("group_expenses"."description") <> ''),
	CONSTRAINT "group_expenses_total_amount_positive" CHECK ("group_expenses"."total_amount" > 0),
	CONSTRAINT "group_expenses_state_allowed" CHECK ("group_expenses"."state" IN ('pending', 'confirmed')),
	CONSTRAINT "group_expenses_confirmation_timestamp_shape" CHECK (("group_expenses"."state" = 'pending' AND "group_expenses"."confirmed_at" IS NULL) OR ("group_expenses"."state" = 'confirmed' AND "group_expenses"."confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "group_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"source_expense_id" uuid NOT NULL,
	"source_share_id" uuid NOT NULL,
	"debtor_participant_id" uuid NOT NULL,
	"creditor_participant_id" uuid NOT NULL,
	"original_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_obligations_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_obligations_source_share_unique" UNIQUE("group_id","source_share_id"),
	CONSTRAINT "group_obligations_original_amount_positive" CHECK ("group_obligations"."original_amount" > 0),
	CONSTRAINT "group_obligations_no_self_debt" CHECK ("group_obligations"."debtor_participant_id" <> "group_obligations"."creditor_participant_id")
);
--> statement-breakpoint
ALTER TABLE "group_expense_receipts" ADD CONSTRAINT "group_expense_receipts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expense_receipts" ADD CONSTRAINT "group_expense_receipts_expense_fk" FOREIGN KEY ("group_id","expense_id") REFERENCES "public"."group_expenses"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expense_shares" ADD CONSTRAINT "group_expense_shares_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expense_shares" ADD CONSTRAINT "group_expense_shares_expense_fk" FOREIGN KEY ("group_id","expense_id") REFERENCES "public"."group_expenses"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expense_shares" ADD CONSTRAINT "group_expense_shares_participant_fk" FOREIGN KEY ("group_id","participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_creator_participant_fk" FOREIGN KEY ("group_id","creator_participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_payer_participant_fk" FOREIGN KEY ("group_id","payer_participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_obligations" ADD CONSTRAINT "group_obligations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_obligations" ADD CONSTRAINT "group_obligations_expense_fk" FOREIGN KEY ("group_id","source_expense_id") REFERENCES "public"."group_expenses"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_obligations" ADD CONSTRAINT "group_obligations_source_share_fk" FOREIGN KEY ("group_id","source_expense_id","source_share_id") REFERENCES "public"."group_expense_shares"("group_id","expense_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_obligations" ADD CONSTRAINT "group_obligations_debtor_participant_fk" FOREIGN KEY ("group_id","debtor_participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_obligations" ADD CONSTRAINT "group_obligations_creditor_participant_fk" FOREIGN KEY ("group_id","creditor_participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_expense_receipts_expense_created_id_idx" ON "group_expense_receipts" USING btree ("group_id","expense_id","created_at","id");--> statement-breakpoint
CREATE INDEX "group_expense_shares_group_expense_idx" ON "group_expense_shares" USING btree ("group_id","expense_id","id");--> statement-breakpoint
CREATE INDEX "group_expense_shares_group_participant_idx" ON "group_expense_shares" USING btree ("group_id","participant_id");--> statement-breakpoint
CREATE INDEX "group_expenses_group_occurred_at_idx" ON "group_expenses" USING btree ("group_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "group_expenses_group_state_idx" ON "group_expenses" USING btree ("group_id","state");--> statement-breakpoint
CREATE INDEX "group_obligations_group_expense_idx" ON "group_obligations" USING btree ("group_id","source_expense_id","id");--> statement-breakpoint
CREATE INDEX "group_obligations_group_debtor_idx" ON "group_obligations" USING btree ("group_id","debtor_participant_id");--> statement-breakpoint
CREATE INDEX "group_obligations_group_creditor_idx" ON "group_obligations" USING btree ("group_id","creditor_participant_id");--> statement-breakpoint
CREATE FUNCTION "zplit_validate_group_expense_confirmation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  share_total bigint;
  payer_user_id text;
BEGIN
  IF NEW.state = 'confirmed' THEN
    SELECT participants.user_id INTO payer_user_id
    FROM group_participants AS participants
    INNER JOIN group_memberships AS memberships
      ON memberships.group_id = participants.group_id
     AND memberships.participant_id = participants.id
     AND memberships.user_id = participants.user_id
    WHERE participants.group_id = NEW.group_id
      AND participants.id = NEW.payer_participant_id;
    IF payer_user_id IS NULL THEN
      RAISE EXCEPTION 'Group expense payer must be an active registered participant';
    END IF;

    SELECT COALESCE(sum(shares.amount), 0) INTO share_total
    FROM group_expense_shares AS shares
    WHERE shares.group_id = NEW.group_id
      AND shares.expense_id = NEW.id;
    IF share_total <> NEW.total_amount THEN
      RAISE EXCEPTION 'Group expense shares must equal the total amount';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "group_expenses_confirmation_integrity"
BEFORE INSERT OR UPDATE OF state ON "group_expenses"
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_expense_confirmation"();--> statement-breakpoint
CREATE FUNCTION "zplit_validate_group_obligation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expense_state text;
  payer_id uuid;
  share_participant_id uuid;
  share_amount integer;
  creditor_user_id text;
BEGIN
  SELECT expenses.state, expenses.payer_participant_id, shares.participant_id, shares.amount
    INTO expense_state, payer_id, share_participant_id, share_amount
  FROM group_expenses AS expenses
  INNER JOIN group_expense_shares AS shares
    ON shares.group_id = expenses.group_id
   AND shares.expense_id = expenses.id
   AND shares.id = NEW.source_share_id
  WHERE expenses.group_id = NEW.group_id
    AND expenses.id = NEW.source_expense_id;
  IF NOT FOUND OR expense_state <> 'confirmed' OR payer_id <> NEW.creditor_participant_id OR share_participant_id <> NEW.debtor_participant_id OR share_amount <> NEW.original_amount THEN
    RAISE EXCEPTION 'Group obligation does not match a confirmed expense share';
  END IF;

  SELECT participants.user_id INTO creditor_user_id
  FROM group_participants AS participants
  WHERE participants.group_id = NEW.group_id
    AND participants.id = NEW.creditor_participant_id;
  IF NOT FOUND OR creditor_user_id IS NULL THEN
    RAISE EXCEPTION 'Group obligation creditor must be registered';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "group_obligations_integrity"
BEFORE INSERT ON "group_obligations"
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_obligation"();
