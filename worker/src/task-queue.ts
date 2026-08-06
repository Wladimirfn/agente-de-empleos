import { randomUUID } from 'node:crypto';
import { db, runWithLockRetry } from '@employment-agent/database';
import { taskQueue } from '@employment-agent/database/schema';
import { eq, and, sql } from 'drizzle-orm';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retrying';

export interface NewTask {
  type: string;
  payload: unknown;
  scheduledAt?: string;
  maxAttempts?: number;
}

export interface TaskRow {
  id: string;
  type: string;
  payloadJson: string;
  status: TaskStatus;
  attempts: number;
  maxAttempts: number;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export async function enqueueTask(task: NewTask): Promise<string> {
  const id = randomUUID();
  const scheduledAt = task.scheduledAt ?? new Date().toISOString();
  await db.insert(taskQueue).values({
    id,
    type: task.type,
    payloadJson: JSON.stringify(task.payload ?? {}),
    status: 'pending',
    attempts: 0,
    maxAttempts: task.maxAttempts ?? 3,
    scheduledAt,
  });
  return id;
}

/**
 * Atomically claim the next pending task for execution.
 * Uses UPDATE ... RETURNING for atomicity.
 */
export async function claimNextTask(): Promise<TaskRow | null> {
  const now = new Date().toISOString();
  const result = await db
    .update(taskQueue)
    .set({ status: 'running', startedAt: now })
    .where(and(
      eq(taskQueue.status, 'pending'),
      eq(taskQueue.id, sql`(
        SELECT ${taskQueue.id}
        FROM ${taskQueue}
        WHERE ${taskQueue.status} = 'pending'
          AND ${taskQueue.scheduledAt} <= ${now}
        ORDER BY ${taskQueue.scheduledAt}, ${taskQueue.id}
        LIMIT 1
      )`),
    ))
    .returning();
  return (result[0] as TaskRow | undefined) ?? null;
}

const MARK_RETRY_ATTEMPTS = 3;
const MARK_RETRY_BASE_MS = 50;

export async function markCompleted(id: string): Promise<void> {
  await runWithLockRetry(
    () => db
      .update(taskQueue)
      .set({ status: 'completed', completedAt: new Date().toISOString() })
      .where(eq(taskQueue.id, id)),
    { attempts: MARK_RETRY_ATTEMPTS, baseDelayMs: MARK_RETRY_BASE_MS, operation: `markCompleted(${id})` },
  );
}

export async function markFailed(id: string, error: string): Promise<void> {
  await runWithLockRetry(
    () => db
      .update(taskQueue)
      .set({ status: 'failed', completedAt: new Date().toISOString(), error })
      .where(eq(taskQueue.id, id)),
    { attempts: MARK_RETRY_ATTEMPTS, baseDelayMs: MARK_RETRY_BASE_MS, operation: `markFailed(${id})` },
  );
}

export async function markRetrying(id: string, error: string, nextAttemptDelayMs = 60_000): Promise<void> {
  const next = new Date(Date.now() + nextAttemptDelayMs).toISOString();
  await runWithLockRetry(
    () => db
      .update(taskQueue)
      .set({
        status: 'pending',
        attempts: sql`${taskQueue.attempts} + 1`,
        error,
        scheduledAt: next,
      })
      .where(eq(taskQueue.id, id)),
    { attempts: MARK_RETRY_ATTEMPTS, baseDelayMs: MARK_RETRY_BASE_MS, operation: `markRetrying(${id})` },
  );
}
