-- Migration 0006: match feedback for LLM scoring improvement
-- Stores user corrections on LLM match scores so future scoring
-- can learn from past verdicts via few-shot examples.
CREATE TABLE IF NOT EXISTS match_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  profile_id INTEGER NOT NULL,
  original_score INTEGER NOT NULL,
  user_verdict TEXT NOT NULL CHECK(user_verdict IN ('compatible', 'not_compatible')),
  user_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS match_feedback_profile_idx ON match_feedback (profile_id, user_verdict);
CREATE INDEX IF NOT EXISTS match_feedback_job_idx ON match_feedback (job_id);
