CREATE TABLE "group_settlement_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"applied_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_settlement_applications_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_settlement_applications_settlement_obligation_unique" UNIQUE("group_id","settlement_id","obligation_id"),
	CONSTRAINT "group_settlement_applications_amount_positive" CHECK ("group_settlement_applications"."applied_amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "group_settlement_applications" ADD CONSTRAINT "group_settlement_applications_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlement_applications" ADD CONSTRAINT "group_settlement_applications_settlement_fk" FOREIGN KEY ("group_id","settlement_id") REFERENCES "public"."group_settlements"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlement_applications" ADD CONSTRAINT "group_settlement_applications_obligation_fk" FOREIGN KEY ("group_id","obligation_id") REFERENCES "public"."group_obligations"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_settlement_applications_group_settlement_idx" ON "group_settlement_applications" USING btree ("group_id","settlement_id","created_at","id");--> statement-breakpoint
CREATE INDEX "group_settlement_applications_group_obligation_idx" ON "group_settlement_applications" USING btree ("group_id","obligation_id","created_at","id");--> statement-breakpoint
CREATE FUNCTION "zplit_validate_group_settlement_application"() RETURNS trigger
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
  obligation_total bigint;
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
    INTO obligation_total
  FROM group_settlement_applications
  WHERE group_id = NEW.group_id AND obligation_id = NEW.obligation_id;
  IF obligation_total + NEW.applied_amount > obligation_amount THEN
    RAISE EXCEPTION 'Group settlement applications exceed the obligation amount';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "group_settlement_applications_integrity"
BEFORE INSERT OR UPDATE OR DELETE ON "group_settlement_applications"
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_settlement_application"();--> statement-breakpoint
CREATE FUNCTION "zplit_validate_group_settlement_application_totals"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement_amount integer;
  settlement_total bigint;
  obligation_amount integer;
  obligation_total bigint;
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
    IF obligation_total > obligation_amount THEN
      RAISE EXCEPTION 'Group obligations must not be over-applied';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "group_settlements_applications_complete"
AFTER INSERT OR UPDATE ON "group_settlements"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_settlement_application_totals"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "group_settlement_applications_totals"
AFTER INSERT ON "group_settlement_applications"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_settlement_application_totals"();--> statement-breakpoint
DO $$
DECLARE
  settlement_row record;
  obligation_row record;
  remaining bigint;
  capacity bigint;
  applied_amount integer;
BEGIN
  FOR settlement_row IN
    SELECT id, group_id, sender_participant_id, recipient_participant_id, amount, confirmed_at
    FROM group_settlements
    WHERE state = 'confirmed'
    ORDER BY confirmed_at, id
  LOOP
    remaining := settlement_row.amount;
    FOR obligation_row IN
      SELECT
        obligations.id,
        obligations.created_at,
        obligations.original_amount,
        COALESCE((
          SELECT sum(applications.applied_amount)
          FROM group_settlement_applications AS applications
          WHERE applications.group_id = obligations.group_id
            AND applications.obligation_id = obligations.id
        ), 0) AS applied_amount
      FROM group_obligations AS obligations
      WHERE obligations.group_id = settlement_row.group_id
        AND obligations.debtor_participant_id = settlement_row.sender_participant_id
        AND obligations.creditor_participant_id = settlement_row.recipient_participant_id
        AND obligations.created_at <= settlement_row.confirmed_at
        AND (obligations.voided_at IS NULL OR obligations.voided_at > settlement_row.confirmed_at)
      ORDER BY obligations.created_at, obligations.id
      FOR UPDATE
    LOOP
      capacity := obligation_row.original_amount - obligation_row.applied_amount;
      IF capacity > 0 THEN
        applied_amount := LEAST(remaining, capacity)::integer;
        INSERT INTO group_settlement_applications (
          group_id,
          settlement_id,
          obligation_id,
          applied_amount,
          created_at
        ) VALUES (
          settlement_row.group_id,
          settlement_row.id,
          obligation_row.id,
          applied_amount,
          settlement_row.confirmed_at
        );
        remaining := remaining - applied_amount;
      END IF;
      EXIT WHEN remaining = 0;
    END LOOP;
    IF remaining <> 0 THEN
      RAISE EXCEPTION 'Cannot deterministically backfill Group settlement %: % remains unallocated', settlement_row.id, remaining;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT settlements.id
    FROM group_settlements AS settlements
    LEFT JOIN group_settlement_applications AS applications
      ON applications.group_id = settlements.group_id
     AND applications.settlement_id = settlements.id
    WHERE settlements.state = 'confirmed'
    GROUP BY settlements.id, settlements.amount
    HAVING COALESCE(sum(applications.applied_amount), 0) <> settlements.amount
  ) THEN
    RAISE EXCEPTION 'Confirmed Group settlement backfill is incomplete';
  END IF;
END;
$$;
