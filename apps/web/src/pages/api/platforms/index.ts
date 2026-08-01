import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { jobs, platforms, skillHealthchecks, skillFailures, jobMatches } from '@employment-agent/database/schema';
import { count, desc, eq, sql } from 'drizzle-orm';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const GET: APIRoute = async () => {
  const allPlatforms = await db.select().from(platforms).orderBy(platforms.displayName);

  const result = await Promise.all(
    allPlatforms.map(async (p) => {
      // Job count per platform
      const jobCountRows = await db
        .select({ total: count() })
        .from(jobs)
        .where(eq(jobs.platformId, p.id));
      const jobsFound = jobCountRows[0]?.total ?? 0;

      // Match count per platform
      const matchCountRows = await db
        .select({ total: count() })
        .from(jobMatches)
        .innerJoin(jobs, eq(jobMatches.jobId, jobs.id))
        .where(eq(jobs.platformId, p.id));
      const matchesFound = matchCountRows[0]?.total ?? 0;

      // Last scan = most recent last_seen_at for this platform
      const lastScanRows = await db
        .select({ lastScan: jobs.lastSeenAt })
        .from(jobs)
        .where(eq(jobs.platformId, p.id))
        .orderBy(desc(jobs.lastSeenAt))
        .limit(1);
      const lastScanAt = lastScanRows[0]?.lastScan ?? null;

      // Latest healthcheck for this platform's skill
      const healthRows = await db
        .select()
        .from(skillHealthchecks)
        .where(eq(skillHealthchecks.skillSlug, p.slug))
        .orderBy(desc(skillHealthchecks.checkedAt))
        .limit(1);
      const health = healthRows[0] ?? null;

      // Unrepaired failures
      const failureRows = await db
        .select({ total: count() })
        .from(skillFailures)
        .where(eq(skillFailures.skillSlug, p.slug));
      const totalFailures = failureRows[0]?.total ?? 0;

      const unrepairedRows = await db
        .select({ total: count() })
        .from(skillFailures)
        .where(
          sql`${skillFailures.skillSlug} = ${p.slug} AND ${skillFailures.repairedAt} IS NULL`,
        );
      const unrepairedFailures = unrepairedRows[0]?.total ?? 0;

      return {
        id: p.id,
        slug: p.slug,
        displayName: p.displayName,
        baseUrl: p.baseUrl,
        status: p.status,
        lastScanAt,
        jobsFound,
        matchesFound,
        healthStatus: health?.status ?? 'unknown',
        healthCheckedAt: health?.checkedAt ?? null,
        totalFailures,
        unrepairedFailures,
      };
    }),
  );

  return json({ platforms: result });
};
