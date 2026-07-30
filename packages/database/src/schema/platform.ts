import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const platforms = sqliteTable('platforms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull(),
  displayName: text('display_name').notNull(),
  baseUrl: text('base_url'),
  status: text('status', { enum: ['active', 'paused', 'broken'] }).notNull().default('active'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  slugUnique: uniqueIndex('platforms_slug_unique').on(t.slug),
}));

export const platformSkills = sqliteTable('platform_skills', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platformId: integer('platform_id').notNull().references(() => platforms.id, { onDelete: 'cascade' }),
  skillSlug: text('skill_slug').notNull(),
  version: text('version').notNull(),
  installedAt: text('installed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSuccessAt: text('last_success_at'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
}, (t) => ({
  platformSkillUnique: uniqueIndex('platform_skills_unique').on(t.platformId, t.skillSlug),
}));
