/**
 * Dual parser for Indeed.cl search results (SPEC-ID-004).
 *
 * - Primary: parse the JSON blob embedded in `<script id="mosaic-provider-script">`
 *   (with `#mosaic-data` as a fallback selector — see design open question).
 * - Fallback: walk DOM `a.jcs-JobTitle` cards and their sibling data-testid spans.
 *
 * Mosaic JSON is preferred because it includes the stable `jk` directly in
 * `applyJobUrl` (or `viewJobLink`), whereas the DOM requires us to parse a
 * `/rc/clk?jk=…` redirect query string. Both paths funnel through
 * `mapIndeedJob` so the downstream shape is identical.
 *
 * `parseSearchPage` is the orchestrator: mosaic first, DOM only when mosaic
 * is missing / malformed / empty. When the page was classified as `jobs` but
 * neither parser yields any jobs, it throws `FatalSkillError(INDEED_PARSER_INCOMPATIBLE)`
 * per SPEC-ID-007.
 */

import { FatalSkillError } from '@employment-agent/skill-runtime';
import { buildCanonicalUrl, extractJkFromUrl } from './url.js';
import type {
  MosaicData,
  MosaicJobCard,
  NormalizedJob,
  ParseResult,
  PersistentPage,
  PageClass,
  RawDomCard,
} from './types.js';

// ---------------------------------------------------------------------------
// Mosaic JSON path (primary)
// ---------------------------------------------------------------------------

/** Read the raw mosaic JSON text from the page (returns null when missing). */
export async function extractMosaicJson(page: PersistentPage): Promise<unknown> {
  const text = await page.evaluate<unknown>(() => {
    const el =
      document.getElementById('mosaic-provider-script') ??
      document.getElementById('mosaic-data');
    return el?.textContent ?? null;
  });
  if (text == null) return null;
  if (typeof text !== 'string') {
    // Browser-side code may already have parsed the blob; pass it through.
    return text;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Internal: extract the `jobCards` array from a mosaic JSON blob. */
function getMosaicCards(data: unknown): MosaicJobCard[] {
  if (!data || typeof data !== 'object') return [];
  const root = data as MosaicData;
  const cards = root?.mosaicProviderJobCardsModel?.jobCards;
  return Array.isArray(cards) ? cards : [];
}

/**
 * Map one mosaic job card to the shared NormalizedJob shape.
 *
 * Returns `null` when the card lacks the minimum info to be emitted
 * (no title or no extractable `jk`). Malformed cards are silently skipped
 * so a single bad row does not poison the whole page.
 */
export function mapMosaicJobCard(card: unknown): NormalizedJob | null {
  if (!card || typeof card !== 'object') return null;
  const c = card as MosaicJobCard;

  const title = (c.viewJobTitle ?? c.title ?? '').trim();
  if (!title) return null;

  // `applyJobUrl` is the strongest signal (Indeed builds it from `jk`).
  // Fall back to `viewJobLink` for older payloads.
  const jk = extractJkFromUrl(c.applyJobUrl ?? '') ?? extractJkFromUrl(c.viewJobLink ?? '');
  if (!jk) return null;

  return mapIndeedJob({ title, jk, company: c.companyName, location: c.formattedLocation, postedAt: c.relativeDate ?? c.datePublished });
}

/** Internal: enumerate mosaic cards into NormalizedJob[]. */
function mapMosaicJobs(data: unknown): NormalizedJob[] {
  const out: NormalizedJob[] = [];
  for (const card of getMosaicCards(data)) {
    try {
      const job = mapMosaicJobCard(card);
      if (job) out.push(job);
    } catch {
      // Skip malformed card — keep parsing the rest.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOM fallback path
// ---------------------------------------------------------------------------

/**
 * Walk every `a.jcs-JobTitle[href]` card on the page and extract the raw
 * per-card data using `data-testid` siblings.
 *
 * Everything runs inside `page.evaluate` so we only pay one round-trip per
 * page regardless of how many jobs are present.
 */
export async function parseDomCards(page: PersistentPage): Promise<RawDomCard[]> {
  return page.evaluate<RawDomCard[]>(() => {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a.jcs-JobTitle[href]'),
    );
    const out: RawDomCard[] = [];
    for (const link of links) {
      // Walk up to the enclosing card container. Indeed's markup has varied
      // over time — try the explicit `data-testid` first, then fall back
      // to the closest `<li>` or the direct parent.
      const card =
        link.closest('[data-testid="slider_item"]') ??
        link.closest('li') ??
        link.parentElement;

      const href = link.getAttribute('href') ?? '';
      const title = link.textContent?.trim() ?? '';
      if (!href || !title) continue;

      out.push({
        href,
        title,
        company: card?.querySelector('[data-testid="company-name"]')?.textContent?.trim() || undefined,
        location: card?.querySelector('[data-testid="text-location"]')?.textContent?.trim() || undefined,
        postedAt: card?.querySelector('[data-testid="myjobs-unified-Date"]')?.textContent?.trim() || undefined,
      });
    }
    return out;
  });
}

/**
 * Map one raw DOM card to NormalizedJob.
 *
 * Returns `null` when no usable `jk` can be extracted from the href or the
 * title is missing — those rows are silently dropped.
 */
export function mapDomCard(raw: RawDomCard): NormalizedJob | null {
  if (!raw || typeof raw !== 'object') return null;
  const title = (raw.title ?? '').trim();
  if (!title) return null;
  const jk = extractJkFromUrl(raw.href);
  if (!jk) return null;
  return mapIndeedJob({ title, jk, company: raw.company, location: raw.location, postedAt: raw.postedAt });
}

/** Internal: enumerate DOM cards into NormalizedJob[]. */
function mapDomJobs(raw: RawDomCard[]): NormalizedJob[] {
  const out: NormalizedJob[] = [];
  for (const card of raw) {
    try {
      const job = mapDomCard(card);
      if (job) out.push(job);
    } catch {
      // Skip malformed card.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared mapper
// ---------------------------------------------------------------------------

interface RawIndeedJob {
  title: string;
  jk: string;
  company?: string | undefined;
  location?: string | undefined;
  postedAt?: string | undefined;
}

/**
 * Shared normalization used by BOTH the mosaic and DOM paths. Keeps the
 * shape-stability contract in one place.
 *
 * Blank optional fields are OMITTED (never emitted as empty strings) so the
 * downstream job mapper does not have to defend against `company: ''`.
 */
export function mapIndeedJob(raw: RawIndeedJob): NormalizedJob {
  const job: NormalizedJob = {
    externalId: raw.jk,
    title: raw.title,
    url: buildCanonicalUrl(raw.jk),
  };
  const company = raw.company?.trim();
  if (company) job.company = company;
  const location = raw.location?.trim();
  if (location) job.location = location;
  if (raw.postedAt?.trim()) job.postedAt = raw.postedAt.trim();
  return job;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Parse a classified Indeed page into NormalizedJobs.
 *
 * Decision tree:
 *   1. Try mosaic JSON. If it parses AND yields ≥1 job → return `mosaic`.
 *   2. Else try DOM. If it yields ≥1 job → return `dom`.
 *   3. Else:
 *      - If the page was classified as `jobs`, throw FatalSkillError
 *        (`INDEED_PARSER_INCOMPATIBLE`) — we expected jobs and got none.
 *      - Otherwise return `none` with an empty list.
 *
 * SPEC-ID-004 mandates "JSON first, DOM only when JSON absent/unusable" —
 * this is NOT a merge step. SPEC-ID-007 mandates the fatal throw on
 * `jobs`-classified pages.
 */
export async function parseSearchPage(
  page: PersistentPage,
  pageClass: PageClass,
): Promise<ParseResult> {
  const mosaic = await extractMosaicJson(page);
  if (mosaic !== null) {
    const jobs = mapMosaicJobs(mosaic);
    if (jobs.length > 0) {
      return { source: 'mosaic', jobs };
    }
  }

  const rawDom = await parseDomCards(page);
  const jobs = mapDomJobs(rawDom);
  if (jobs.length > 0) {
    return { source: 'dom', jobs };
  }

  if (pageClass === 'jobs') {
    throw new FatalSkillError(
      'Indeed parser could not extract any jobs from a page classified as "jobs"',
      'INDEED_PARSER_INCOMPATIBLE',
    );
  }

  return { source: 'none', jobs: [] };
}