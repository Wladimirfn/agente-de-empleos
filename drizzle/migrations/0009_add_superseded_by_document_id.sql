-- Migration 0009: track which CV document last replaced each profile.
--
-- Adds superseded_by_document_id + superseded_at to candidate_profiles so
-- we can answer "when was this profile's data overwritten by a new CV"
-- without digging through logs. Nullable because legacy rows pre-date
-- the audit trail.
--
-- The FK to candidate_documents is declared here (not in the Drizzle
-- schema) because candidateProfiles and candidateDocuments have a
-- circular definition: profile -> documents (superseded_by_document_id)
-- and documents -> profile (profile_id). Declaring it in the schema
-- causes Drizzle's cross-table reference resolution to crash.
--
-- The full rebuild-and-copy pattern is used because:
--   1. SQLite cannot ALTER TABLE ... ADD COLUMN with FK constraints
--      beyond simple type/null/default changes.
--   2. The candidate_profiles_full_name_not_empty CHECK constraint from
--      the previous migration must be preserved (and re-added, since
--      the rebuild recreates the table from scratch).
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_candidate_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text,
	`email` text,
	`phone` text,
	`location` text,
	`search_scope` text DEFAULT 'local',
	`summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`superseded_by_document_id` integer,
	`superseded_at` text,
	CONSTRAINT "candidate_profiles_full_name_not_empty" CHECK("__new_candidate_profiles"."full_name" IS NULL OR length("__new_candidate_profiles"."full_name") > 0),
	FOREIGN KEY (`superseded_by_document_id`) REFERENCES `candidate_documents`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_candidate_profiles`("id", "full_name", "email", "phone", "location", "search_scope", "summary", "created_at", "updated_at", "superseded_by_document_id", "superseded_at") SELECT "id", "full_name", "email", "phone", "location", "search_scope", "summary", "created_at", "updated_at", NULL, NULL FROM `candidate_profiles`;--> statement-breakpoint
DROP TABLE `candidate_profiles`;--> statement-breakpoint
ALTER TABLE `__new_candidate_profiles` RENAME TO `candidate_profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;