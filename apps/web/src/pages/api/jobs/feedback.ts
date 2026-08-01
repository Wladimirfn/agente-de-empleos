import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { candidateProfiles, jobs, jobMatches, matchFeedback, platforms } from '@employment-agent/database/schema';
import { and, desc, eq } from 'drizzle-orm';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** GET: list jobs for a platform with their match scores and feedback. */
export const GET: APIRoute = async ({ url }) => {
  const slug = url.searchParams.get('platform');
  const profileRows = await db.select().from(candidateProfiles).limit(1);
  if (profileRows.length === 0) return json({ jobs: [] });
  const profileId = profileRows[0].id;

  // Build query: jobs + optional match + optional feedback
  let query = db
    .select({
      jobId: jobs.id,
      externalId: jobs.externalId,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      url: jobs.url,
      description: jobs.description,
      platformSlug: platforms.slug,
      platformName: platforms.displayName,
      matchScore: jobMatches.score,
      matchBreakdown: jobMatches.breakdownJson,
      feedbackVerdict: matchFeedback.userVerdict,
      feedbackNote: matchFeedback.userNote,
      firstSeenAt: jobs.firstSeenAt,
    })
    .from(jobs)
    .innerJoin(platforms, eq(jobs.platformId, platforms.id))
    .leftJoin(jobMatches, and(eq(jobMatches.jobId, jobs.id), eq(jobMatches.profileId, profileId)))
    .leftJoin(matchFeedback, and(eq(matchFeedback.jobId, jobs.id), eq(matchFeedback.profileId, profileId)))
    .orderBy(desc(jobMatches.score))
    .limit(100);

  if (slug) {
    query = query.where(eq(platforms.slug, slug)) as typeof query;
  }

  const rows = await query;

  return json({
    jobs: rows.map((r) => {
      let breakdown = null;
      let reasoning = null;
      try {
        const parsed = r.matchBreakdown ? JSON.parse(r.matchBreakdown) : null;
        breakdown = parsed?.breakdown ?? null;
        reasoning = parsed?.reasoning ?? null;
      } catch { /* ignore */ }
      return {
        id: r.jobId,
        externalId: r.externalId,
        title: r.title,
        company: r.company,
        location: r.location,
        url: r.url,
        description: r.description?.slice(0, 300),
        platformSlug: r.platformSlug,
        platformName: r.platformName,
        score: r.matchScore ?? null,
        breakdown,
        reasoning,
        feedback: r.feedbackVerdict ?? null,
        feedbackNote: r.feedbackNote ?? null,
        firstSeenAt: r.firstSeenAt,
      };
    }),
  });
};

/** POST: submit feedback on a job match. */
export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const obj = body as Record<string, unknown>;
  const jobId = obj.jobId;
  const verdict = obj.verdict;
  const note = typeof obj.note === 'string' ? obj.note : null;

  if (typeof jobId !== 'number' || !Number.isInteger(jobId) || jobId <= 0) {
    return json({ error: 'jobId must be a positive integer' }, 400);
  }
  if (verdict !== 'compatible' && verdict !== 'not_compatible') {
    return json({ error: 'verdict must be "compatible" or "not_compatible"' }, 400);
  }

  const profileRows = await db.select().from(candidateProfiles).limit(1);
  if (profileRows.length === 0) return json({ error: 'No profile' }, 404);
  const profileId = profileRows[0].id;

  // Get the original score
  const matchRows = await db
    .select({ score: jobMatches.score })
    .from(jobMatches)
    .where(and(eq(jobMatches.jobId, jobId), eq(jobMatches.profileId, profileId)))
    .limit(1);
  const originalScore = matchRows[0]?.score ?? 0;

  // Upsert feedback (one per job+profile, latest wins)
  const existing = await db
    .select({ id: matchFeedback.id })
    .from(matchFeedback)
    .where(and(eq(matchFeedback.jobId, jobId), eq(matchFeedback.profileId, profileId)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(matchFeedback)
      .set({ userVerdict: verdict, userNote: note, originalScore, createdAt: new Date().toISOString() })
      .where(eq(matchFeedback.id, existing[0].id));
  } else {
    await db.insert(matchFeedback).values({
      jobId,
      profileId,
      originalScore,
      userVerdict: verdict,
      userNote: note,
    });
  }

  return json({ ok: true, jobId, verdict });
};
