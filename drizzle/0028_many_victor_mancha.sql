CREATE TABLE "group_settlement_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"original_filename" varchar(160) NOT NULL,
	"media_type" varchar(32) NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_settlement_proofs_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_settlement_proofs_settlement_sha256_unique" UNIQUE("group_id","settlement_id","sha256"),
	CONSTRAINT "group_settlement_proofs_media_type_allowed" CHECK ("group_settlement_proofs"."media_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "group_settlement_proofs_byte_size_valid" CHECK ("group_settlement_proofs"."byte_size" BETWEEN 1 AND 5242880),
	CONSTRAINT "group_settlement_proofs_content_size_matches" CHECK (octet_length("group_settlement_proofs"."content") = "group_settlement_proofs"."byte_size"),
	CONSTRAINT "group_settlement_proofs_filename_not_blank" CHECK (btrim("group_settlement_proofs"."original_filename") <> ''),
	CONSTRAINT "group_settlement_proofs_sha256_hex" CHECK ("group_settlement_proofs"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "group_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"sender_participant_id" uuid NOT NULL,
	"recipient_participant_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"payment_method" varchar(40) NOT NULL,
	"state" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "group_settlements_group_id_id_unique" UNIQUE("group_id","id"),
	CONSTRAINT "group_settlements_amount_positive" CHECK ("group_settlements"."amount" > 0),
	CONSTRAINT "group_settlements_payment_method_not_blank" CHECK (btrim("group_settlements"."payment_method") <> ''),
	CONSTRAINT "group_settlements_state_allowed" CHECK ("group_settlements"."state" IN ('pending', 'confirmed')),
	CONSTRAINT "group_settlements_no_self_payment" CHECK ("group_settlements"."sender_participant_id" <> "group_settlements"."recipient_participant_id"),
	CONSTRAINT "group_settlements_confirmation_timestamp_shape" CHECK (("group_settlements"."state" = 'pending' AND "group_settlements"."confirmed_at" IS NULL) OR ("group_settlements"."state" = 'confirmed' AND "group_settlements"."confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "group_settlement_proofs" ADD CONSTRAINT "group_settlement_proofs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlement_proofs" ADD CONSTRAINT "group_settlement_proofs_settlement_fk" FOREIGN KEY ("group_id","settlement_id") REFERENCES "public"."group_settlements"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_sender_participant_fk" FOREIGN KEY ("group_id","sender_participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_recipient_participant_fk" FOREIGN KEY ("group_id","recipient_participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_settlement_proofs_settlement_uidx" ON "group_settlement_proofs" USING btree ("group_id","settlement_id");--> statement-breakpoint
CREATE INDEX "group_settlements_group_created_idx" ON "group_settlements" USING btree ("group_id","created_at","id");--> statement-breakpoint
CREATE INDEX "group_settlements_group_sender_recipient_idx" ON "group_settlements" USING btree ("group_id","sender_participant_id","recipient_participant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "group_settlements_pending_recipient_idx" ON "group_settlements" USING btree ("group_id","recipient_participant_id","created_at","id") WHERE "group_settlements"."state" = 'pending';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "zplit_validate_group_settlement"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  sender_user_id text;
  recipient_user_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Group settlements are immutable financial history';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.state <> 'pending' THEN
    RAISE EXCEPTION 'Group settlements must be created pending';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD.group_id IS DISTINCT FROM NEW.group_id
    OR OLD.sender_participant_id IS DISTINCT FROM NEW.sender_participant_id
    OR OLD.recipient_participant_id IS DISTINCT FROM NEW.recipient_participant_id
    OR OLD.amount IS DISTINCT FROM NEW.amount
    OR OLD.payment_method IS DISTINCT FROM NEW.payment_method
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR OLD.state <> 'pending'
    OR NEW.state <> 'confirmed'
    OR NEW.confirmed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Group settlement financial facts are immutable and only pending settlements may be confirmed';
  END IF;

  SELECT user_id INTO sender_user_id
  FROM group_participants
  WHERE group_id = NEW.group_id AND id = NEW.sender_participant_id;
  SELECT user_id INTO recipient_user_id
  FROM group_participants
  WHERE group_id = NEW.group_id AND id = NEW.recipient_participant_id;
  IF sender_user_id IS NULL OR recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'Group settlement participants must be registered';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "group_settlements_historical_facts"
BEFORE INSERT OR UPDATE OR DELETE ON "group_settlements"
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_settlement"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "zplit_validate_group_settlement_proof"() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  settlement_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT state INTO settlement_state
    FROM group_settlements
    WHERE group_id = OLD.group_id AND id = OLD.settlement_id
    FOR UPDATE;
  ELSE
    SELECT state INTO settlement_state
    FROM group_settlements
    WHERE group_id = NEW.group_id AND id = NEW.settlement_id
    FOR UPDATE;
  END IF;
  IF settlement_state IS NULL OR settlement_state <> 'pending' THEN
    RAISE EXCEPTION 'Confirmed Group settlement proof is read-only';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD.id IS DISTINCT FROM NEW.id
    OR OLD.group_id IS DISTINCT FROM NEW.group_id
    OR OLD.settlement_id IS DISTINCT FROM NEW.settlement_id
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
  ) THEN
    RAISE EXCEPTION 'Group settlement proof identity is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "group_settlement_proofs_pending_only"
BEFORE INSERT OR UPDATE OR DELETE ON "group_settlement_proofs"
FOR EACH ROW EXECUTE FUNCTION "zplit_validate_group_settlement_proof"();
