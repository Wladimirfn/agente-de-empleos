-- Migration 0008: require full_name to be non-empty when present.
--
-- Defense-in-depth for the CV upload flow. The application layer
-- (CvReviewForm.tsx + apps/web/src/pages/api/cvs/confirm.ts) is the
-- primary gate; this CHECK guarantees we can never persist a row where
-- full_name is an empty string. NULL remains allowed because the column
-- is declared nullable for legacy imports and out-of-band inserts.
--
-- SQLite does not support ALTER TABLE ... ADD CONSTRAINT, so the
-- standard rebuild-and-copy pattern is used:
--   1. Disable FK enforcement for the duration of the rebuild.
--   2. Create __new_candidate_profiles with the CHECK constraint.
--   3. Copy rows from the existing table.
--   4. Drop the old table, rename the new one.
--   5. Re-enable FK enforcement.
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
	CONSTRAINT "candidate_profiles_full_name_not_empty" CHECK("__new_candidate_profiles"."full_name" IS NULL OR length("__new_candidate_profiles"."full_name") > 0)
);--> statement-breakpoint
INSERT INTO `__new_candidate_profiles`("id", "full_name", "email", "phone", "location", "search_scope", "summary", "created_at", "updated_at") SELECT "id", "full_name", "email", "phone", "location", "search_scope", "summary", "created_at", "updated_at" FROM `candidate_profiles`;--> statement-breakpoint
DROP TABLE `candidate_profiles`;--> statement-breakpoint
ALTER TABLE `__new_candidate_profiles` RENAME TO `candidate_profiles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;