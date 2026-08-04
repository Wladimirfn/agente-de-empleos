import { randomUUID } from 'node:crypto';
import { db } from '@employment-agent/database';
import { sessionCaptures } from '@employment-agent/database/schema';
import { and, eq, lte } from 'drizzle-orm';

export type SessionStatus = 'pending' | 'ready' | 'completed' | 'expired' | 'failed' | 'cancelled';

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
  const rawStatus = row.status as SessionStatus;
  // Derive 'expired' if the deadline has passed but the worker hasn't
  // updated the row yet. This lets the UI stop polling without waiting
  // for the worker to clean up. The DB row stays 'pending' until the
  // worker's next tick or its own deadline fires setSessionExpired.
  const isPastDeadline = Date.parse(row.expiresAt) < Date.now();
  const status: SessionStatus =
    isPastDeadline && (rawStatus === 'pending' || rawStatus === 'ready')
      ? 'expired'
      : rawStatus;
  return {
    id: row.id,
    slug: row.slug,
    status,
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
 * Mark the session as expired (worker hit its 5-min deadline before the
 * user clicked "Listo"). The caller is responsible for not overwriting
 * a 'cancelled' status — see the worker poll loop, which re-reads the
 * row before calling this.
 */
export async function setSessionExpired(id: string): Promise<void> {
  await db.update(sessionCaptures)
    .set({ status: 'expired' })
    .where(eq(sessionCaptures.id, id));
}

/**
 * Mark the session as cancelled (user clicked "Cancelar" in the UI).
 * The worker's poll loop checks for this and exits cleanly.
 */
export async function setSessionCancelled(id: string): Promise<void> {
  await db.update(sessionCaptures)
    .set({ status: 'cancelled' })
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
