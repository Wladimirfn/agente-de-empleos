CREATE TABLE `platform_blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`reason` text NOT NULL,
	`marker` text,
	`until` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX `platform_blocks_slug_idx` ON `platform_blocks` (`slug`,`until`);
