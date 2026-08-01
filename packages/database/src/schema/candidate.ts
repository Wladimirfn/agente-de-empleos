import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const candidateProfiles = sqliteTable('candidate_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fullName: text('full_name'),
  email: text('email'),
  phone: text('phone'),
  location: text('location'),
  searchScope: text('search_scope', { enum: ['local', 'national', 'international', 'remote'] }).default('local'),
  summary: text('summary'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const candidateExperiences = sqliteTable('candidate_experiences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  company: text('company').notNull(),
  role: text('role').notNull(),
  startDate: text('start_date'),
  endDate: text('end_date'),
  description: text('description'),
  source: text('source', { enum: ['form', 'cv-parsed', 'cv-corrected'] }).notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  profileIdx: index('experiences_profile_idx').on(t.profileId),
}));

export const candidateSkills = sqliteTable('candidate_skills', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  level: text('level'),
  years: real('years'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  profileIdx: index('skills_profile_idx').on(t.profileId),
}));

/**
 * Target roles the candidate is actively pursuing. Used by the job search
 * to filter and rank offers, and by the profile UI to show what the user
 * is aiming for.
 *
 * `priority` is 1-based: 1 = primary target, 2 = secondary, etc.
 * `isActive` lets the user pause a role without deleting it.
 */
export const candidateTargetRoles = sqliteTable('candidate_target_roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  roleTitle: text('role_title').notNull(),
  priority: integer('priority').notNull().default(1),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  profileIdx: index('target_roles_profile_idx').on(t.profileId, t.priority),
}));

/**
 * AI-generated proposals to improve the candidate profile. Each proposal
 * is a set of structured changes the user can accept or reject. Nothing
 * is applied until the user explicitly confirms.
 */
export const profileProposals = sqliteTable('profile_proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  kind: text('kind', {
    enum: ['add_skill', 'update_summary', 'add_experience', 'add_target_role', 'update_location', 'update_profile'],
  }).notNull(),
  description: text('description').notNull(),
  payloadJson: text('payload_json').notNull(),
  status: text('status', { enum: ['pending', 'accepted', 'rejected'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text('resolved_at'),
}, (t) => ({
  profileIdx: index('proposals_profile_idx').on(t.profileId, t.status),
}));
