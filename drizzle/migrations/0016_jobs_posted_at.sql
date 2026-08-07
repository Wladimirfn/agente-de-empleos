-- Add postedAt to jobs so we can sort by freshness (newest first)
-- and skip duplicates that have the same externalId but newer postedAt.
-- Optional: not all platforms expose a publish timestamp.
ALTER TABLE `jobs` ADD `posted_at` text;