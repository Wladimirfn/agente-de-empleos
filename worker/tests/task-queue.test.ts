import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'ea-queue-')), 'queue.db');

const { db, runMigrations, closeDb } = await import('@employment-agent/database');
const { taskQueue } = await import('@employment-agent/database/schema');
const { claimNextTask, sweepStaleRunningTasks } = await import('../src/task-queue.js');

beforeAll(() => runMigrations());
beforeEach(() => db.delete(taskQueue));
afterAll(() => closeDb());

async function addTask(id: string, scheduledAt = '2026-01-01T00:00:00.000Z') {
  await db.insert(taskQueue).values({
    id,
    type: 'TEST',
    payloadJson: '{}',
    status: 'pending',
    scheduledAt,
  });
}

describe('claimNextTask', () => {
  it('changes exactly one due row to running', async () => {
    await addTask('first');
    await addTask('second');

    expect((await claimNextTask())?.id).toBe('first');
    const rows = await db.select().from(taskQueue);
    expect(rows.filter((row) => row.status === 'running').map((row) => row.id)).toEqual(['first']);
    expect(rows.filter((row) => row.status === 'pending').map((row) => row.id)).toEqual(['second']);
  });

  it('returns distinct tasks on successive claims without changing future tasks', async () => {
    await addTask('first');
    await addTask('second');
    await addTask('future', '2999-01-01T00:00:00.000Z');

    const claimed = [await claimNextTask(), await claimNextTask()];

    expect(claimed.map((task) => task?.id)).toEqual(['first', 'second']);
    const future = (await db.select().from(taskQueue)).find((row) => row.id === 'future');
    expect(future?.status).toBe('pending');
  });

  it('does not double-claim when claims run concurrently', async () => {
    await addTask('first');
    await addTask('second');

    const claimed = await Promise.all([claimNextTask(), claimNextTask()]);
    expect(new Set(claimed.map((task) => task?.id))).toEqual(new Set(['first', 'second']));
  });
});

describe('sweepStaleRunningTasks', () => {
  async function addRunning(id: string, startedAt: string, slug = 'jobs') {
    await db.insert(taskQueue).values({
      id,
      type: 'BROWSER_AGENT_SCAN',
      payloadJson: JSON.stringify({ skillSlug: slug, platformUrl: 'https://jobs.example.com', triggeredBy: 'x' }),
      status: 'running',
      attempts: 0,
      maxAttempts: 1,
      scheduledAt: startedAt,
      startedAt,
    });
  }

  it('kills running tasks older than the threshold and leaves fresh ones alone', async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const fresh = new Date().toISOString();
    await addRunning('stale-1', old);
    await addRunning('stale-2', old);
    await addRunning('fresh-1', fresh);

    const swept = await sweepStaleRunningTasks();
    expect(swept).toBe(2);

    const after = await db.select().from(taskQueue);
    expect(after.find((t) => t.id === 'stale-1')?.status).toBe('failed');
    expect(after.find((t) => t.id === 'stale-2')?.status).toBe('failed');
    expect(after.find((t) => t.id === 'fresh-1')?.status).toBe('running');
    expect(after.find((t) => t.id === 'stale-1')?.error).toContain('[auto-cleanup]');
  });

  it('respects a custom threshold so operators can tune the sweep', async () => {
    const fiveSecAgo = new Date(Date.now() - 5_000).toISOString();
    await addRunning('recent', fiveSecAgo);
    // A 1-second threshold should sweep the 5-second-old task.
    const swept = await sweepStaleRunningTasks({ thresholdMs: 1_000 });
    expect(swept).toBe(1);
    const after = await db.select().from(taskQueue);
    expect(after[0]?.status).toBe('failed');
  });

  it('scopes by skillSlug so per-platform callers do not sweep unrelated tasks', async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    await addRunning('jobs-1', old, 'jobs');
    await addRunning('other-1', old, 'other');
    const swept = await sweepStaleRunningTasks({ skillSlug: 'jobs' });
    expect(swept).toBe(1);
    const after = await db.select().from(taskQueue);
    expect(after.find((t) => t.id === 'jobs-1')?.status).toBe('failed');
    expect(after.find((t) => t.id === 'other-1')?.status).toBe('running');
  });
});
