import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const scanSettings = sqliteTable('scan_settings', {
  id: integer('id').primaryKey().notNull().default(1),
  scanIntervalMinutes: integer('scan_interval_minutes').notNull().default(30),
  autoScanEnabled: integer('auto_scan_enabled').notNull().default(1),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  singleton: check('scan_settings_singleton', sql`${table.id} = 1`),
}));

export type ScanSettingsRow = typeof scanSettings.$inferSelect;
