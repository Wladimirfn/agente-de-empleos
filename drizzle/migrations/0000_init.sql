CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`summary` text
);
--> statement-breakpoint
CREATE INDEX `agent_runs_started_at_idx` ON `agent_runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `agent_runs_kind_idx` ON `agent_runs` (`kind`);--> statement-breakpoint
CREATE TABLE `skill_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`skill_slug` text NOT NULL,
	`skill_version` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`screenshot_path` text,
	`page_html_hash` text,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`repaired_at` text,
	`repair_strategy` text
);
--> statement-breakpoint
CREATE INDEX `skill_failures_skill_idx` ON `skill_failures` (`skill_slug`);--> statement-breakpoint
CREATE TABLE `skill_healthchecks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`skill_slug` text NOT NULL,
	`status` text NOT NULL,
	`details_json` text,
	`checked_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `healthchecks_skill_checked_idx` ON `skill_healthchecks` (`skill_slug`,`checked_at`);--> statement-breakpoint
CREATE TABLE `candidate_experiences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`description` text,
	`source` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `candidate_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `experiences_profile_idx` ON `candidate_experiences` (`profile_id`);--> statement-breakpoint
CREATE TABLE `candidate_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text,
	`email` text,
	`phone` text,
	`location` text,
	`summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `candidate_skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`name` text NOT NULL,
	`level` text,
	`years` real,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `candidate_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skills_profile_idx` ON `candidate_skills` (`profile_id`);--> statement-breakpoint
CREATE TABLE `candidate_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`kind` text NOT NULL,
	`file_hash` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `candidate_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_hash_kind_unique` ON `candidate_documents` (`file_hash`,`kind`);--> statement-breakpoint
CREATE TABLE `platform_skills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer NOT NULL,
	`skill_slug` text NOT NULL,
	`version` text NOT NULL,
	`installed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_success_at` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_skills_unique` ON `platform_skills` (`platform_id`,`skill_slug`);--> statement-breakpoint
CREATE TABLE `platforms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`display_name` text NOT NULL,
	`base_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platforms_slug_unique` ON `platforms` (`slug`);--> statement-breakpoint
CREATE TABLE `application_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`payload_json` text,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_id_idx` ON `application_events` (`id`);--> statement-breakpoint
CREATE INDEX `events_occurred_at_idx` ON `application_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`profile_id` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`prepared_at` text,
	`submitted_at` text,
	`evidence_path` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `candidate_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`profile_id` integer NOT NULL,
	`score` real NOT NULL,
	`breakdown_json` text,
	`computed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `candidate_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_job_profile_unique` ON `job_matches` (`job_id`,`profile_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` integer NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`company` text,
	`location` text,
	`url` text,
	`description` text,
	`raw_payload` text,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`hash` text,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_platform_external_unique` ON `jobs` (`platform_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `jobs_last_seen_idx` ON `jobs` (`last_seen_at`);--> statement-breakpoint
CREATE TABLE `task_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`scheduled_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `task_queue_status_scheduled_idx` ON `task_queue` (`status`,`scheduled_at`);