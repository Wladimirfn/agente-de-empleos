-- Align __drizzle_migrations with the SHA-256 hashes this codebase uses.
--
-- Legacy DBs (created before the journal was properly maintained) have
-- rows in __drizzle_migrations with empty hashes. The migrator skips a
-- migration only when its hash matches an entry already in the table;
-- with empty hashes, it tries to re-apply every migration and fails with
-- "table already exists" on the existing tables.
--
-- This migration INSERTs the expected hashes for 0000-0010 with
-- INSERT OR IGNORE so:
--   * Fresh DBs: the migrator already inserted these hashes itself
--     (via the normal flow), so this is a no-op.
--   * Legacy DBs: rows already exist with empty hashes; we leave them
--     in place (they don't match any new hash) and add the proper hashes
--     alongside them so the migrator can match them.
--
-- The migrator runs journal entries in order. This migration is registered
-- as idx 0 in the journal so it runs BEFORE the schema migrations it
-- references. That way 0011 and 0012 (which DO need to be applied to
-- legacy DBs) are recognized as "not yet applied" by the time the
-- migrator reaches them.
INSERT OR IGNORE INTO __drizzle_migrations ("hash", "created_at") VALUES
  ('61a07e5240d603c22afcddc6a9d5a1a111acfb0a60848f443e3475e67a3fb364', 0),
  ('8879e34708ea0456e155c7299a9e0ec60b6b2b0a608ad2cc7d4328af09b5165e', 0),
  ('db0ae174ee9c0a41393a0699eecece0b846e13ccb120533370ca27c37aab9a5e', 0),
  ('8c543531c3149f16d7bb3136e18e93754d2f817837cfb05b9480a5d8269a413c', 0),
  ('3629eb23811854abce5cad64b9e918ab24c021a491bf2448dd0ddebecc294e72', 0),
  ('a2c47a18a3fc5c1ba2e21c1901c9c39a50d36b84926c138c91be293cafdd5305', 0),
  ('a6b0261c12a87ea702f0c187757d1ffeb072111efb6a4b454c4cbc8c76f8dbfe', 0),
  ('46bfea278eb11e2df7a0296fcf489fe0c4db8fdaab57a29bc7c2d29db799cbbd', 0),
  ('8ddcc355e5f6d0be5b8c41d857db92ba8dd269f18d2256b390f4dc0238852933', 0),
  ('70a55765a25a8f70511da682f340e132b2235ef37ece549acdcf25eee96ca01d', 0),
  ('ac83e9fdbfea5aec696181e7ffbab3107d68400205ea34f5f69e89b954e78ea6', 0);
