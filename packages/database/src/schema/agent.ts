import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { candidateProfiles } from './candidate.js';

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

/**
 * Persistent chat transcript. One row per turn (user or assistant).
 * The agent reads the most recent N rows before replying, so context
 * survives server restarts.
 */
export const chatMessages = sqliteTable('chat_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().default('default'),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  provider: text('provider'),
  model: text('model'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  profileConvIdx: index('chat_messages_profile_conv_idx').on(t.profileId, t.conversationId, t.createdAt),
}));

/**
 * Long-term facts the agent has learned about the candidate. Injected into
 * the system prompt on every turn so the agent remembers preferences,
 * decisions and personal context across sessions.
 */
export const chatMemoryFacts = sqliteTable('chat_memory_facts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  category: text('category', { enum: ['preference', 'decision', 'personal', 'job-context', 'other'] }).notNull().default('other'),
  fact: text('fact').notNull(),
  source: text('source', { enum: ['manual', 'extracted', 'inferred'] }).notNull().default('manual'),
  importance: integer('importance').notNull().default(5),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  profileIdx: index('chat_memory_facts_profile_idx').on(t.profileId, t.updatedAt),
}));

/**
 * Compacted conversation summaries. When a model's context window gets close
 * to its compaction threshold, the older messages in chat_messages are
 * collapsed into a single summary row here. The summary stays attached to
 * the conversation so we never lose the thread, and recent messages keep
 * full-fidelity context.
 */
export const chatSummaries = sqliteTable('chat_summaries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull().default('default'),
  summary: text('summary').notNull(),
  turnsCovered: integer('turns_covered').notNull(),
  startMessageId: integer('start_message_id').notNull(),
  endMessageId: integer('end_message_id').notNull(),
  tokensBefore: integer('tokens_before').notNull(),
  model: text('model'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  profileConvIdx: index('chat_summaries_profile_conv_idx').on(t.profileId, t.conversationId, t.createdAt),
}));
