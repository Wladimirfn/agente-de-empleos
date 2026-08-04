CREATE TABLE `system_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE TABLE `platform_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`email_cipher` text NOT NULL,
	`password_cipher` text NOT NULL,
	`storage_state_cipher` text,
	`last_login_at` text,
	`last_login_status` text DEFAULT 'unknown' NOT NULL,
	`consent_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `platform_credentials_slug_unique` ON `platform_credentials` (`slug`);
