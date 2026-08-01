/**
 * Page classifier for Indeed.cl search results (SPEC-ID-002).
 *
 * Order of detection is fixed and idempotent:
 *   1. challenge  — Cloudflare / bot-mitigation interstitial
 *   2. blocked    — Indeed error page or non-2xx indicator in the body
 *   3. jobs       — at least one parseable job card (mosaic JSON or DOM)
 *   4. empty      — page loaded cleanly with no jobs (clean stop signal)
 *
 * The classifier never navigates: it reads `page.content()` (cheap) and one
 * `page.evaluate` call for the jobs marker. This lets `scan` run
 * `classifyPage` on every page without paying an extra round-trip.
 */

import type { PageClass, PersistentPage } from './types.js';

/** Substrings that, if present in the body, indicate a Cloudflare challenge. */
const CHALLENGE_MARKERS = [
  'cf-mitigated',
  'challenge-running',
  'just a moment',          // Cloudflare page title
  'attention required',     // Cloudflare H1
  'verify you are human',
  'checking your browser',
] as const;

/** Substrings that indicate Indeed has explicitly blocked this client. */
const BLOCKED_MARKERS = [
  'access denied',
  'indeed has blocked',
  'forbidden',
  'internal server error',
  'service unavailable',
  'http 403',
  'http 500',
] as const;

export function isChallengeMarker(html: string): boolean {
  const lower = html.toLowerCase();
  return CHALLENGE_MARKERS.some((m) => lower.includes(m));
}

export function isBlockedMarker(html: string): boolean {
  const lower = html.toLowerCase();
  return BLOCKED_MARKERS.some((m) => lower.includes(m));
}

/**
 * Run the cheap DOM/JSON marker check that distinguishes `jobs` from `empty`.
 *
 * A page is classified as `jobs` if EITHER:
 *   - `<a class="jcs-JobTitle" href>` is present (DOM card), OR
 *   - a `#mosaic-provider-script` (fallback `#mosaic-data`) tag contains a
 *     parseable JSON blob with at least one entry under
 *     `mosaicProviderJobCardsModel.jobCards`.
 *
 * Failure of any JSON parse is treated as "no jobs" — the DOM branch is
 * separate and will be tried by the parser regardless of classification.
 */
export async function hasJobsMarker(page: PersistentPage): Promise<boolean> {
  return page.evaluate<boolean>(() => {
    if (document.querySelector('a.jcs-JobTitle[href]')) return true;

    const script =
      document.getElementById('mosaic-provider-script') ??
      document.getElementById('mosaic-data');
    if (!script?.textContent) return false;

    try {
      const parsed = JSON.parse(script.textContent) as {
        mosaicProviderJobCardsModel?: { jobCards?: unknown[] };
      };
      const cards = parsed?.mosaicProviderJobCardsModel?.jobCards;
      return Array.isArray(cards) && cards.length > 0;
    } catch {
      return false;
    }
  });
}

/**
 * Classify a loaded Indeed search page.
 *
 * Idempotent and free of side effects: no navigation, no mutations.
 */
export async function classifyPage(page: PersistentPage): Promise<PageClass> {
  const html = await page.content();

  if (isChallengeMarker(html)) return 'challenge';
  if (isBlockedMarker(html)) return 'blocked';

  const hasJobs = await hasJobsMarker(page);
  return hasJobs ? 'jobs' : 'empty';
}