CREATE TABLE `agent_confirmations` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` integer NOT NULL,
	`conversation_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`profile_id`) REFERENCES `candidate_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `agent_confirmations_latest_idx` ON `agent_confirmations` (`profile_id`,`conversation_id`,`kind`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_confirmations_one_pending_idx` ON `agent_confirmations` (`profile_id`,`conversation_id`,`kind`) WHERE `status` = 'pending';
