CREATE TABLE "group_offset_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"offset_settlement_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"applied_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_offset_applications_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_offset_applications_offset_obligation_unique" UNIQUE("group_id","offset_settlement_id","obligation_id"),
	CONSTRAINT "group_offset_applications_amount_positive" CHECK ("group_offset_applications"."applied_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "group_offset_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"initiator_participant_id" uuid NOT NULL,
	"counterparty_participant_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "group_offset_settlements_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_offset_settlements_amount_positive" CHECK ("group_offset_settlements"."amount" > 0),
	CONSTRAINT "group_offset_settlements_state_allowed" CHECK ("group_offset_settlements"."state" IN ('pending', 'confirmed')),
	CONSTRAINT "group_offset_settlements_no_self_offset" CHECK ("group_offset_settlements"."initiator_participant_id" <> "group_offset_settlements"."counterparty_participant_id"),
	CONSTRAINT "group_offset_settlements_confirmation_timestamp_shape" CHECK (("group_offset_settlements"."state" = 'pending' AND "group_offset_settlements"."confirmed_at" IS NULL) OR ("group_offset_settlements"."state" = 'confirmed' AND "group_offset_settlements"."confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "group_offset_applications" ADD CONSTRAINT "group_offset_applications_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_offset_applications" ADD CONSTRAINT "group_offset_applications_offset_settlement_fk" FOREIGN KEY ("group_id","offset_settlement_id") REFERENCES "public"."group_offset_settlements"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_offset_applications" ADD CONSTRAINT "group_offset_applications_obligation_fk" FOREIGN KEY ("group_id","obligation_id") REFERENCES "public"."group_obligations"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_offset_settlements" ADD CONSTRAINT "group_offset_settlements_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_offset_settlements" ADD CONSTRAINT "group_offset_settlements_initiator_participant_fk" FOREIGN KEY ("group_id","initiator_participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_offset_settlements" ADD CONSTRAINT "group_offset_settlements_counterparty_participant_fk" FOREIGN KEY ("group_id","counterparty_participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_offset_applications_group_offset_idx" ON "group_offset_applications" USING btree ("group_id","offset_settlement_id","created_at","id");--> statement-breakpoint
CREATE INDEX "group_offset_applications_group_obligation_idx" ON "group_offset_applications" USING btree ("group_id","obligation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "group_offset_settlements_group_created_idx" ON "group_offset_settlements" USING btree ("group_id","created_at","id");--> statement-breakpoint
CREATE INDEX "group_offset_settlements_pending_counterparty_idx" ON "group_offset_settlements" USING btree ("group_id","counterparty_participant_id","created_at","id") WHERE "group_offset_settlements"."state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "group_offset_settlements_pending_pair_uidx" ON "group_offset_settlements" USING btree ("group_id",LEAST("initiator_participant_id", "counterparty_participant_id"),GREATEST("initiator_participant_id", "counterparty_participant_id")) WHERE "group_offset_settlements"."state" = 'pending';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "zplit_validate_group_settlement_application"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement_state text;
  settlement_amount integer;
  settlement_confirmed_at timestamptz;
  settlement_sender_id uuid;
  settlement_recipient_id uuid;
  obligation_created_at timestamptz;
  obligation_voided_at timestamptz;
  obligation_amount integer;
  obligation_debtor_id uuid;
  obligation_creditor_id uuid;
  settlement_total bigint;
  offset_total bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Group settlement applications are immutable historical facts';
  END IF;

  SELECT state, amount, confirmed_at, sender_participant_id, recipient_participant_id
    INTO settlement_state, settlement_amount, settlement_confirmed_at, settlement_sender_id, settlement_recipient_id
  FROM group_settlements
  WHERE group_id = NEW.group_id AND id = NEW.settlement_id
  FOR UPDATE;
  IF NOT FOUND OR settlement_state <> 'confirmed' OR settlement_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Only confirmed Group settlements may have applications';
  END IF;

  SELECT created_at, voided_at, original_amount, debtor_participant_id, creditor_participant_id
    INTO obligation_created_at, obligation_voided_at, obligation_amount, obligation_debtor_id, obligation_creditor_id
  FROM group_obligations
  WHERE group_id = NEW.group_id AND id = NEW.obligation_id
  FOR UPDATE;
  IF NOT FOUND
    OR obligation_debtor_id <> settlement_sender_id
    OR obligation_creditor_id <> settlement_recipient_id
    OR obligation_created_at > settlement_confirmed_at
    OR (obligation_voided_at IS NOT NULL AND obligation_voided_at <= settlement_confirmed_at)
  THEN
    RAISE EXCEPTION 'Group settlement application does not match a historically eligible obligation';
  END IF;

  SELECT COALESCE(sum(applied_amount), 0)
    INTO settlement_total
  FROM group_settlement_applications
  WHERE group_id = NEW.group_id AND settlement_id = NEW.settlement_id;
  IF settlement_total + NEW.applied_amount > settlement_amount THEN
    RAISE EXCEPTION 'Group settlement applications exceed the settlement amount';
  END IF;

  SELECT COALESCE(sum(applied_amount), 0)
    INTO settlement_total
  FROM group_settlement_applications
  WHERE group_id = NEW.group_id AND obligation_id = NEW.obligation_id;
  SELECT COALESCE(sum(applied_amount), 0)
    INTO offset_total
  FROM group_offset_applications
  WHERE group_id = NEW.group_id AND obligation_id = NEW.obligation_id;
  IF settlement_total + offset_total + NEW.applied_amount > obligation_amount THEN
    RAISE EXCEPTION 'Group payment and offset applications exceed the obligation amount';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "zplit_validate_group_settlement_application_totals"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement_amount integer;
  settlement_total bigint;
  obligation_amount integer;
  obligation_total bigint;
  offset_total bigint;
BEGIN
  IF TG_TABLE_NAME = 'group_settlements' THEN
    IF NEW.state = 'confirmed' THEN
      SELECT amount INTO settlement_amount
      FROM group_settlements
      WHERE group_id = NEW.group_id AND id = NEW.id;
      SELECT COALESCE(sum(applied_amount), 0) INTO settlement_total
      FROM group_settlement_applications
      WHERE group_id = NEW.group_id AND settlement_id = NEW.id;
      IF settlement_total <> settlement_amount THEN
        RAISE EXCEPTION 'Confirmed Group settlements must be fully allocated';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'group_settlement_applications' THEN
    SELECT original_amount INTO obligation_amount
    FROM group_obligations
    WHERE group_id = NEW.group_id AND id = NEW.obligation_id;
    SELECT COALESCE(sum(applied_amount), 0) INTO obligation_total
    FROM group_settlement_applications
    WHERE group_id = NEW.group_id AND obligation_id = NEW.obligation_id;
    SELECT COALESCE(sum(applied_amount), 0) INTO offset_total
    FROM group_offset_applications
    WHERE group_id = NEW.group_id AND obligation_id = NEW.obligation_id;
    IF obligation_total + offset_total > obligation_amount THEN
      RAISE EXCEPTION 'Group payment and offset applications exceed the obligation amount';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "zplit_validate_group_offset_settlement"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  initiator_user_id text;
  counterparty_user_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Group offsets are immutable financial history';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.state <> 'pending' THEN
    RAISE EXCEPTION 'Group offsets must be created pending';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD.group_id IS DISTINCT FROM NEW.group_id
    OR OLD.initiator_participant_id IS DISTINCT FROM NEW.initiator_participant_id
    OR OLD.counterparty_participant_id IS DISTINCT FROM NEW.counterparty_participant_id
    OR OLD.amount IS DISTINCT FROM NEW.amount
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.state <> 'pending'
    OR NEW.state <> 'confirmed'
    OR NEW.confirmed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Group offset financial facts are immutable and only pending offsets may be confirmed';
  END IF;

  SELECT user_id INTO initiator_user_id
  FROM group_participants
  WHERE group_id = NEW.group_id AND id = NEW.initiator_participant_id;
  SELECT user_id INTO counterparty_user_id
  FROM group_participants
  WHERE group_id = NEW.group_id AND id = NEW.counterparty_participant_id;
  IF initiator_user_id IS NULL OR counterparty_user_id IS NULL THEN
    RAISE EXCEPTION 'Group offset participants must be registered';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "group_offset_settlements_historical_facts"
BEFORE INSERT OR UPDATE OR DELETE ON "group_offset_settlements"
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_offset_settlement"();
--> statement-breakpoint
CREATE FUNCTION "zplit_validate_group_offset_application"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  offset_state text;
  offset_amount integer;
  offset_confirmed_at timestamptz;
  offset_initiator_id uuid;
  offset_counterparty_id uuid;
  obligation_created_at timestamptz;
  obligation_voided_at timestamptz;
  obligation_amount integer;
  obligation_debtor_id uuid;
  obligation_creditor_id uuid;
  offset_total bigint;
  settlement_total bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Group offset applications are immutable historical facts';
  END IF;

  SELECT state, amount, confirmed_at, initiator_participant_id, counterparty_participant_id
    INTO offset_state, offset_amount, offset_confirmed_at, offset_initiator_id, offset_counterparty_id
  FROM group_offset_settlements
  WHERE group_id = NEW.group_id AND id = NEW.offset_settlement_id
  FOR UPDATE;
  IF NOT FOUND OR offset_state <> 'confirmed' OR offset_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Only confirmed Group offsets may have applications';
  END IF;

  SELECT created_at, voided_at, original_amount, debtor_participant_id, creditor_participant_id
    INTO obligation_created_at, obligation_voided_at, obligation_amount, obligation_debtor_id, obligation_creditor_id
  FROM group_obligations
  WHERE group_id = NEW.group_id AND id = NEW.obligation_id
  FOR UPDATE;
  IF NOT FOUND
    OR NOT (
      (obligation_debtor_id = offset_initiator_id AND obligation_creditor_id = offset_counterparty_id)
      OR (obligation_debtor_id = offset_counterparty_id AND obligation_creditor_id = offset_initiator_id)
    )
    OR obligation_created_at > offset_confirmed_at
    OR (obligation_voided_at IS NOT NULL AND obligation_voided_at <= offset_confirmed_at)
  THEN
    RAISE EXCEPTION 'Group offset application does not match a historically eligible reciprocal obligation';
  END IF;

  SELECT COALESCE(sum(applied_amount), 0)
    INTO offset_total
  FROM group_offset_applications applications
  INNER JOIN group_obligations obligations
    ON obligations.group_id = applications.group_id
   AND obligations.id = applications.obligation_id
  WHERE applications.group_id = NEW.group_id
    AND applications.offset_settlement_id = NEW.offset_settlement_id
    AND obligations.debtor_participant_id = obligation_debtor_id
    AND obligations.creditor_participant_id = obligation_creditor_id;
  IF offset_total + NEW.applied_amount > offset_amount THEN
    RAISE EXCEPTION 'Group offset applications exceed the offset amount';
  END IF;

  SELECT COALESCE(sum(applied_amount), 0)
    INTO settlement_total
  FROM group_settlement_applications
  WHERE group_id = NEW.group_id AND obligation_id = NEW.obligation_id;
  SELECT COALESCE(sum(applied_amount), 0)
    INTO offset_total
  FROM group_offset_applications
  WHERE group_id = NEW.group_id AND obligation_id = NEW.obligation_id;
  IF settlement_total + offset_total + NEW.applied_amount > obligation_amount THEN
    RAISE EXCEPTION 'Group payment and offset applications exceed the obligation amount';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "group_offset_applications_integrity"
BEFORE INSERT OR UPDATE OR DELETE ON "group_offset_applications"
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_offset_application"();
--> statement-breakpoint
CREATE FUNCTION "zplit_validate_group_offset_application_totals"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  offset_amount integer;
  initiator_id uuid;
  counterparty_id uuid;
  initiator_total bigint;
  counterparty_total bigint;
  obligation_amount integer;
  settlement_total bigint;
  offset_total bigint;
BEGIN
  IF TG_TABLE_NAME = 'group_offset_settlements' THEN
    IF NEW.state = 'confirmed' THEN
      SELECT amount, initiator_participant_id, counterparty_participant_id
        INTO offset_amount, initiator_id, counterparty_id
      FROM group_offset_settlements
      WHERE group_id = NEW.group_id AND id = NEW.id;
      SELECT
        COALESCE(sum(CASE WHEN obligations.debtor_participant_id = initiator_id AND obligations.creditor_participant_id = counterparty_id THEN applications.applied_amount ELSE 0 END), 0),
        COALESCE(sum(CASE WHEN obligations.debtor_participant_id = counterparty_id AND obligations.creditor_participant_id = initiator_id THEN applications.applied_amount ELSE 0 END), 0)
        INTO initiator_total, counterparty_total
      FROM group_offset_applications applications
      INNER JOIN group_obligations obligations
        ON obligations.group_id = applications.group_id
       AND obligations.id = applications.obligation_id
      WHERE applications.group_id = NEW.group_id
        AND applications.offset_settlement_id = NEW.id;
      IF initiator_total <> offset_amount OR counterparty_total <> offset_amount THEN
        RAISE EXCEPTION 'Confirmed Group offsets must be fully allocated in both directions';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'group_offset_applications' THEN
    SELECT original_amount INTO obligation_amount
    FROM group_obligations
    WHERE group_id = NEW.group_id AND id = NEW.obligation_id;
    SELECT COALESCE(sum(applied_amount), 0) INTO settlement_total
    FROM group_settlement_applications
    WHERE group_id = NEW.group_id AND obligation_id = NEW.obligation_id;
    SELECT COALESCE(sum(applied_amount), 0) INTO offset_total
    FROM group_offset_applications
    WHERE group_id = NEW.group_id AND obligation_id = NEW.obligation_id;
    IF settlement_total + offset_total > obligation_amount THEN
      RAISE EXCEPTION 'Group payment and offset applications exceed the obligation amount';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "group_offset_settlements_applications_complete"
AFTER INSERT OR UPDATE ON "group_offset_settlements"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_offset_application_totals"();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "group_offset_applications_totals"
AFTER INSERT ON "group_offset_applications"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_offset_application_totals"();
