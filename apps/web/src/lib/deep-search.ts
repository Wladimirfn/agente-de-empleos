import { randomUUID } from 'node:crypto';
import { db } from '@employment-agent/database';
import { agentConfirmations, platforms, taskQueue } from '@employment-agent/database/schema';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { enqueuePlatformScan } from './platform-onboarding.js';

const KIND = 'deep_search';
const TTL_MS = 15 * 60_000;

export function isExplicitAffirmative(message: string): boolean {
  const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return new Set(['ok', 'si', 'dale', 'hazlo', 'confirmo', 'yes', 'go ahead']).has(normalized);
}

export async function proposeDeepSearch(profileId: number, conversationId: string, now = new Date()) {
  const conversation = conversationId.trim().slice(0, 100);
  const timestamp = now.toISOString();
  return db.transaction(async (tx) => {
    await tx.update(agentConfirmations).set({ status: 'expired', resolvedAt: timestamp }).where(and(eq(agentConfirmations.profileId, profileId), eq(agentConfirmations.conversationId, conversation), eq(agentConfirmations.kind, KIND), eq(agentConfirmations.status, 'pending'), lte(agentConfirmations.expiresAt, timestamp)));
    const pending = (await tx.select().from(agentConfirmations).where(and(eq(agentConfirmations.profileId, profileId), eq(agentConfirmations.conversationId, conversation), eq(agentConfirmations.kind, KIND), eq(agentConfirmations.status, 'pending'))).orderBy(desc(agentConfirmations.createdAt), desc(agentConfirmations.id)).limit(1))[0];
    if (pending) return { id: pending.id, status: 'pending' as const, expiresAt: pending.expiresAt, created: false };
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
    const inserted = await tx.insert(agentConfirmations).values({ id, profileId, conversationId: conversation, kind: KIND, payloadJson: '{}', status: 'pending', createdAt: timestamp, expiresAt }).onConflictDoNothing().returning({ id: agentConfirmations.id });
    if (inserted[0]) return { id, status: 'pending' as const, expiresAt, created: true };
    const raced = (await tx.select().from(agentConfirmations).where(and(eq(agentConfirmations.profileId, profileId), eq(agentConfirmations.conversationId, conversation), eq(agentConfirmations.kind, KIND), eq(agentConfirmations.status, 'pending'))).orderBy(desc(agentConfirmations.createdAt), desc(agentConfirmations.id)).limit(1))[0]!;
    return { id: raced.id, status: 'pending' as const, expiresAt: raced.expiresAt, created: false };
  });
}

export async function confirmDeepSearch(profileId: number, conversationId: string, currentMessage: string, now = new Date(), turnStartedAt = now) {
  if (!isExplicitAffirmative(currentMessage)) return { status: 'denied' as const, reason: 'affirmative_required' as const };
  const conversation = conversationId.trim().slice(0, 100);
  const timestamp = now.toISOString();
  return db.transaction(async (tx) => {
    await tx.update(agentConfirmations).set({ status: 'expired', resolvedAt: timestamp }).where(and(eq(agentConfirmations.profileId, profileId), eq(agentConfirmations.conversationId, conversation), eq(agentConfirmations.kind, KIND), eq(agentConfirmations.status, 'pending'), lte(agentConfirmations.expiresAt, timestamp)));
    const confirmation = (await tx.select().from(agentConfirmations).where(and(eq(agentConfirmations.profileId, profileId), eq(agentConfirmations.conversationId, conversation), eq(agentConfirmations.kind, KIND))).orderBy(desc(agentConfirmations.createdAt), desc(agentConfirmations.id)).limit(1))[0];
    if (!confirmation || confirmation.createdAt >= turnStartedAt.toISOString() || confirmation.status === 'expired' || confirmation.status === 'rejected') return { status: 'denied' as const, reason: 'no_pending_confirmation' as const };
    if (confirmation.status === 'accepted') { const outcomes = (JSON.parse(confirmation.payloadJson) as { platforms?: Array<{ outcome: string }> }).platforms ?? []; return { status: 'accepted' as const, runId: confirmation.id, replay: true, queued: outcomes.filter((p) => p.outcome === 'queued').length, skipped: outcomes.filter((p) => p.outcome !== 'queued').length }; }
    const accepted = await tx.update(agentConfirmations).set({ status: 'accepted', resolvedAt: timestamp }).where(and(eq(agentConfirmations.id, confirmation.id), eq(agentConfirmations.status, 'pending'))).returning({ id: agentConfirmations.id });
    if (accepted.length === 0) return { status: 'accepted' as const, runId: confirmation.id, replay: true, queued: 0, skipped: 0 };
    const active = await tx.select({ slug: platforms.slug, url: platforms.baseUrl }).from(platforms).where(eq(platforms.status, 'active')).orderBy(platforms.slug, platforms.id).limit(50);
    const summaries: Array<{ platform: string; outcome: string }> = [];
    for (const platform of active) {
      const slug = platform.slug.replace(/[^a-z0-9-]/gi, '').slice(0, 80);
      if (!platform.url) { summaries.push({ platform: slug, outcome: 'skipped_missing_url' }); continue; }
      const taskId = await enqueuePlatformScan({ slug: platform.slug, url: platform.url }, 'deep-search', 'BROWSER_AGENT_SCAN', { deepSearchRunId: confirmation.id, executor: tx });
      summaries.push({ platform: slug, outcome: taskId ? 'queued' : 'skipped_active' });
    }
    await tx.update(agentConfirmations).set({ payloadJson: JSON.stringify({ platforms: summaries }) }).where(eq(agentConfirmations.id, confirmation.id));
    return { status: 'accepted' as const, runId: confirmation.id, replay: false, queued: summaries.filter((p) => p.outcome === 'queued').length, skipped: summaries.filter((p) => p.outcome !== 'queued').length };
  });
}

export async function deepSearchStatus(profileId: number, conversationId: string, limit = 20, now = new Date()) {
  const capped = Math.max(1, Math.min(50, Math.floor(limit)));
  const conversation = conversationId.trim().slice(0, 100);
  await db.update(agentConfirmations).set({ status: 'expired', resolvedAt: now.toISOString() }).where(and(eq(agentConfirmations.profileId, profileId), eq(agentConfirmations.conversationId, conversation), eq(agentConfirmations.kind, KIND), eq(agentConfirmations.status, 'pending'), lte(agentConfirmations.expiresAt, now.toISOString())));
  const runs = await db.select().from(agentConfirmations).where(and(eq(agentConfirmations.profileId, profileId), eq(agentConfirmations.conversationId, conversation), eq(agentConfirmations.kind, KIND), inArray(agentConfirmations.status, ['accepted', 'pending', 'expired']))).orderBy(desc(agentConfirmations.createdAt), desc(agentConfirmations.id)).limit(capped);
  if (runs.length === 0) return [];
  const ids = runs.map((run) => run.id);
  const tasks = await db.select({ runId: sql<string>`json_extract(${taskQueue.payloadJson}, '$.deepSearchRunId')`, platform: sql<string>`json_extract(${taskQueue.payloadJson}, '$.skillSlug')`, status: taskQueue.status }).from(taskQueue)
    .where(and(eq(taskQueue.type, 'BROWSER_AGENT_SCAN'), inArray(sql<string>`json_extract(${taskQueue.payloadJson}, '$.deepSearchRunId')`, ids))).orderBy(desc(taskQueue.scheduledAt), desc(taskQueue.id)).limit(50);
  return runs.map((run) => {
    const own = tasks.filter((task) => task.runId === run.id);
    const counts = { queued: own.filter((t) => t.status === 'pending' || t.status === 'retrying').length, running: own.filter((t) => t.status === 'running').length, completed: own.filter((t) => t.status === 'completed').length, failed: own.filter((t) => t.status === 'failed').length };
    let platformsSummary: Array<{ platform: string; outcome: string }> = [];
    try { platformsSummary = (JSON.parse(run.payloadJson) as { platforms?: typeof platformsSummary }).platforms ?? []; } catch { /* stored payload is treated as empty */ }
    return { runId: run.id, status: run.status, createdAt: run.createdAt, resolvedAt: run.resolvedAt, counts, platforms: platformsSummary.slice(0, 50).map((platform) => ({ ...platform, taskStatus: own.find((task) => task.platform === platform.platform)?.status ?? null })) };
  });
}
