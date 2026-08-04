import { db } from '@employment-agent/database';
import { platformBlocks } from '@employment-agent/database/schema';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { ChallengeKind } from './challenge-detector.js';

const DEFAULT_BLOCK_TTL_MS = 30 * 60_000; // 30 minutes

export interface BlockInfo {
  slug: string;
  reason: ChallengeKind | 'transport' | 'unknown';
  marker: string | null;
  until: string;
}

export async function isPlatformBlocked(slug: string, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .select({ id: platformBlocks.id })
    .from(platformBlocks)
    .where(and(
      eq(platformBlocks.slug, slug),
      gt(platformBlocks.until, now.toISOString()),
    ))
    .limit(1);
  return rows.length > 0;
}

export async function getCurrentBlock(slug: string, now: Date = new Date()): Promise<BlockInfo | null> {
  const rows = await db
    .select({
      slug: platformBlocks.slug,
      reason: platformBlocks.reason,
      marker: platformBlocks.marker,
      until: platformBlocks.until,
    })
    .from(platformBlocks)
    .where(and(
      eq(platformBlocks.slug, slug),
      gt(platformBlocks.until, now.toISOString()),
    ))
    .orderBy(sql`${platformBlocks.createdAt} DESC`)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    slug: row.slug,
    reason: row.reason as BlockInfo['reason'],
    marker: row.marker,
    until: row.until,
  };
}

export async function markPlatformBlocked(
  slug: string,
  reason: ChallengeKind | 'transport' | 'unknown',
  marker: string | null,
  ttlMs: number = DEFAULT_BLOCK_TTL_MS,
  now: Date = new Date(),
): Promise<void> {
  await db.insert(platformBlocks).values({
    slug,
    reason,
    marker,
    until: new Date(now.getTime() + ttlMs).toISOString(),
  });
}

export async function clearPlatformBlock(slug: string): Promise<void> {
  await db.delete(platformBlocks).where(eq(platformBlocks.slug, slug));
}
