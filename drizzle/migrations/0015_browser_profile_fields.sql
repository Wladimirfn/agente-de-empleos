-- Add browser profile fields to platform_credentials
-- These store which browser the user logged in with and where its
-- persistent profile lives, so BROWSER_AGENT_SCAN can reattach to the
-- SAME browser+profile on subsequent runs (cookies survive worker restart).
ALTER TABLE `platform_credentials` ADD `browser_id` text;--> statement-breakpoint
ALTER TABLE `platform_credentials` ADD `browser_path` text;--> statement-breakpoint
ALTER TABLE `platform_credentials` ADD `profile_path` text;