CREATE TABLE "group_expense_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"actor_user_id" text NOT NULL,
	"from_state" varchar(16),
	"to_state" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_expense_lifecycle_events_type_allowed" CHECK ("group_expense_lifecycle_events"."event_type" IN ('created', 'payer_confirmed', 'payer_rejected', 'voided')),
	CONSTRAINT "group_expense_lifecycle_events_transition_shape" CHECK (("group_expense_lifecycle_events"."event_type" = 'created' AND "group_expense_lifecycle_events"."from_state" IS NULL AND "group_expense_lifecycle_events"."to_state" IN ('pending', 'confirmed')) OR ("group_expense_lifecycle_events"."event_type" = 'payer_confirmed' AND "group_expense_lifecycle_events"."from_state" = 'pending' AND "group_expense_lifecycle_events"."to_state" = 'confirmed') OR ("group_expense_lifecycle_events"."event_type" = 'payer_rejected' AND "group_expense_lifecycle_events"."from_state" = 'pending' AND "group_expense_lifecycle_events"."to_state" = 'rejected') OR ("group_expense_lifecycle_events"."event_type" = 'voided' AND "group_expense_lifecycle_events"."from_state" = 'confirmed' AND "group_expense_lifecycle_events"."to_state" = 'voided'))
);
--> statement-breakpoint
DO $$
DECLARE
  inconsistent record;
BEGIN
  SELECT
    expenses.id AS expense_id,
    expenses.group_id,
    expenses.state,
    expenses.confirmed_at,
    creator.user_id AS creator_user_id,
    payer.user_id AS payer_user_id
  INTO inconsistent
  FROM group_expenses AS expenses
  LEFT JOIN group_participants AS creator
    ON creator.group_id = expenses.group_id
   AND creator.id = expenses.creator_participant_id
  LEFT JOIN group_participants AS payer
    ON payer.group_id = expenses.group_id
   AND payer.id = expenses.payer_participant_id
  WHERE creator.user_id IS NULL
     OR (expenses.state = 'confirmed' AND (expenses.confirmed_at IS NULL OR payer.user_id IS NULL))
  ORDER BY expenses.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Cannot backfill Group expense lifecycle history for expense %, group %: creator_user_id=%, payer_user_id=%, confirmed_at=%',
      inconsistent.expense_id,
      inconsistent.group_id,
      inconsistent.creator_user_id,
      inconsistent.payer_user_id,
      inconsistent.confirmed_at;
  END IF;
END;
$$;
--> statement-breakpoint
WITH legacy_events AS (
  SELECT
    expenses.group_id,
    expenses.id AS expense_id,
    'created'::varchar AS event_type,
    creator.user_id AS actor_user_id,
    NULL::varchar AS from_state,
    expenses.state AS to_state,
    expenses.created_at
  FROM group_expenses AS expenses
  INNER JOIN group_participants AS creator
    ON creator.group_id = expenses.group_id
   AND creator.id = expenses.creator_participant_id
  LEFT JOIN group_participants AS payer
    ON payer.group_id = expenses.group_id
   AND payer.id = expenses.payer_participant_id
  WHERE expenses.state = 'pending'
     OR (expenses.state = 'confirmed' AND creator.user_id = payer.user_id)

  UNION ALL

  SELECT
    expenses.group_id,
    expenses.id,
    'created'::varchar,
    creator.user_id,
    NULL::varchar,
    'pending'::varchar,
    expenses.created_at
  FROM group_expenses AS expenses
  INNER JOIN group_participants AS creator
    ON creator.group_id = expenses.group_id
   AND creator.id = expenses.creator_participant_id
  INNER JOIN group_participants AS payer
    ON payer.group_id = expenses.group_id
   AND payer.id = expenses.payer_participant_id
  WHERE expenses.state = 'confirmed'
    AND creator.user_id <> payer.user_id

  UNION ALL

  SELECT
    expenses.group_id,
    expenses.id,
    'payer_confirmed'::varchar,
    payer.user_id,
    'pending'::varchar,
    'confirmed'::varchar,
    expenses.confirmed_at
  FROM group_expenses AS expenses
  INNER JOIN group_participants AS creator
    ON creator.group_id = expenses.group_id
   AND creator.id = expenses.creator_participant_id
  INNER JOIN group_participants AS payer
    ON payer.group_id = expenses.group_id
   AND payer.id = expenses.payer_participant_id
  WHERE expenses.state = 'confirmed'
    AND creator.user_id <> payer.user_id
)
INSERT INTO group_expense_lifecycle_events (group_id, expense_id, event_type, actor_user_id, from_state, to_state, created_at)
SELECT legacy.group_id, legacy.expense_id, legacy.event_type, legacy.actor_user_id, legacy.from_state, legacy.to_state, legacy.created_at
FROM legacy_events AS legacy
WHERE NOT EXISTS (
  SELECT 1
  FROM group_expense_lifecycle_events AS existing
  WHERE existing.group_id = legacy.group_id
    AND existing.expense_id = legacy.expense_id
    AND existing.event_type = legacy.event_type
    AND existing.actor_user_id = legacy.actor_user_id
    AND existing.from_state IS NOT DISTINCT FROM legacy.from_state
    AND existing.to_state = legacy.to_state
    AND existing.created_at = legacy.created_at
);
--> statement-breakpoint
ALTER TABLE "group_expenses" DROP CONSTRAINT "group_expenses_state_allowed";--> statement-breakpoint
ALTER TABLE "group_expenses" DROP CONSTRAINT "group_expenses_confirmation_timestamp_shape";--> statement-breakpoint
ALTER TABLE "group_obligations" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "group_expense_lifecycle_events" ADD CONSTRAINT "group_expense_lifecycle_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expense_lifecycle_events" ADD CONSTRAINT "group_expense_lifecycle_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_expense_lifecycle_events" ADD CONSTRAINT "group_expense_lifecycle_events_expense_fk" FOREIGN KEY ("group_id","expense_id") REFERENCES "public"."group_expenses"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_expense_lifecycle_events_expense_created_idx" ON "group_expense_lifecycle_events" USING btree ("group_id","expense_id","created_at","id");--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_state_allowed" CHECK ("group_expenses"."state" IN ('pending', 'confirmed', 'rejected', 'voided'));--> statement-breakpoint
ALTER TABLE "group_expenses" ADD CONSTRAINT "group_expenses_confirmation_timestamp_shape" CHECK (("group_expenses"."state" IN ('pending', 'rejected') AND "group_expenses"."confirmed_at" IS NULL) OR ("group_expenses"."state" IN ('confirmed', 'voided') AND "group_expenses"."confirmed_at" IS NOT NULL));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "zplit_validate_group_expense_confirmation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  share_total bigint;
  payer_user_id text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.state <> 'pending' THEN
    RAISE EXCEPTION 'Group expenses must be created pending';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.state IS DISTINCT FROM OLD.state AND NOT (
    (OLD.state = 'pending' AND NEW.state IN ('confirmed', 'rejected')) OR
    (OLD.state = 'confirmed' AND NEW.state = 'voided')
  ) THEN
    RAISE EXCEPTION 'Invalid Group expense state transition';
  END IF;

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
$$;
--> statement-breakpoint
CREATE FUNCTION "zplit_validate_group_obligation_update"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expense_state text;
BEGIN
  IF NEW.group_id IS DISTINCT FROM OLD.group_id
    OR NEW.source_expense_id IS DISTINCT FROM OLD.source_expense_id
    OR NEW.source_share_id IS DISTINCT FROM OLD.source_share_id
    OR NEW.debtor_participant_id IS DISTINCT FROM OLD.debtor_participant_id
    OR NEW.creditor_participant_id IS DISTINCT FROM OLD.creditor_participant_id
    OR NEW.original_amount IS DISTINCT FROM OLD.original_amount
    OR (OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at)
  THEN
    RAISE EXCEPTION 'Group obligation historical facts are immutable';
  END IF;
  IF NEW.voided_at IS NOT NULL THEN
    SELECT state INTO expense_state
    FROM group_expenses
    WHERE group_id = NEW.group_id AND id = NEW.source_expense_id;
    IF expense_state <> 'voided' THEN
      RAISE EXCEPTION 'Only voided Group expenses may reverse obligations';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "group_obligations_historical_facts"
BEFORE UPDATE ON "group_obligations"
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_obligation_update"();
