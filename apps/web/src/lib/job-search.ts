import { db } from '@employment-agent/database';
import {
  applications,
  candidateExperiences,
  candidateProfiles,
  candidateSkills,
  candidateTargetRoles,
  jobMatches,
  jobs,
  platforms,
} from '@employment-agent/database/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { LLMProvider } from '@employment-agent/llm';
import type { CandidateProfile, Job } from '@employment-agent/domain';
import { searchAllSources, type JobSourceResult, type JobSource } from './job-sources/index.js';

export interface SearchJobsArgs {
  query: string;
  location?: string;
  limit?: number;
  sources?: JobSource[];
  useTargetRoles?: boolean;
}

export interface MatchedJob {
  id: number;
  externalId: string;
  platformSlug: string;
  title: string;
  company?: string;
  location?: string;
  url?: string;
  description?: string;
  score: number;
  reasoning?: string;
  breakdown?: {
    skillsMatch: number;
    experienceMatch: number;
    locationMatch: number;
    seniorityMatch: number;
  };
  applied: boolean;
}

/**
 * Ensure a platform row exists for the given slug and return its id.
 * Platforms are small and stable (GetOnboard, Arbeitnow) — we don't need
 * a separate seed step, just a find-or-insert on demand.
 */
async function ensurePlatform(slug: string, displayName: string, baseUrl?: string): Promise<number> {
  const existing = await db.select().from(platforms).where(eq(platforms.slug, slug)).limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await db
    .insert(platforms)
    .values({ slug, displayName, baseUrl, status: 'active' })
    .returning({ id: platforms.id });
  return inserted[0]!.id;
}

/**
 * Insert or refresh a job row keyed by (platform, externalId). Returns the
 * local DB id. On duplicate we just bump `lastSeenAt` so we know the
 * listing is still alive — we don't re-hash or re-write content.
 */
async function upsertJob(args: {
  platformId: number;
  result: JobSourceResult;
}): Promise<number> {
  const existing = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.platformId, args.platformId), eq(jobs.externalId, args.result.externalId)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(jobs)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(jobs.id, existing[0].id));
    return existing[0].id;
  }
  const inserted = await db
    .insert(jobs)
    .values({
      platformId: args.platformId,
      externalId: args.result.externalId,
      title: args.result.title,
      company: args.result.company ?? null,
      location: args.result.location ?? null,
      url: args.result.url ?? null,
      description: args.result.description ?? null,
      rawPayload: args.result.rawPayload ? JSON.stringify(args.result.rawPayload) : null,
    })
    .returning({ id: jobs.id });
  return inserted[0]!.id;
}

async function loadProfile(): Promise<(CandidateProfile & { searchScope?: string }) | null> {
  const rows = await db.select().from(candidateProfiles).limit(1);
  if (rows.length === 0) return null;
  const p = rows[0]!;
  const experiences = await db
    .select()
    .from(candidateExperiences)
    .where(eq(candidateExperiences.profileId, p.id));
  const skills = await db
    .select()
    .from(candidateSkills)
    .where(eq(candidateSkills.profileId, p.id));
  const targetRoles = await db
    .select()
    .from(candidateTargetRoles)
    .where(and(eq(candidateTargetRoles.profileId, p.id), eq(candidateTargetRoles.isActive, 1)));
  return {
    id: p.id,
    fullName: p.fullName ?? undefined,
    email: p.email ?? undefined,
    phone: p.phone ?? undefined,
    location: p.location ?? undefined,
    searchScope: p.searchScope ?? 'local',
    experiences: experiences.map((e) => ({
      id: e.id,
      company: e.company,
      role: e.role,
      startDate: e.startDate ?? undefined,
      endDate: e.endDate ?? undefined,
      description: e.description ?? undefined,
    })),
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      level: s.level ?? undefined,
      years: s.years ?? undefined,
    })),
    // Target roles get appended to the summary so the LLM sees them when
    // scoring matches. Active roles only, ordered by priority.
    summary: [
      p.summary ?? '',
      targetRoles.length > 0
        ? `\nRoles objetivo activos: ${targetRoles.map((r) => `${r.roleTitle} (prioridad ${r.priority})`).join(', ')}`
        : '',
    ].filter(Boolean).join('\n'),
  };
}

/**
 * Resolve the location filters to pass to job sources based on the
 * candidate's search scope preferences and their stored location.
 * Returns one entry per selected scope; the caller runs one search per entry.
 *
 * - local: use the city part of the profile location (e.g. "Puerto Montt")
 * - national: use the country part (e.g. "Chile")
 * - international: no location filter — search everywhere
 * - remote: pass "remote" so sources that support it filter to remote-only
 */
function resolveSearchLocations(profile: { location?: string; searchScope?: string }): Array<string | undefined> {
  const raw = profile.searchScope ?? 'local';
  const scopes = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const loc = profile.location ?? '';
  const results: Array<string | undefined> = [];

  for (const scope of scopes) {
    if (scope === 'international') {
      results.push(undefined);
    } else if (scope === 'remote') {
      results.push('remote');
    } else if (scope === 'national') {
      const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
      results.push(parts.length > 1 ? parts[parts.length - 1] : loc || undefined);
    } else {
      // local — use the city (first part before comma).
      const city = loc.split(',')[0]?.trim();
      results.push(city || undefined);
    }
  }

  return results.length > 0 ? results : [undefined];
}

/**
 * Search all sources, persist new jobs, score them against the active
 * candidate profile, and return the top matches sorted by score.
 *
 * Why score every new job: the user only sees the list ordered by fit, so
 * each row needs a score attached. We cache matches in `job_matches` so
 * subsequent searches of the same query don't re-pay the LLM cost.
 */
/**
 * Search all sources, persist new jobs, score them against the active
 * candidate profile, and return the top matches sorted by score.
 *
 * When `useTargetRoles` is true, the search runs one query per active
 * target role (plus the user's explicit query) and merges the results.
 * This is how the agent "knows" what to look for without the user typing
 * the same role every time.
 */
export async function searchJobs(args: SearchJobsArgs, llm: LLMProvider): Promise<MatchedJob[]> {
  const profile = await loadProfile();
  if (!profile) throw new Error('No hay perfil cargado todavía.');

  const platformIds = new Map<string, number>();
  const limit = args.limit ?? 20;

  // Resolve location filters from the candidate's search scopes unless the
  // caller explicitly overrode it. One search pass per selected scope.
  const searchLocations = args.location !== undefined
    ? [args.location]
    : resolveSearchLocations(profile);

  // 1. Build the query list: explicit query + active target roles (if requested).
  const queries: string[] = [args.query];
  if (args.useTargetRoles) {
    const activeRoles = await db
      .select()
      .from(candidateTargetRoles)
      .where(and(eq(candidateTargetRoles.profileId, profile.id!), eq(candidateTargetRoles.isActive, 1)))
      .orderBy(candidateTargetRoles.priority);
    for (const role of activeRoles) {
      if (!queries.includes(role.roleTitle)) queries.push(role.roleTitle);
    }
  }

  // 2. Fetch raw results from all sources for every query × location combo.
  const rawResults: JobSourceResult[] = [];
  for (const q of queries) {
    for (const loc of searchLocations) {
      const results = await searchAllSources(q, loc, args.sources);
      rawResults.push(...results);
    }
  }

  // 3. Dedupe by platform+externalId before persisting.
  const seen = new Set<string>();
  const uniqueResults = rawResults.filter((job) => {
    const key = `${job.platformSlug}:${job.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 4. Persist jobs, dedupe by local id, and keep the top N.
  const persistedJobs: Array<{ id: number; result: JobSourceResult; job: Job }> = [];
  for (const result of uniqueResults.slice(0, Math.min(limit, 15))) {
    if (!platformIds.has(result.platformSlug)) {
      const platformId = await ensurePlatform(
        result.platformSlug,
        result.platformSlug === 'getonboard' ? 'GetOnboard' : 'Arbeitnow',
        result.platformSlug === 'getonboard' ? 'https://www.getonbrd.com' : 'https://arbeitnow.com',
      );
      platformIds.set(result.platformSlug, platformId);
    }
    const platformId = platformIds.get(result.platformSlug)!;
    const jobId = await upsertJob({ platformId, result });
    persistedJobs.push({
      id: jobId,
      result,
      job: {
        id: jobId,
        platformId,
        externalId: result.externalId,
        title: result.title,
        company: result.company,
        location: result.location,
        url: result.url,
        description: result.description,
        rawPayload: result.rawPayload,
      },
    });
  }

  // 3. Check which jobs already have an application.
  const appliedIds = new Set<number>();
  if (persistedJobs.length > 0) {
    const profileId = profile.id!;
    const apps = await db
      .select({ jobId: applications.jobId })
      .from(applications)
      .where(eq(applications.profileId, profileId));
    for (const a of apps) appliedIds.add(a.jobId);
  }

  // 4. For each job: get cached match, or compute via LLM.
  const profileId = profile.id!;
  const matched: MatchedJob[] = [];
  for (const entry of persistedJobs) {
    // Cache hit?
    const cached = await db
      .select()
      .from(jobMatches)
      .where(and(eq(jobMatches.jobId, entry.id), eq(jobMatches.profileId, profileId)))
      .limit(1);
    let score: number;
    let reasoning: string | undefined;
    let breakdown: MatchedJob['breakdown'] | undefined;
    if (cached[0]) {
      score = cached[0].score;
      try {
        const parsed = cached[0].breakdownJson ? JSON.parse(cached[0].breakdownJson) : null;
        breakdown = parsed?.breakdown ?? undefined;
        reasoning = parsed?.reasoning ?? undefined;
      } catch { /* ignore */ }
    } else {
      // LLM scoring — cheap and fast for short job descriptions.
      const llmResult = await llm.scoreMatch(profile, entry.job);
      score = llmResult.score;
      reasoning = llmResult.reasoning;
      breakdown = llmResult.breakdown;
      await db.insert(jobMatches).values({
        jobId: entry.id,
        profileId,
        score,
        breakdownJson: JSON.stringify({ breakdown, reasoning }),
      });
    }
    matched.push({
      id: entry.id,
      externalId: entry.result.externalId,
      platformSlug: entry.result.platformSlug,
      title: entry.result.title,
      company: entry.result.company,
      location: entry.result.location,
      url: entry.result.url,
      description: entry.result.description,
      score,
      reasoning,
      breakdown,
      applied: appliedIds.has(entry.id),
    });
  }

  // Sort descending by score so the best fits land first.
  matched.sort((a, b) => b.score - a.score);
  return matched;
}

/**
 * Mark a job as applied by the active profile. Creates an `applications`
 * row in `draft` status — the user can later move it through the pipeline
 * (prepared → submitted) from the postulaciones UI.
 */
export async function applyToJob(args: {
  jobId: number;
  llm: LLMProvider;
}): Promise<{ applicationId: number }> {
  const profile = await loadProfile();
  if (!profile) throw new Error('No hay perfil cargado todavía.');
  const profileId = profile.id!;

  // Verify the job exists.
  const job = await db.select().from(jobs).where(eq(jobs.id, args.jobId)).limit(1);
  if (job.length === 0) throw new Error('Oferta no encontrada.');

  // Avoid duplicates — one application per (job, profile).
  const existing = await db
    .select()
    .from(applications)
    .where(and(eq(applications.jobId, args.jobId), eq(applications.profileId, profileId)))
    .limit(1);
  if (existing[0]) return { applicationId: existing[0].id };

  const inserted = await db
    .insert(applications)
    .values({
      jobId: args.jobId,
      profileId,
      status: 'draft',
      preparedAt: new Date().toISOString(),
    })
    .returning({ id: applications.id });
  return { applicationId: inserted[0]!.id };
}

/**
 * List the current matches for the active profile, ordered by score.
 * Used by the ofertas page to render the saved shortlist.
 */
export async function listMatches(args: { limit?: number } = {}): Promise<MatchedJob[]> {
  const profile = await loadProfile();
  if (!profile) return [];
  const profileId = profile.id!;

  const limit = args.limit ?? 50;
  const rows = await db
    .select({
      matchId: jobMatches.id,
      jobId: jobMatches.jobId,
      score: jobMatches.score,
      breakdownJson: jobMatches.breakdownJson,
      jobExternalId: jobs.externalId,
      jobTitle: jobs.title,
      jobCompany: jobs.company,
      jobLocation: jobs.location,
      jobUrl: jobs.url,
      jobDescription: jobs.description,
      platformSlug: platforms.slug,
    })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobMatches.jobId, jobs.id))
    .innerJoin(platforms, eq(jobs.platformId, platforms.id))
    .where(eq(jobMatches.profileId, profileId))
    .orderBy(desc(jobMatches.score))
    .limit(limit);

  const appliedIds = new Set<number>();
  if (rows.length > 0) {
    const apps = await db
      .select({ jobId: applications.jobId })
      .from(applications)
      .where(eq(applications.profileId, profileId));
    for (const a of apps) appliedIds.add(a.jobId);
  }

  return rows.map((r) => {
    let breakdown: MatchedJob['breakdown'] | undefined;
    let reasoning: string | undefined;
    try {
      const parsed = r.breakdownJson ? JSON.parse(r.breakdownJson) : null;
      breakdown = parsed?.breakdown ?? undefined;
      reasoning = parsed?.reasoning ?? undefined;
    } catch { /* ignore */ }
    return {
      id: r.jobId,
      externalId: r.jobExternalId,
      platformSlug: r.platformSlug,
      title: r.jobTitle,
      company: r.jobCompany ?? undefined,
      location: r.jobLocation ?? undefined,
      url: r.jobUrl ?? undefined,
      description: r.jobDescription ?? undefined,
      score: r.score,
      reasoning,
      breakdown,
      applied: appliedIds.has(r.jobId),
    };
  });
}
