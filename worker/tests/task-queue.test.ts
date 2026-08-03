import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'ea-queue-')), 'queue.db');

const { db, runMigrations, closeDb } = await import('@employment-agent/database');
const { taskQueue } = await import('@employment-agent/database/schema');
const { claimNextTask } = await import('../src/task-queue.js');

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
