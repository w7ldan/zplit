ALTER TABLE "expenses" DROP CONSTRAINT "expenses_outing_id_outings_id_fk";
--> statement-breakpoint
DROP INDEX "expenses_occurred_at_idx";--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "outing_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "outings_owner_user_id_id_uidx" ON "outings" USING btree ("owner_user_id","id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_owner_outing_fk" FOREIGN KEY ("owner_user_id","outing_id") REFERENCES "public"."outings"("owner_user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN "occurred_at";
