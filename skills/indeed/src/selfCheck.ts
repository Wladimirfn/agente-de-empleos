/**
 * Self-check for Indeed.cl (SPEC-ID-009, design D9).
 *
 * `selfCheck` is the **read-only health probe** the dashboard polls between
 * scans. It launches the same persistent Chromium context the scan loop uses,
 * navigates to a single search URL, and inspects the classification:
 *
 *   - `jobs`  → status: `healthy`
 *   - `empty` → status: `healthy` (page loaded cleanly, just no results)
 *   - `challenge` after MAX_CHALLENGE_RETRIES → `needs-human` (Cloudflare
 *     cookie rotation has failed; operator must visit Indeed once manually
 *     to clear the interstitial so the persistent profile regains its
 *     `cf_clearance` token).
 *   - `blocked` → `needs-human` (Indeed has explicitly banned us — same
 *     operator-action story; the dashboard should surface the diagnosis).
 *   - `jobs`-classified but parser fails → `broken` with code
 *     `INDEED_PARSER_INCOMPATIBLE` (Indeed has changed their page shape and
 *     the dual mosaic/DOM parser can no longer extract any jobs from a
 *     page the classifier thinks should contain them).
 *   - Launch failure (Chromium binary missing) → `broken`
 *   - 5xx HTTP → `needs-human` (transient infra; operator can re-poll)
 *
 * Failure-modes that the SCAN loop surfaces via `TransientSkillError` are
 * deliberately NOT thrown here — `selfCheck` returns a `SkillHealth` enum so
 * the dashboard can render the right banner. The only path that throws is an
 * unexpected programmer error (the only one we cannot meaningfully report).
 *
 * Threat-matrix notes:
 *   - The probe URL is whitelisted: `${BASE_URL}/jobs?q=${DEFAULT_QUERIES[0]}&start=0`.
 *     No env-driven URL navigation.
 *   - The persistent profile dir is read-only from this module's perspective —
 *     `openPersistentContext` already handles the "already exists" case.
 *   - The probe runs at most ONE classification round; unlike the scan loop it
 *     does NOT paginate or dedupe (those are scan-only concerns). It DOES
 *     invoke `parseSearchPage` once on `jobs`-classified pages to verify the
 *     parsers still work — see the parser-compat check below.
 */

import { FatalSkillError, type SkillHealth } from '@employment-agent/skill-runtime';

import { BASE_URL, DEFAULT_QUERIES, MAX_CHALLENGE_RETRIES } from './types.js';
import { backoffMs } from './backoff.js';
import { classifyPage } from './classify.js';
import { openPersistentContext, type PersistentContextHandle } from './context.js';
import { parseSearchPage } from './parser.js';
import type { PageClass, PersistentPage } from './types.js';

// ---------------------------------------------------------------------------
// Hook surface — same shape as ScanHooks so tests can inject everything.
// ---------------------------------------------------------------------------

/**
 * Same hooks as `ScanHooks` minus `fetchOnePage` and `launchContext`:
 *
 *  - `launchContext`: defaults to `openPersistentContext`. Tests inject a
 *    pre-launched mock so they never instantiate Playwright.
 *  - `sleep`         : deterministic no-op for tests (real backoff waits).
 *  - `rand`          : pinned jitter source for deterministic tests.
 *
 * `selfCheck` deliberately does not accept a `fetchOnePage` override — the
 * probe must use the production `page.goto` to faithfully reproduce launch
 * behavior. The `launchContext` injection is enough for unit tests because
 * the launched mock already drives `page.goto`.
 */
export interface SelfCheckHooks {
  launchContext?: () => Promise<PersistentContextHandle>;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
}

export interface SelfCheckOptions {
  hooks?: SelfCheckHooks;
}

// ---------------------------------------------------------------------------
// Probe URL — derived from BASE_URL + DEFAULT_QUERIES. Pure for testing.
// ---------------------------------------------------------------------------

/**
 * The probe URL the health check navigates to. Pinned to the first
 * `DEFAULT_QUERIES` entry (per design D9: `BASE_URL/jobs?q=mantención&start=0`).
 *
 * Exported so tests can assert the exact URL without rebuilding the constant.
 */
export const SELF_CHECK_URL: string = `${BASE_URL}/jobs?q=${encodeURIComponent(DEFAULT_QUERIES[0] ?? 'mantención')}&start=0`;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ---------------------------------------------------------------------------
// Internal: classify one page-load, retrying only while we see `challenge`.
// ---------------------------------------------------------------------------

/**
 * Load the probe URL once (or up to `MAX_CHALLENGE_RETRIES+1` times when we
 * keep hitting Cloudflare). Returns the eventual classification so the caller
 * can map it to a `SkillHealth`.
 *
 * Other failures (HTTP 5xx, blocked HTML, navigation error) are surfaced as
 * `'5xx' | 'blocked' | 'navigation-error'` for the caller to translate.
 * We do NOT throw — `selfCheck` is read-only and must always return a
 * `SkillHealth`.
 */
async function probePage(
  page: PersistentPage,
  url: string,
  hooks: SelfCheckHooks,
): Promise<PageClass | '5xx' | 'navigation-error'> {
  const sleep = hooks.sleep ?? defaultSleep;

  for (let attempt = 0; attempt <= MAX_CHALLENGE_RETRIES; attempt++) {
    if (attempt > 0) {
      const ms = backoffMs(attempt - 1, hooks.rand);
      await sleep(ms);
    }

    let status = 200;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (!resp) {
        // Null response = navigation aborted (timeout, reset, etc.) — counts
        // as transient; consume one retry slot.
        if (attempt < MAX_CHALLENGE_RETRIES) continue;
        return 'navigation-error';
      }
      status = resp.status();
    } catch {
      if (attempt < MAX_CHALLENGE_RETRIES) continue;
      return 'navigation-error';
    }

    if (status >= 500) {
      // HTTP 5xx — not retried inside selfCheck. The scan loop propagates
      // this as `TransientSkillError`; here we just report it.
      return '5xx';
    }

    const pageClass = await classifyPage(page);
    if (pageClass === 'challenge' && attempt < MAX_CHALLENGE_RETRIES) continue;
    return pageClass;
  }

  // Loop fell through with every attempt still `challenge` — the caller
  // distinguishes this from a clean `'challenge'` outcome. We re-emit
  // `'challenge'` here so the wrapper can compare attempts vs budget.
  return 'challenge';
}

// ---------------------------------------------------------------------------
// Internal: jobs-classified health check — verifies parser compatibility.
// ---------------------------------------------------------------------------

/**
 * Map a `'jobs'` classification to a `SkillHealth` by invoking the dual
 * mosaic/DOM parser on the same page the classifier already accepted.
 *
 * The probe MUST verify parser compatibility, not just classifier output:
 * a page can satisfy `hasJobsMarker` (e.g. an empty `<a class="jcs-JobTitle">`
 * with no usable `jk`) yet the parser throws `FatalSkillError
 * (INDEED_PARSER_INCOMPATIBLE)` when the page actually contained no
 * extractable jobs. Catching that throw here and surfacing it as
 * `status: 'broken'` keeps the dashboard honest — the operator sees that the
 * skill is genuinely broken even though the page "looked" like a jobs page.
 *
 * Other errors (e.g. `page.evaluate` blows up for non-parser reasons) are
 * re-thrown so the outer `try/catch` in `selfCheck` can map them to
 * `INDEED_LAUNCH_FAILED` / `INDEED_SELFCheck_UNEXPECTED` as appropriate.
 */
async function jobsOutcome(
  page: PersistentPage,
  detectedAt: string,
): Promise<SkillHealth> {
  try {
    await parseSearchPage(page, 'jobs');
  } catch (err) {
    if (err instanceof FatalSkillError && err.code === 'INDEED_PARSER_INCOMPATIBLE') {
      return {
        status: 'broken',
        schemaVersion: SCHEMA_VERSION,
        detectedAt,
        lastError: {
          code: 'INDEED_PARSER_INCOMPATIBLE',
          message: err.message,
        },
      };
    }
    // Anything else (programmer error, IO error from the page, etc.) —
    // bubble to the outer try/catch in `selfCheck`.
    throw err;
  }
  return { status: 'healthy', schemaVersion: SCHEMA_VERSION, detectedAt };
}

// ---------------------------------------------------------------------------
// Public: selfCheck
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = '0.1.0';

/**
 * Run the Indeed.cl health probe.
 *
 * Decision tree:
 *   - launch failure            → `{ status: 'broken', lastError: { code: 'INDEED_LAUNCH_FAILED' } }`
 *   - persistent challenge       → `{ status: 'needs-human', lastError: { code: 'INDEED_CHALLENGE_PERSISTENT' } }`
 *   - blocked page (HTML marker) → `{ status: 'needs-human', lastError: { code: 'INDEED_BLOCKED' } }`
 *   - HTTP 5xx (any retry)       → `{ status: 'needs-human', lastError: { code: 'INDEED_HTTP_5XX' } }`
 *   - navigation error (any)     → `{ status: 'needs-human', lastError: { code: 'INDEED_NAVIGATION_EMPTY' } }`
 *   - jobs page, parser ok       → `{ status: 'healthy' }`
 *   - jobs page, parser throws
 *     `INDEED_PARSER_INCOMPATIBLE`
 *                                  → `{ status: 'broken', lastError: { code: 'INDEED_PARSER_INCOMPATIBLE' } }`
 *   - empty page                 → `{ status: 'healthy' }` (page loaded cleanly)
 *
 * The persistent Chromium context is closed in a `finally` block regardless
 * of which branch fires, mirroring `scanIndeed` resource semantics.
 */
export async function selfCheck(options: SelfCheckOptions = {}): Promise<SkillHealth> {
  const detectedAt = new Date().toISOString();
  const hooks = options.hooks ?? {};
  const launch = hooks.launchContext ?? openPersistentContext;

  let handle: PersistentContextHandle | undefined;
  try {
    handle = await launch();

    const outcome = await probePage(handle.page, SELF_CHECK_URL, hooks);

    switch (outcome) {
      case 'jobs':
        return await jobsOutcome(handle.page, detectedAt);
      case 'empty':
        return { status: 'healthy', schemaVersion: SCHEMA_VERSION, detectedAt };
      case 'challenge':
        return {
          status: 'needs-human',
          schemaVersion: SCHEMA_VERSION,
          detectedAt,
          lastError: {
            code: 'INDEED_CHALLENGE_PERSISTENT',
            message: `Indeed challenge persisted after ${MAX_CHALLENGE_RETRIES + 1} attempts at ${SELF_CHECK_URL}`,
          },
        };
      case 'blocked':
        return {
          status: 'needs-human',
          schemaVersion: SCHEMA_VERSION,
          detectedAt,
          lastError: {
            code: 'INDEED_BLOCKED',
            message: `Indeed blocked the request at ${SELF_CHECK_URL}`,
          },
        };
      case '5xx':
        return {
          status: 'needs-human',
          schemaVersion: SCHEMA_VERSION,
          detectedAt,
          lastError: {
            code: 'INDEED_HTTP_5XX',
            message: `Indeed probe HTTP 5xx at ${SELF_CHECK_URL}`,
          },
        };
      case 'navigation-error':
        return {
          status: 'needs-human',
          schemaVersion: SCHEMA_VERSION,
          detectedAt,
          lastError: {
            code: 'INDEED_NAVIGATION_EMPTY',
            message: `Indeed probe navigation failed after retries at ${SELF_CHECK_URL}`,
          },
        };
      default: {
        // Defensive: `outcome` is typed as a closed union; this branch is
        // only reachable if a future refactor adds a new outcome and forgets
        // to extend the switch. Surface it as `broken` so the dashboard sees
        // the regression.
        const _exhaustive: never = outcome;
        return {
          status: 'broken',
          schemaVersion: SCHEMA_VERSION,
          detectedAt,
          lastError: {
            code: 'INDEED_SELFCheck_UNEXPECTED',
            message: `selfCheck produced unhandled outcome: ${String(_exhaustive)}`,
          },
        };
      }
    }
  } catch (err) {
    // openPersistentContext failed (Chromium binary missing, etc.) or any
    // other synchronous throw that escaped the inner try.
    return {
      status: 'broken',
      schemaVersion: SCHEMA_VERSION,
      detectedAt,
      lastError: {
        code: 'INDEED_LAUNCH_FAILED',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    // Close errors are swallowed — the caller already has its final state,
    // and `openPersistentContext` is designed to be safe to re-close.
    if (handle) await handle.context.close().catch(() => undefined);
  }
}