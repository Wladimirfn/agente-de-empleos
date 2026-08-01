CREATE TABLE `chat_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`conversation_id` text DEFAULT 'default' NOT NULL,
	`summary` text NOT NULL,
	`turns_covered` integer NOT NULL,
	`start_message_id` integer NOT NULL,
	`end_message_id` integer NOT NULL,
	`tokens_before` integer NOT NULL,
	`model` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `candidate_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_summaries_profile_conv_idx` ON `chat_summaries` (`profile_id`,`conversation_id`,`created_at`);