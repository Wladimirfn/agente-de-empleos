import { randomUUID } from 'node:crypto';
import { db } from '@employment-agent/database';
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

export async function markCompleted(id: string): Promise<void> {
  await db
    .update(taskQueue)
    .set({ status: 'completed', completedAt: new Date().toISOString() })
    .where(eq(taskQueue.id, id));
}

export async function markFailed(id: string, error: string): Promise<void> {
  await db
    .update(taskQueue)
    .set({ status: 'failed', completedAt: new Date().toISOString(), error })
    .where(eq(taskQueue.id, id));
}

export async function markRetrying(id: string, error: string, nextAttemptDelayMs = 60_000): Promise<void> {
  const next = new Date(Date.now() + nextAttemptDelayMs).toISOString();
  await db
    .update(taskQueue)
    .set({
      status: 'pending',
      attempts: sql`${taskQueue.attempts} + 1`,
      error,
      scheduledAt: next,
    })
    .where(eq(taskQueue.id, id));
}

/**
 * Tasks left in 'running' after a worker restart (or crash) cannot still
 * be alive — there is no worker holding their reference. Mark them failed
 * so the next enqueue isn't blocked. Optional skillSlug scope so the
 * worker boot sweep can be unrestricted while per-platform callers
 * (enqueuePlatformScan) scope to their own slug.
 *
 * Returns the number of rows swept.
 */
export async function sweepStaleRunningTasks(opts: { skillSlug?: string; thresholdMs?: number } = {}): Promise<number> {
  const thresholdMs = opts.thresholdMs ?? 10 * 60 * 1000;
  const cutoff = new Date(Date.now() - thresholdMs).toISOString();
  const slugFilter = opts.skillSlug ? sql`AND json_extract(${taskQueue.payloadJson}, '$.skillSlug') = ${opts.skillSlug}` : sql``;
  const rows = await db
    .update(taskQueue)
    .set({
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: sql`COALESCE(${taskQueue.error}, '') || ${'[auto-cleanup] killed stale running task (no heartbeat within ' + (thresholdMs / 60000) + 'min)'}`,
    })
    .where(sql`${taskQueue.status} = 'running'
      AND (${taskQueue.startedAt} IS NULL OR ${taskQueue.startedAt} < ${cutoff})
      ${slugFilter}`)
    .returning({ id: taskQueue.id });
  return rows.length;
}
