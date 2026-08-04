CREATE TABLE `session_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ready_at` text,
	`user_completed_at` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `session_captures_status_idx` ON `session_captures` (`status`,`expires_at`);
