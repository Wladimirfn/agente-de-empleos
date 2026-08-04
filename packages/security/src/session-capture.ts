import { randomUUID } from 'node:crypto';
import { db } from '@employment-agent/database';
import { sessionCaptures } from '@employment-agent/database/schema';
import { and, eq, lte } from 'drizzle-orm';

export type SessionStatus = 'pending' | 'ready' | 'completed' | 'expired' | 'failed';

export const SESSION_TTL_MS = 5 * 60_000; // 5 minutes for the user to log in

export interface SessionCapture {
  id: string;
  slug: string;
  status: SessionStatus;
  readyAt: string | null;
  userCompletedAt: string | null;
  error: string | null;
  createdAt: string;
  expiresAt: string;
}

export async function createSessionCapture(slug: string): Promise<SessionCapture> {
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await db.insert(sessionCaptures).values({
    id,
    slug,
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt,
  });
  return {
    id,
    slug,
    status: 'pending',
    readyAt: null,
    userCompletedAt: null,
    error: null,
    createdAt: now.toISOString(),
    expiresAt,
  };
}

export async function getSessionCapture(id: string): Promise<SessionCapture | null> {
  const rows = await db.select().from(sessionCaptures).where(eq(sessionCaptures.id, id));
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    status: row.status as SessionStatus,
    readyAt: row.readyAt,
    userCompletedAt: row.userCompletedAt,
    error: row.error,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export async function setSessionReady(id: string): Promise<void> {
  await db.update(sessionCaptures)
    .set({ status: 'ready', readyAt: new Date().toISOString() })
    .where(eq(sessionCaptures.id, id));
}

export async function setSessionCompleted(id: string): Promise<void> {
  await db.update(sessionCaptures)
    .set({ status: 'completed' })
    .where(eq(sessionCaptures.id, id));
}

export async function setSessionUserCompleted(id: string): Promise<void> {
  await db.update(sessionCaptures)
    .set({ userCompletedAt: new Date().toISOString() })
    .where(eq(sessionCaptures.id, id));
}

export async function setSessionFailed(id: string, error: string): Promise<void> {
  await db.update(sessionCaptures)
    .set({ status: 'failed', error })
    .where(eq(sessionCaptures.id, id));
}

/**
 * Expire sessions whose TTL has passed. The worker calls this on startup
 * to clean up rows for users who abandoned the modal.
 */
export async function expireStaleSessions(now: Date = new Date()): Promise<number> {
  const result = await db.update(sessionCaptures)
    .set({ status: 'expired' })
    .where(and(
      lte(sessionCaptures.expiresAt, now.toISOString()),
    ))
    .returning({ id: sessionCaptures.id });
  return result.length;
}
