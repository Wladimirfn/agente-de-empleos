import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'ea-deep-search-'));
process.env.DATABASE_PATH = join(root, 'test.db');
const { db, closeDb, runMigrations } = await import('@employment-agent/database');
const { agentConfirmations, candidateProfiles, platforms, taskQueue } = await import('@employment-agent/database/schema');
const { confirmDeepSearch, deepSearchStatus, isExplicitAffirmative, proposeDeepSearch } = await import('./deep-search.js');
const { asc, eq, sql } = await import('drizzle-orm');
let profileId: number;
let otherProfileId: number;
const start = new Date('2026-08-03T12:00:00.000Z');

beforeAll(() => runMigrations());
beforeEach(async () => {
  await db.delete(agentConfirmations); await db.delete(taskQueue); await db.delete(platforms); await db.delete(candidateProfiles);
  const profiles = await db.insert(candidateProfiles).values([{ fullName: 'Primary' }, { fullName: 'Other' }]).returning({ id: candidateProfiles.id });
  profileId = profiles[0]!.id; otherProfileId = profiles[1]!.id;
});
afterAll(() => closeDb());

it.each(['ok', ' sí! ', 'SI', 'dale.', 'hazlo', 'confirmo', 'yes!', 'go   ahead'])('recognizes explicit affirmation %s', (message) => {
  expect(isExplicitAffirmative(message)).toBe(true);
});
it.each(['maybe', 'no', 'ok, pero no', 'please'])('rejects ambiguous affirmation %s', (message) => {
  expect(isExplicitAffirmative(message)).toBe(false);
});

describe('deep-search confirmation persistence', () => {
  it('deduplicates pending proposals and deterministically expires stale ones', async () => {
    const first = await proposeDeepSearch(profileId, 'chat-a', start);
    const duplicate = await proposeDeepSearch(profileId, 'chat-a', new Date(start.getTime() + 1_000));
    const replacement = await proposeDeepSearch(profileId, 'chat-a', new Date(start.getTime() + 16 * 60_000));
    expect(duplicate).toMatchObject({ id: first.id, created: false });
    expect(replacement.id).not.toBe(first.id);
    expect((await db.select().from(agentConfirmations).where(eq(agentConfirmations.id, first.id)))[0]?.status).toBe('expired');
  });

  it('requires the current affirmative and the same profile/conversation', async () => {
    const pending = await proposeDeepSearch(profileId, 'chat-a', start);
    await expect(confirmDeepSearch(profileId, 'chat-a', 'maybe', start)).resolves.toMatchObject({ status: 'denied', reason: 'affirmative_required' });
    await expect(confirmDeepSearch(profileId, 'chat-b', 'sí', start)).resolves.toMatchObject({ status: 'denied' });
    await expect(confirmDeepSearch(otherProfileId, 'chat-a', 'yes', start)).resolves.toMatchObject({ status: 'denied' });
    expect((await db.select().from(agentConfirmations).where(eq(agentConfirmations.id, pending.id)))[0]?.status).toBe('pending');
  });

  it('denies proposal and confirmation within the same user turn', async () => {
    await proposeDeepSearch(profileId, 'chat-a', start);
    await expect(confirmDeepSearch(profileId, 'chat-a', 'yes', new Date(start.getTime() + 1), start)).resolves.toMatchObject({ status: 'denied' });
  });

  it('rejects an expired confirmation', async () => {
    const pending = await proposeDeepSearch(profileId, 'chat-a', start);
    await expect(confirmDeepSearch(profileId, 'chat-a', 'dale', new Date(start.getTime() + 16 * 60_000))).resolves.toMatchObject({ status: 'denied', reason: 'no_pending_confirmation' });
    expect((await db.select().from(agentConfirmations).where(eq(agentConfirmations.id, pending.id)))[0]?.status).toBe('expired');
  });

  it('atomically schedules active platforms once and makes accepted replay idempotent', async () => {
    await db.insert(platforms).values([
      { slug: 'alpha', displayName: 'Alpha', baseUrl: 'https://alpha.example', status: 'active' },
      { slug: 'beta', displayName: 'Beta', baseUrl: 'https://beta.example', status: 'active' },
      { slug: 'no-url', displayName: 'No URL', status: 'active' },
      { slug: 'paused', displayName: 'Paused', baseUrl: 'https://paused.example', status: 'paused' },
      { slug: 'broken', displayName: 'Broken', baseUrl: 'https://broken.example', status: 'broken' },
    ]);
    await db.insert(taskQueue).values({ id: 'existing', type: 'SCAN_PLATFORM', payloadJson: JSON.stringify({ skillSlug: 'beta' }), status: 'running', attempts: 0, maxAttempts: 1, scheduledAt: start.toISOString() });
    const pending = await proposeDeepSearch(profileId, 'chat-a', start);
    const nextTurn = new Date(start.getTime() + 1_000);
    const accepted = await confirmDeepSearch(profileId, 'chat-a', 'sí!', nextTurn);
    expect(accepted).toMatchObject({ status: 'accepted', runId: pending.id, replay: false, queued: 1, skipped: 2 });
    const tasks = await db.select().from(taskQueue).orderBy(asc(taskQueue.id));
    expect(tasks).toHaveLength(2);
    const child = tasks.find((task) => task.id !== 'existing')!;
    expect(JSON.parse(child.payloadJson)).toMatchObject({ skillSlug: 'alpha', platformUrl: 'https://alpha.example', deepSearchRunId: pending.id });
    await expect(confirmDeepSearch(profileId, 'chat-a', 'go ahead', new Date(nextTurn.getTime() + 1_000))).resolves.toMatchObject({ status: 'accepted', runId: pending.id, replay: true, queued: 1, skipped: 2 });
    expect(await db.select().from(taskQueue)).toHaveLength(2);
  });

  it('rolls back acceptance and child tasks when scheduling fails', async () => {
    await db.insert(platforms).values([{ slug: 'alpha', displayName: 'Alpha', baseUrl: 'https://alpha.example', status: 'active' }, { slug: 'z-bad', displayName: 'Bad', baseUrl: 'not-a-url', status: 'active' }]);
    const pending = await proposeDeepSearch(profileId, 'chat-a', start);
    await expect(confirmDeepSearch(profileId, 'chat-a', 'yes', new Date(start.getTime() + 1_000))).rejects.toThrow();
    expect((await db.select().from(agentConfirmations).where(eq(agentConfirmations.id, pending.id)))[0]?.status).toBe('pending');
    expect(await db.select().from(taskQueue)).toHaveLength(0);
  });

  it('aggregates correlated task status deterministically and cascades with profile deletion', async () => {
    const rows = [{ id: 'a-run', createdAt: start.toISOString() }, { id: 'z-run', createdAt: start.toISOString() }];
    await db.insert(agentConfirmations).values(rows.map((row) => ({ ...row, profileId, conversationId: 'chat-a', kind: 'deep_search', payloadJson: JSON.stringify({ platforms: [{ platform: 'alpha', outcome: 'queued' }] }), status: 'accepted' as const, expiresAt: new Date(start.getTime() + 900_000).toISOString(), resolvedAt: start.toISOString() })));
    await db.insert(taskQueue).values(['pending', 'running', 'completed', 'failed'].map((status, index) => ({ id: `task-${index}`, type: 'BROWSER_AGENT_SCAN', payloadJson: JSON.stringify({ skillSlug: index ? `p-${index}` : 'alpha', deepSearchRunId: 'z-run' }), status: status as 'pending', attempts: 0, maxAttempts: 1, scheduledAt: start.toISOString() })));
    const status = await deepSearchStatus(profileId, 'chat-a');
    expect(status.map((run) => run.runId)).toEqual(['z-run', 'a-run']);
    expect(status[0]).toMatchObject({ counts: { queued: 1, running: 1, completed: 1, failed: 1 }, platforms: [{ platform: 'alpha', outcome: 'queued', taskStatus: 'pending' }] });
    await db.delete(candidateProfiles).where(eq(candidateProfiles.id, profileId));
    expect(await db.select().from(agentConfirmations).where(eq(agentConfirmations.profileId, profileId))).toHaveLength(0);
  });

  it('migration exposes the dedicated confirmation columns and indexes', async () => {
    const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(agent_confirmations)`);
    const indexes = await db.all<{ name: string }>(sql`PRAGMA index_list(agent_confirmations)`);
    expect(columns.map((row) => row.name)).toEqual(expect.arrayContaining(['id', 'profile_id', 'conversation_id', 'kind', 'payload_json', 'status', 'created_at', 'expires_at', 'resolved_at']));
    expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining(['agent_confirmations_latest_idx', 'agent_confirmations_one_pending_idx']));
  });
});
