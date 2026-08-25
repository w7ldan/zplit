ALTER TABLE "users" ADD COLUMN "username" varchar(20);--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uidx" ON "users" USING btree ("username") WHERE "users"."username" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_lowercase" CHECK ("users"."username" IS NULL OR "users"."username" = lower("users"."username"));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_username_shape" CHECK ("users"."username" IS NULL OR (length("users"."username") BETWEEN 3 AND 20 AND "users"."username" ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$' AND "users"."username" !~ '[._]{2}'));
