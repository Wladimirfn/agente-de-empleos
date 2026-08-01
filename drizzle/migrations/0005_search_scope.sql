-- Migration 0005: search scope preference for job search
-- Values: 'local' (same city), 'national' (same country), 'international', 'remote' (online only)
ALTER TABLE candidate_profiles ADD COLUMN search_scope TEXT DEFAULT 'local';
