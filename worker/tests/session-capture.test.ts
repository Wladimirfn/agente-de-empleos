import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'ea-session-')), 'session.db');

const { db, runMigrations, closeDb } = await import('@employment-agent/database');
const { sessionCaptures } = await import('@employment-agent/database/schema');
const {
  createSessionCapture,
  getSessionCapture,
  setSessionReady,
  setSessionUserCompleted,
  setSessionCompleted,
  setSessionFailed,
  expireStaleSessions,
  SESSION_TTL_MS,
} = await import('@employment-agent/security');

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => { await db.delete(sessionCaptures); });
afterAll(async () => { await closeDb(); });

describe('session capture DB ops', () => {
  it('creates a session in pending state with a future expiry', async () => {
    const session = await createSessionCapture('indeed');
    expect(session.status).toBe('pending');
    expect(session.slug).toBe('indeed');
    const expiresAt = Date.parse(session.expiresAt);
    const now = Date.now();
    expect(expiresAt - now).toBeGreaterThan(SESSION_TTL_MS - 1000);
    expect(expiresAt - now).toBeLessThan(SESSION_TTL_MS + 1000);
  });

  it('flips to ready when the worker opens the browser', async () => {
    const session = await createSessionCapture('labrum');
    await setSessionReady(session.id);
    const reloaded = await getSessionCapture(session.id);
    expect(reloaded?.status).toBe('ready');
    expect(reloaded?.readyAt).not.toBeNull();
  });

  it('records user_completed_at when the user clicks Listo', async () => {
    const session = await createSessionCapture('indeed');
    await setSessionReady(session.id);
    await setSessionUserCompleted(session.id);
    const reloaded = await getSessionCapture(session.id);
    expect(reloaded?.userCompletedAt).not.toBeNull();
    expect(reloaded?.status).toBe('ready'); // status is set by the worker, not by the user click
  });

  it('marks completed after the worker captures the storage state', async () => {
    const session = await createSessionCapture('indeed');
    await setSessionReady(session.id);
    await setSessionUserCompleted(session.id);
    await setSessionCompleted(session.id);
    const reloaded = await getSessionCapture(session.id);
    expect(reloaded?.status).toBe('completed');
  });

  it('records failure with a diagnostic message', async () => {
    const session = await createSessionCapture('indeed');
    await setSessionFailed(session.id, 'Browser launch failed');
    const reloaded = await getSessionCapture(session.id);
    expect(reloaded?.status).toBe('failed');
    expect(reloaded?.error).toBe('Browser launch failed');
  });

  it('expires stale sessions whose TTL has passed', async () => {
    const session = await createSessionCapture('indeed');
    // Force expiry by writing a past timestamp directly.
    const past = new Date(Date.now() - 1000).toISOString();
    await db.update(sessionCaptures)
      .set({ expiresAt: past })
      .where((await import('drizzle-orm')).eq(sessionCaptures.id, session.id));
    const expired = await expireStaleSessions();
    expect(expired).toBe(1);
    const reloaded = await getSessionCapture(session.id);
    expect(reloaded?.status).toBe('expired');
  });

  it('returns null for unknown session ids', async () => {
    expect(await getSessionCapture('does-not-exist')).toBeNull();
  });
});
