import { ArbeitnowSource } from './arbeitnow.js';
import { GetOnboardSource } from './getonboard.js';
import type { JobSource, JobSourceResult } from './types.js';

export type { JobSource, JobSourceResult } from './types.js';
export { ArbeitnowSource } from './arbeitnow.js';
export { GetOnboardSource } from './getonboard.js';

/**
 * Default ordered list of job sources used by the search orchestrator.
 *
 * Sources are tried in parallel; results are merged and deduplicated by
 * externalId+platformSlug. Order matters only for fallback semantics —
 * GetOnboard is listed first because it's the only one with Chilean
 * coverage out of the box.
 */
export const DEFAULT_SOURCES: JobSource[] = [
  new GetOnboardSource(),
  new ArbeitnowSource(),
];

/**
 * Run a query across every registered source in parallel, then dedupe.
 *
 * Why parallel: each source is a separate HTTP request; running them in
 * series would multiply latency without any benefit. We accept that one
 * source failing shouldn't block the others — errors are swallowed per
 * source and the merge happens over whatever came back.
 */
export async function searchAllSources(
  query: string,
  location?: string,
  sources: JobSource[] = DEFAULT_SOURCES,
): Promise<JobSourceResult[]> {
  const settled = await Promise.allSettled(sources.map((s) => s.searchJobs(query, location)));
  const all: JobSourceResult[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') all.push(...result.value);
  }
  // Dedupe by platform+externalId so the same job doesn't appear twice if
  // two sources mirror each other.
  const seen = new Set<string>();
  return all.filter((job) => {
    const key = `${job.platformSlug}:${job.externalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
