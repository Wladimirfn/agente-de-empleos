import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const taskQueue = sqliteTable('task_queue', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payloadJson: text('payload_json').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed', 'retrying'],
  }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  scheduledAt: text('scheduled_at').notNull(),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  error: text('error'),
}, (t) => ({
  statusScheduledIdx: index('task_queue_status_scheduled_idx').on(t.status, t.scheduledAt),
}));
