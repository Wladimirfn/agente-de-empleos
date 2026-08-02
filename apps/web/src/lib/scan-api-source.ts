import { db } from '@employment-agent/database';
import {
  candidateProfiles,
  candidateTargetRoles,
  jobs as jobsTable,
  platforms,
} from '@employment-agent/database/schema';
import { and, eq } from 'drizzle-orm';

/** Sources that can be scanned directly from the web server (pure HTTP, no browser). */
export const API_SOURCES = new Set(['getonboard', 'arbeitnow']);

export interface ApiSourceScanResult {
  jobsFound: number;
  jobsNew: number;
}

/**
 * Scan an API-based source (GetOnboard, Arbeitnow) directly from the web
 * server: fetch offers for each active target role and upsert them into the
 * jobs table. Throws on network/parse failure.
 */
export async function scanApiSource(slug: string): Promise<ApiSourceScanResult> {
  const platform = await db.select().from(platforms).where(eq(platforms.slug, slug)).limit(1);
  if (platform.length === 0) throw new Error(`Platform "${slug}" not found`);
  const platformId = platform[0]!.id;

  const { searchAllSources } = await import('./job-sources/index.js');

  // Build queries from the profile's active target roles, or fall back
  // to a broad term so we always get results.
  const profileRows = await db.select().from(candidateProfiles).limit(1);
  let queries: string[] = ['developer']; // fallback
  if (profileRows[0]) {
    const roles = await db
      .select({ roleTitle: candidateTargetRoles.roleTitle })
      .from(candidateTargetRoles)
      .where(eq(candidateTargetRoles.profileId, profileRows[0].id));
    if (roles.length > 0) queries = roles.map((r) => r.roleTitle);
  }

  const results: Array<{ externalId: string; platformSlug: string; title: string; company?: string; location?: string; url?: string; description?: string; rawPayload?: unknown }> = [];
  for (const q of queries) {
    const r = await searchAllSources(q, undefined, undefined);
    results.push(...r.filter((j) => j.platformSlug === slug));
  }

  // Dedupe by externalId
  const seen = new Set<string>();
  const sourceResults = results.filter((j) => {
    if (seen.has(j.externalId)) return false;
    seen.add(j.externalId);
    return true;
  });

  let newCount = 0;
  for (const result of sourceResults) {
    const existing = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(and(eq(jobsTable.platformId, platformId), eq(jobsTable.externalId, result.externalId)))
      .limit(1);
    if (existing[0]) {
      await db
        .update(jobsTable)
        .set({ lastSeenAt: new Date().toISOString() })
        .where(eq(jobsTable.id, existing[0].id));
    } else {
      await db.insert(jobsTable).values({
        platformId,
        externalId: result.externalId,
        title: result.title,
        company: result.company ?? null,
        location: result.location ?? null,
        url: result.url ?? null,
        description: result.description ?? null,
        rawPayload: result.rawPayload ? JSON.stringify(result.rawPayload) : null,
      });
      newCount++;
    }
  }

  return { jobsFound: sourceResults.length, jobsNew: newCount };
}
