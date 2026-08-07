import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const platformCredentials = sqliteTable('platform_credentials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  /** AES-GCM ciphertext (base64) of the user's email at the platform. */
  emailCipher: text('email_cipher').notNull(),
  /** AES-GCM ciphertext (base64) of the user's password. */
  passwordCipher: text('password_cipher').notNull(),
  /** AES-GCM ciphertext (base64) of the Playwright storage state JSON. */
  storageStateCipher: text('storage_state_cipher'),
  lastLoginAt: text('last_login_at'),
  lastLoginStatus: text('last_login_status', {
    enum: ['success', '2fa_required', 'login_failed', 'no_login_form', 'unknown'],
  }).notNull().default('unknown'),
  /** ISO-8601 timestamp the user explicitly consented to saving this credential. */
  consentAt: text('consent_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  /** Which browser the user logged in with (brave, chrome, edge, comet). */
  browserId: text('browser_id'),
  /** Absolute path to the browser executable. NOT a secret. */
  browserPath: text('browser_path'),
  /** Path to the user-data-dir that holds this platform's cookies/session. */
  profilePath: text('profile_path'),
}, (t) => ({
  slugUnique: uniqueIndex('platform_credentials_slug_unique').on(t.slug),
}));
