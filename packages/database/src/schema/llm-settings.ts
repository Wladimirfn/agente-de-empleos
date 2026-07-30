import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const llmSettings = sqliteTable('llm_settings', {
  id: integer('id').primaryKey().notNull().default(1),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  baseUrl: text('base_url'),
  apiKeyTarget: text('api_key_target'),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  singleton: check('llm_settings_singleton', sql`${table.id} = 1`),
}));

export type LLMSettingsRow = typeof llmSettings.$inferSelect;
