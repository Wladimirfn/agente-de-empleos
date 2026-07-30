import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { platforms } from './platform.js';
import { candidateProfiles } from './candidate.js';

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platformId: integer('platform_id').notNull().references(() => platforms.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  title: text('title').notNull(),
  company: text('company'),
  location: text('location'),
  url: text('url'),
  description: text('description'),
  rawPayload: text('raw_payload'),
  firstSeenAt: text('first_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text('last_seen_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  hash: text('hash'),
}, (t) => ({
  platformExternalUnique: uniqueIndex('jobs_platform_external_unique').on(t.platformId, t.externalId),
  lastSeenIdx: index('jobs_last_seen_idx').on(t.lastSeenAt),
}));

export const jobMatches = sqliteTable('job_matches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  score: real('score').notNull(),
  breakdownJson: text('breakdown_json'),
  computedAt: text('computed_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  jobProfileUnique: uniqueIndex('matches_job_profile_unique').on(t.jobId, t.profileId),
}));

export const applications = sqliteTable('applications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  status: text('status', {
    enum: ['draft', 'ready', 'submitted', 'failed', 'rejected'],
  }).notNull().default('draft'),
  preparedAt: text('prepared_at'),
  submittedAt: text('submitted_at'),
  evidencePath: text('evidence_path'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const applicationEvents = sqliteTable('application_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  applicationId: integer('application_id').references(() => applications.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
  payloadJson: text('payload_json'),
  occurredAt: text('occurred_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  idIdx: index('events_id_idx').on(t.id),
  occurredAtIdx: index('events_occurred_at_idx').on(t.occurredAt),
}));
