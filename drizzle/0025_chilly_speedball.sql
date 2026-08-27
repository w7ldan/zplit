ALTER TABLE "group_join_requests" DROP CONSTRAINT "group_join_requests_kind_participant_shape";--> statement-breakpoint
ALTER TABLE "group_join_requests" DROP CONSTRAINT "group_join_requests_participant_fk";
--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD COLUMN "participant_display_name_snapshot" varchar(160);--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD COLUMN "participant_label_snapshot" varchar(120);--> statement-breakpoint
UPDATE "group_join_requests" AS requests
SET "participant_display_name_snapshot" = COALESCE(participants."display_name", (SELECT notification."metadata" ->> 'participantDisplayName' FROM "notifications" AS notification WHERE notification."type" = 'group.participant.link.request' AND notification."metadata" ->> 'requestId' = requests."id"::text LIMIT 1), 'Participant'),
    "participant_label_snapshot" = COALESCE(participants."label", (SELECT notification."metadata" ->> 'participantLabel' FROM "notifications" AS notification WHERE notification."type" = 'group.participant.link.request' AND notification."metadata" ->> 'requestId' = requests."id"::text LIMIT 1))
FROM "group_participants" AS participants
WHERE requests."kind" = 'participant_link'
  AND requests."participant_id" IS NOT NULL
  AND participants."group_id" = requests."group_id"
  AND participants."id" = requests."participant_id";--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD CONSTRAINT "group_join_requests_participant_fk" FOREIGN KEY ("group_id","participant_id") REFERENCES "public"."group_participants"("group_id","id") ON DELETE SET NULL ("participant_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD CONSTRAINT "group_join_requests_kind_participant_shape" CHECK (("group_join_requests"."kind" = 'member_invitation' AND "group_join_requests"."participant_id" IS NULL AND "group_join_requests"."participant_display_name_snapshot" IS NULL AND "group_join_requests"."participant_label_snapshot" IS NULL) OR ("group_join_requests"."kind" = 'participant_link' AND "group_join_requests"."participant_display_name_snapshot" IS NOT NULL AND btrim("group_join_requests"."participant_display_name_snapshot") <> '' AND ("group_join_requests"."participant_id" IS NOT NULL OR "group_join_requests"."status" <> 'pending')));
