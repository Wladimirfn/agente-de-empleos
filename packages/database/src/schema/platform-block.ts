import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Tracks when a platform is temporarily blocked from scanning.
 *
 * The browser-agent fills this when it detects a Cloudflare-style challenge,
 * a CAPTCHA, or a hard login wall that the LLM cannot solve from the agent
 * environment. The `until` column gives a TTL so the scheduler will retry
 * automatically once the cooldown expires.
 *
 * Schema is intentionally narrow: only the slug and the blocking reason.
 * No PII, no per-session data — these rows are safe to surface in audit
 * reports and to ship to the web UI.
 */
export const platformBlocks = sqliteTable('platform_blocks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  reason: text('reason', { enum: ['cloudflare-verification', 'captcha', 'login-required', 'transport', 'unknown'] }).notNull(),
  marker: text('marker'),
  /** ISO-8601 timestamp. Until this point, the scheduler skips the platform. */
  until: text('until').notNull(),
  createdAt: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
}, (t) => ({
  slugIdx: index('platform_blocks_slug_idx').on(t.slug, t.until),
}));
