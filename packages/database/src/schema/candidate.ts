import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const candidateProfiles = sqliteTable('candidate_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fullName: text('full_name'),
  email: text('email'),
  phone: text('phone'),
  location: text('location'),
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
