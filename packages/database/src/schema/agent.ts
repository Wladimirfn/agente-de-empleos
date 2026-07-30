import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const agentRuns = sqliteTable('agent_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  startedAt: text('started_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text('finished_at'),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
  summary: text('summary'),
}, (t) => ({
  startedAtIdx: index('agent_runs_started_at_idx').on(t.startedAt),
  kindIdx: index('agent_runs_kind_idx').on(t.kind),
}));

export const skillFailures = sqliteTable('skill_failures', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  skillSlug: text('skill_slug').notNull(),
  skillVersion: text('skill_version').notNull(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  screenshotPath: text('screenshot_path'),
  pageHtmlHash: text('page_html_hash'),
  occurredAt: text('occurred_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  repairedAt: text('repaired_at'),
  repairStrategy: text('repair_strategy'),
}, (t) => ({
  skillIdx: index('skill_failures_skill_idx').on(t.skillSlug),
}));

export const skillHealthchecks = sqliteTable('skill_healthchecks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  skillSlug: text('skill_slug').notNull(),
  status: text('status', {
    enum: ['healthy', 'degraded', 'broken', 'needs-human'],
  }).notNull(),
  detailsJson: text('details_json'),
  checkedAt: text('checked_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  skillCheckedIdx: index('healthchecks_skill_checked_idx').on(t.skillSlug, t.checkedAt),
}));
