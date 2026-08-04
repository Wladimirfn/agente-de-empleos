-- Add browser lifecycle columns to platform_credentials.
--
-- The new session-capture flow (PR #40/#41) used Playwright's bundled
-- Chromium and a single storage-state blob. That worked against Cloudflare
-- but Google blocked it because Playwright's Chromium has a different TLS
-- fingerprint than real Chrome. The fix is to launch a real browser
-- (Brave/Chrome/Edge/Comet) with --user-data-dir pointing at a profile
-- directory we control. The user logs in once; subsequent launches reuse
-- the profile so the cookies persist.
--
-- `browser_path`: absolute path to the browser executable that owns
-- this profile. Saved so the agent can re-launch the same browser on
-- the next scan. Nullable: NULL means the user is on the legacy
-- Playwright-only flow and we should fall back to storageState.
--
-- `profile_path`: absolute path to the user-data-dir. Saved so the
-- agent can re-launch the same profile on the next scan. Like above,
-- NULL means the legacy flow.
ALTER TABLE `platform_credentials` ADD COLUMN `browser_path` text;--> statement-breakpoint
ALTER TABLE `platform_credentials` ADD COLUMN `profile_path` text;--> statement-breakpoint
ALTER TABLE `platform_credentials` ADD COLUMN `browser_id` text;
