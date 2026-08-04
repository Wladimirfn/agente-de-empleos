import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Tracks ongoing browser sessions where the user is logging in manually
 * (typically because the platform uses OAuth or another flow that the
 * agent can't automate).
 *
 * Lifecycle:
 * 1. Web POST /api/settings/credentials/session creates a row with
 *    status='pending' and enqueues a CAPTURE_SESSION task.
 * 2. The worker claims the task, opens a headed Playwright browser on
 *    the platform's origin, and polls this row until the user signals
 *    "Listo" (user_completed_at is set) or the row expires.
 * 3. On completion, the worker serializes context.storageState(),
 *    encrypts it with the same master key as other credentials, and
 *    stores it in `platform_credentials.storage_state_cipher`.
 *
 * The polling interval and TTL are enforced in the worker; this table
 * only mirrors the state for the UI to show what's happening.
 */
export const sessionCaptures = sqliteTable('session_captures', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull(),
  status: text('status', {
    enum: ['pending', 'ready', 'completed', 'expired', 'failed', 'cancelled'],
  }).notNull().default('pending'),
  /** Set when the worker has opened the browser and the user can log in. */
  readyAt: text('ready_at'),
  /** Set when the user clicks "Listo" in the UI to signal they're done. */
  userCompletedAt: text('user_completed_at'),
  /** Worker's diagnostic message (e.g. last error). */
  error: text('error'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text('expires_at').notNull(),
}, (t) => ({
  statusIdx: index('session_captures_status_idx').on(t.status, t.expiresAt),
}));
