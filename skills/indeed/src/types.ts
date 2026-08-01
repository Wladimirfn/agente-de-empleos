/**
 * Indeed.cl browser skill — public types and constants.
 *
 * Unit 1 (parser library) only. Scan / retry / selfCheck live behind these
 * primitives and are added by Units 2–3.
 */

import type { ElementHandle } from 'playwright';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Indeed.cl base URL.
 *
 * Hard-coded (not env-driven) per design D-note "navigation to arbitrary URLs":
 * the only URLs the skill ever navigates to are built by `buildSearchUrl` /
 * `buildCanonicalUrl` and are rooted at `BASE_URL`.
 */
export const BASE_URL = 'https://cl.indeed.com';

/** Chromium persistent-context profile directory. */
export const PROFILE_DIR = 'storage/indeed-profile';

/** Offset step for `/jobs?q=&start=`. Indeed actually returns ~15 per page; 10 is the conservative dedupe-safe signal. */
export const PAGE_SIZE = 10;

/** Max pages per query: 0..(MAX_PAGES_PER_QUERY-1) step PAGE_SIZE. */
export const MAX_PAGES_PER_QUERY = 3;

/** Max number of queries derived from `profile.skills`. */
export const MAX_QUERIES = 3;

/** Max in-skill challenge retries before surfacing `TransientSkillError`. */
export const MAX_CHALLENGE_RETRIES = 3;

/** Default queries used when the candidate profile has no skills. */
export const DEFAULT_QUERIES: readonly string[] = ['mantención', 'refrigeración'];

/** Default Chromium User-Agent (mirrors computrabajo skill for cross-platform consistency). */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Normalized output shape
// ---------------------------------------------------------------------------

/**
 * Job postings in the shape downstream consumers expect.
 *
 * Mirrors the laborum NormalizedJob field set so the database row mapper can
 * stay shared. Indeed has no `description`/`modality`/`employmentType` exposed
 * on the search results page, so those fields are not present here.
 */
export interface NormalizedJob {
  externalId: string;
  title: string;
  company?: string;
  location?: string;
  url: string;
  postedAt?: string;
}

// ---------------------------------------------------------------------------
// Page classification
// ---------------------------------------------------------------------------

/**
 * Result of classifying a loaded search page.
 *
 *  - `jobs`     — at least one job card is present (mosaic JSON or DOM card)
 *  - `challenge`— Cloudflare / bot-mitigation interstitial
 *  - `blocked`  — Indeed explicitly blocked us (HTTP error page or 4xx body)
 *  - `empty`    — page loaded successfully, no jobs on it (clean stop signal)
 */
export type PageClass = 'jobs' | 'challenge' | 'blocked' | 'empty';

// ---------------------------------------------------------------------------
// Raw shapes (internal — exported for tests + downstream mappers)
// ---------------------------------------------------------------------------

/** Shape we extract from Indeed's `#mosaic-provider-script` JSON blob. */
export interface MosaicJobCard {
  jobcardUuid?: string;
  title?: string;
  companyName?: string;
  formattedLocation?: string;
  viewJobTitle?: string;
  viewJobLink?: string;
  applyJobUrl?: string;
  indeedApplyEnabled?: boolean;
  relativeDate?: string;
  datePublished?: string;
}

export interface MosaicJobCardsModel {
  jobCards?: MosaicJobCard[];
}

export interface MosaicData {
  mosaicProviderJobCardsModel?: MosaicJobCardsModel;
}

/** Raw DOM extraction result — one entry per `a.jcs-JobTitle[href]` link. */
export interface RawDomCard {
  href: string;
  title: string;
  company?: string;
  location?: string;
  postedAt?: string;
}

/** Result envelope returned by `parseSearchPage`. */
export interface ParseResult {
  /** Which parser produced the jobs. `'none'` means page classified but yielded zero. */
  source: 'mosaic' | 'dom' | 'none';
  jobs: NormalizedJob[];
}

// ---------------------------------------------------------------------------
// PersistentPage — minimal Playwright Page subset the skill depends on
// ---------------------------------------------------------------------------

/**
 * Subset of Playwright's `Page` we actually touch. Modeling it as a structural
 * type (instead of importing `Page` directly) lets the unit tests mock the
 * browser surface with plain objects instead of spinning up a real Chromium.
 *
 * Any real Playwright `Page` is structurally assignable to `PersistentPage`
 * because the methods we declare here all exist on `Page` with compatible
 * signatures.
 */
export interface PersistentPage {
  goto(
    url: string,
    opts?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' },
  ): Promise<{
    status(): number;
    ok(): boolean;
  } | null>;
  $(selector: string): Promise<ElementHandle | null>;
  $$(selector: string): Promise<ElementHandle[]>;
  evaluate<T>(fn: () => T): Promise<T>;
  content(): Promise<string>;
  close(): Promise<void>;
}