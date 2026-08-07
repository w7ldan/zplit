CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" varchar(160) NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_name_not_blank" CHECK (btrim("trips"."name") <> ''),
	CONSTRAINT "trips_date_range_valid" CHECK ("trips"."ends_on" IS NULL OR "trips"."starts_on" IS NULL OR "trips"."ends_on" >= "trips"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "outings" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trips_owner_user_id_id_uidx" ON "trips" USING btree ("owner_user_id","id");--> statement-breakpoint
CREATE INDEX "trips_owner_user_id_name_idx" ON "trips" USING btree ("owner_user_id","name");--> statement-breakpoint
CREATE INDEX "trips_owner_user_id_dates_idx" ON "trips" USING btree ("owner_user_id","starts_on","ends_on");--> statement-breakpoint
ALTER TABLE "outings" ADD CONSTRAINT "outings_owner_trip_fk" FOREIGN KEY ("owner_user_id","trip_id") REFERENCES "public"."trips"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outings_owner_user_id_trip_id_idx" ON "outings" USING btree ("owner_user_id","trip_id");