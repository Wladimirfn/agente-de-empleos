/**
 * Scan orchestration for Indeed.cl (SPEC-ID-001..008, design D3/D6/D7/D8).
 *
 * This module is the runtime "outer loop" of the skill. It pulls together:
 *
 *   - `openPersistentContext` (context.ts)        — the browser handle.
 *   - `buildSearchUrl` (url.ts)                   — offset pagination.
 *   - `classifyPage` (classify.ts)                — challenge/blocked/jobs/empty.
 *   - `parseSearchPage` (parser.ts)               — mosaic-primary dual parser.
 *   - `backoffMs` (backoff.ts)                    — exponential + jitter.
 *
 * The key behaviors (each mapped to a RED test):
 *
 *   - Bounded challenge retry (MAX_CHALLENGE_RETRIES), exponential backoff
 *     with jitter, then `TransientSkillError(INDEED_CHALLENGE_PERSISTENT)`.
 *   - `blocked` HTML markers → instant `FatalSkillError(INDEED_BLOCKED)`,
 *     no retry.
 *   - HTTP 5xx → instant `TransientSkillError(INDEED_HTTP_5XX)`, no retry.
 *   - Navigation errors (timeout/aborted) consume retry budget (transient).
 *   - Dedupe by `externalId` across the ENTIRE scan (queries and pages).
 *   - Pagination: stop on `empty` page OR `jobs.length < PAGE_SIZE` OR
 *     `MAX_PAGES_PER_QUERY` reached.
 *
 * Testability:
 *   - `scanWithPersistentContext` takes a pre-launched `PersistentContextHandle`,
 *     never calls Playwright directly. Tests substitute it with a mock.
 *   - `scanIndeed` is the high-level wrapper that handles launch + close.
 *     It accepts an injected `launchContext` hook so tests never instantiate
 *     `chromium.launchPersistentContext` either.
 *   - `sleep` and `rand` hooks let tests assert backoff without waiting
 *     real wall-clock time.
 */

import { TransientSkillError, FatalSkillError } from '@employment-agent/skill-runtime';
import type { CandidateProfile } from '@employment-agent/domain';
import type { ScanResult, SkillContext } from '@employment-agent/skill-runtime';

import { backoffMs } from './backoff.js';
import { openPersistentContext, type PersistentContextHandle } from './context.js';
import { classifyPage } from './classify.js';
import { parseSearchPage } from './parser.js';
import {
  MAX_CHALLENGE_RETRIES,
  MAX_PAGES_PER_QUERY,
  PAGE_SIZE,
} from './types.js';
import { buildQueries, buildSearchUrl } from './url.js';
import type { NormalizedJob, PageClass, PersistentPage } from './types.js';

// ---------------------------------------------------------------------------
// Test hooks — every side-effecting primitive is injectable.
// ---------------------------------------------------------------------------

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Default `fetchOnePage`: drive `page.goto` and return the HTTP status. */
async function defaultFetchOnePage(
  page: PersistentPage,
  url: string,
): Promise<{ status: number }> {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!resp) {
    throw new TransientSkillError(
      `Indeed navigation returned no response (url=${url})`,
      'INDEED_NAVIGATION_EMPTY',
    );
  }
  return { status: resp.status() };
}

/**
 * Hook surface — everything optional so tests only pay for what they assert.
 *
 *  - `sleep`      : delay between challenge retries (default: real setTimeout)
 *  - `rand`       : deterministic jitter source (default: Math.random)
 *  - `launchContext`: replaces `openPersistentContext` for `scanIndeed` tests
 *  - `fetchOnePage`: replaces the default `page.goto` driver; used to simulate
 *                    network errors, injection of test throws, etc.
 */
export interface ScanHooks {
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
  launchContext?: () => Promise<PersistentContextHandle>;
  fetchOnePage?: (page: PersistentPage, url: string) => Promise<{ status: number }>;
}

export interface ScanOptions {
  hooks?: ScanHooks;
}

// ---------------------------------------------------------------------------
// Bounded challenge retry loop (SPEC-ID-003, RED #4, design D3)
// ---------------------------------------------------------------------------

/**
 * Fetch + classify a single page, retrying only while the page classifies as
 * `challenge`. Other classifications / errors short-circuit immediately.
 *
 * Returns the resolved `pageClass` (caller uses it to decide whether to
 * parse or break pagination). Throws:
 *   - `FatalSkillError(INDEED_BLOCKED)`         — HTML marker match, no retry
 *   - `TransientSkillError(INDEED_HTTP_5XX)`    — non-2xx, no retry
 *   - `TransientSkillError(INDEED_CHALLENGE_PERSISTENT)` — after MAX attempts
 *   - `TransientSkillError(INDEED_NAVIGATION_EMPTY)`     — null response
 *   - `TransientSkillError` (cause = underlying throw)     — for navigation errors
 *     when retries are exhausted.
 */
async function fetchWithChallengeRetry(
  page: PersistentPage,
  url: string,
  hooks: ScanHooks,
): Promise<{ pageClass: PageClass }> {
  const sleep = hooks.sleep ?? defaultSleep;
  const fetchOnePage = hooks.fetchOnePage ?? defaultFetchOnePage;
  let lastError: unknown;

  // Loop is `0..MAX_CHALLENGE_RETRIES` inclusive → MAX_CHALLENGE_RETRIES+1 attempts.
  for (let attempt = 0; attempt <= MAX_CHALLENGE_RETRIES; attempt++) {
    if (attempt > 0) {
      // attempt-1 is the 0-based retry counter fed to backoffMs.
      const ms = backoffMs(attempt - 1, hooks.rand);
      await sleep(ms);
    }

    let status = 200;
    try {
      const res = await fetchOnePage(page, url);
      status = res.status;
    } catch (err) {
      // A FatalSkillError thrown inside `fetchOnePage` (e.g. blocked-from-fetch)
      // must abort the budget immediately — it is unrecoverable inside the
      // skill. Other errors (network / timeout / aborted) are transient and
      // consume a retry slot until the budget is exhausted.
      if (err instanceof FatalSkillError) throw err;
      lastError = err;
      continue;
    }

    if (status >= 500) {
      // 5xx is a transient but per design D3 we do NOT retry within the
      // skill — worker-level retrier handles it. Throw a transient so the
      // task runner re-enqueues with backoff.
      throw new TransientSkillError(
        `Indeed search HTTP ${status} (url=${url})`,
        'INDEED_HTTP_5XX',
      );
    }

    const pageClass = await classifyPage(page);
    if (pageClass === 'jobs' || pageClass === 'empty') {
      return { pageClass };
    }
    if (pageClass === 'blocked') {
      // blocked → FatalSkillError immediately, no retries, no sleeps.
      throw new FatalSkillError(
        `Indeed blocked the request (url=${url})`,
        'INDEED_BLOCKED',
      );
    }
    // pageClass === 'challenge' → consume one retry slot, loop again.
    lastError = new Error(`challenge persisted at attempt ${attempt}`);
  }

  throw new TransientSkillError(
    `Indeed challenge persisted after ${MAX_CHALLENGE_RETRIES + 1} attempts (url=${url})`,
    'INDEED_CHALLENGE_PERSISTENT',
    lastError,
  );
}

// ---------------------------------------------------------------------------
// Inner scan loop — takes an already-open persistent context.
// ---------------------------------------------------------------------------

/**
 * Run the inner scan loop against a pre-launched persistent context.
 *
 * Emits `scan_started` once at the start and `scan_completed` (or
 * `scan_error` followed by `scan_completed`) at the end. Per-job events
 * `job_found` are emitted as new jobs are detected.
 *
 * Returns a `ScanResult` compatible with the existing worker pipeline.
 *
 * Resource note: the caller's context is closed by the caller; this function
 * NEVER closes the page or context it was handed — that responsibility lives
 * in `scanIndeed` so failures here can be re-wrapped in a try/finally.
 */
export async function scanWithPersistentContext(
  profile: CandidateProfile,
  ctx: SkillContext,
  persistent: PersistentContextHandle,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const hooks = options.hooks ?? {};
  const queries = buildQueries(profile);

  await ctx.events.emit({
    kind: 'scan_started',
    message: `Iniciando escaneo de Indeed.cl (${queries.join(', ')})`,
    payload: { profileId: profile.id ?? null, queries },
  });

  const seen = new Set<string>();
  let jobsFound = 0;
  let jobsDuplicate = 0;
  let errors = 0;

  // Errors at the per-page level always abort the entire scan (per design D7):
  //   - FatalSkillError → unrecoverable config / blocked page — re-throw.
  //   - TransientSkillError → worker retrier gets it; we don't burn through
  //     remaining queries when one query already failed (5xx, exhausted
  //     challenge retries, navigation failures).
  // Either way: emit `scan_error` for observability, increment errors,
  // re-throw. The orchestrator will then re-enqueue the task with backoff.
  for (const query of queries) {
    for (let pageNo = 0; pageNo < MAX_PAGES_PER_QUERY; pageNo++) {
      const offset = pageNo * PAGE_SIZE;
      const url = buildSearchUrl(query, offset);

      let pageClass: PageClass;
      let parsedJobs: NormalizedJob[] = [];
      try {
        ({ pageClass } = await fetchWithChallengeRetry(persistent.page, url, hooks));
        if (pageClass !== 'empty') {
          const parsed = await parseSearchPage(persistent.page, pageClass);
          parsedJobs = parsed.jobs;
        }
      } catch (err) {
        errors++;
        await ctx.events.emit({
          kind: 'scan_error',
          message: `Indeed scan failed: ${err instanceof Error ? err.message : String(err)}`,
          payload: {
            query,
            offset,
            code:
              err instanceof Error && 'code' in err
                ? (err as { code: string }).code
                : undefined,
            kind:
              err instanceof Error && 'kind' in err
                ? (err as { kind: string }).kind
                : undefined,
          },
        });
        // Both FatalSkillError and TransientSkillError propagate up. The
        // outer `scanIndeed` wrapper handles resource cleanup (close context)
        // and the worker retrier handles re-enqueueing.
        throw err;
      }

      if (pageClass === 'empty' || parsedJobs.length === 0) break;

      for (const job of parsedJobs) {
        if (seen.has(job.externalId)) {
          jobsDuplicate++;
          continue;
        }
        seen.add(job.externalId);
        jobsFound++;
        await ctx.events.emit({
          kind: 'job_found',
          message: `Encontrada: ${job.title}${job.company ? ` en ${job.company}` : ''}`,
          payload: job,
        });
      }

      // Conservative stop signal: short pages risk duplicating the last row
      // of the next page. Better to break than to dedupe-blindly.
      if (parsedJobs.length < PAGE_SIZE) break;
    }
  }

  await ctx.events.emit({
    kind: 'scan_completed',
    message: `Escaneo de Indeed.cl completado: ${jobsFound} ofertas encontradas`,
    payload: { jobsFound, errors },
  });

  // jobsNew is per-scan unique emissions (dedupe is per-scan only).
  return { jobsFound, jobsNew: jobsFound, jobsDuplicate, errors };
}

// ---------------------------------------------------------------------------
// High-level wrapper — launches + closes the context.
// ---------------------------------------------------------------------------

/**
 * Top-level scan entry point.
 *
 * Opens a persistent context, delegates to `scanWithPersistentContext`, and
 * closes the context in a `finally` block so that transient errors, fatal
 * errors, and silent successes all release the Chromium subprocess.
 *
 * `hooks.launchContext` defaults to `openPersistentContext`; tests pass a
 * no-op mock so they never instantiate Playwright.
 */
export async function scanIndeed(
  profile: CandidateProfile,
  ctx: SkillContext,
  hooks: ScanHooks = {},
): Promise<ScanResult> {
  const launch = hooks.launchContext ?? openPersistentContext;
  const handle = await launch();

  try {
    return await scanWithPersistentContext(profile, ctx, handle, {
      hooks: { ...hooks, launchContext: hooks.launchContext },
    });
  } finally {
    // Close errors are swallowed — the caller already has its final state.
    await handle.context.close().catch(() => undefined);
  }
}
