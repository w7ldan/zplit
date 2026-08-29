ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_id_unique" UNIQUE("thread_id","id");--> statement-breakpoint
CREATE TABLE "chat_thread_reads" (
	"thread_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"last_read_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_thread_reads_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "chat_thread_reads" ADD CONSTRAINT "chat_thread_reads_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_thread_reads" ADD CONSTRAINT "chat_thread_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_thread_reads" ADD CONSTRAINT "chat_thread_reads_message_scope_fk" FOREIGN KEY ("thread_id","last_read_message_id") REFERENCES "public"."chat_messages"("thread_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_thread_reads_user_idx" ON "chat_thread_reads" USING btree ("user_id");
