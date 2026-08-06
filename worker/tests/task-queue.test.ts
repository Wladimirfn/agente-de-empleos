import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'ea-queue-')), 'queue.db');

const { db, runMigrations, closeDb, runWithLockRetry, isTransientLockError } = await import('@employment-agent/database');
const { taskQueue } = await import('@employment-agent/database/schema');
const { claimNextTask, markFailed, markCompleted, markRetrying } = await import('../src/task-queue.js');

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

describe('isTransientLockError', () => {
  it('detects SQLITE_BUSY by code', () => {
    const err = Object.assign(new Error('locked'), { code: 'SQLITE_BUSY' });
    expect(isTransientLockError(err)).toBe(true);
  });
  it('detects SQLITE_BUSY_SNAPSHOT by code', () => {
    const err = Object.assign(new Error('busy snapshot'), { code: 'SQLITE_BUSY_SNAPSHOT' });
    expect(isTransientLockError(err)).toBe(true);
  });
  it('detects by message when code is missing', () => {
    expect(isTransientLockError(new Error('database is locked'))).toBe(true);
  });
  it('does not flag non-transient errors', () => {
    expect(isTransientLockError(new Error('schema corruption'))).toBe(false);
    expect(isTransientLockError(null)).toBe(false);
    expect(isTransientLockError(undefined)).toBe(false);
    expect(isTransientLockError('string error')).toBe(false);
  });
});

describe('runWithLockRetry', () => {
  it('returns the function result on first success', async () => {
    const fn = async () => 42;
    const result = await runWithLockRetry(fn, { attempts: 3, baseDelayMs: 1, operation: 'test' });
    expect(result).toBe(42);
  });
  it('retries on transient SQLITE_BUSY until success', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 3) {
        const err = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
        throw err;
      }
      return 'ok';
    };
    const result = await runWithLockRetry(fn, { attempts: 5, baseDelayMs: 1, operation: 'test' });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });
  it('propagates after the retry budget is exhausted', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      const err = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
      throw err;
    };
    await expect(
      runWithLockRetry(fn, { attempts: 3, baseDelayMs: 1, operation: 'test' }),
    ).rejects.toThrow(/database is locked/);
    expect(calls).toBe(3);
  });
  it('does not retry on non-transient errors', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      throw new Error('schema corruption');
    };
    await expect(
      runWithLockRetry(fn, { attempts: 5, baseDelayMs: 1, operation: 'test' }),
    ).rejects.toThrow(/schema corruption/);
    expect(calls).toBe(1);
  });
});

describe('markFailed / markCompleted / markRetrying (integration)', () => {
  it('markFailed writes a real failed row through the retry wrapper', async () => {
    await addTask('a');
    await claimNextTask();
    await markFailed('a', 'synthetic error');
    const row = (await db.select().from(taskQueue)).find((r) => r.id === 'a');
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('synthetic error');
    expect(row?.completedAt).not.toBeNull();
  });
  it('markCompleted writes a real completed row through the retry wrapper', async () => {
    await addTask('b');
    await claimNextTask();
    await markCompleted('b');
    const row = (await db.select().from(taskQueue)).find((r) => r.id === 'b');
    expect(row?.status).toBe('completed');
    expect(row?.completedAt).not.toBeNull();
  });
  it('markRetrying flips the row back to pending and bumps attempts', async () => {
    await addTask('c');
    await claimNextTask();
    await markRetrying('c', 'transient');
    const row = (await db.select().from(taskQueue)).find((r) => r.id === 'c');
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(row?.error).toBe('transient');
  });
});
