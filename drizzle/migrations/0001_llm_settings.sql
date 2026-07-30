CREATE TABLE `llm_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`base_url` text,
	`api_key_target` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "llm_settings_singleton" CHECK("llm_settings"."id" = 1)
);
