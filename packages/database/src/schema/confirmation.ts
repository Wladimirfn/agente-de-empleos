import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { candidateProfiles } from './candidate.js';

export const agentConfirmations = sqliteTable('agent_confirmations', {
  id: text('id').primaryKey(),
  profileId: integer('profile_id').notNull().references(() => candidateProfiles.id, { onDelete: 'cascade' }),
  conversationId: text('conversation_id').notNull(),
  kind: text('kind').notNull(),
  payloadJson: text('payload_json').notNull().default('{}'),
  status: text('status', { enum: ['pending', 'accepted', 'rejected', 'expired'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text('expires_at').notNull(),
  resolvedAt: text('resolved_at'),
}, (t) => ({
  latestIdx: index('agent_confirmations_latest_idx').on(t.profileId, t.conversationId, t.kind, t.status, t.createdAt, t.id),
  onePendingIdx: uniqueIndex('agent_confirmations_one_pending_idx').on(t.profileId, t.conversationId, t.kind).where(sql`${t.status} = 'pending'`),
}));
