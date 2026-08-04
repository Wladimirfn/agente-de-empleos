import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * One-row-per-secret storage for system-level keys (today: the master
 * encryption key for platform credentials).
 *
 * The table is intentionally tiny: only `id` and `value` (base64). The
 * security model is "the DB file is the secret store" — operators must
 * enable OS-level encryption (BitLocker / FileVault / LUKS) for the
 * filesystem holding the DB.
 */
export const systemSecrets = sqliteTable('system_secrets', {
  id: text('id').primaryKey(),
  value: text('value').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
