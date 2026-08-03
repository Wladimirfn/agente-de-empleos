import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FatalSkillError, TransientSkillError } from '@employment-agent/skill-runtime';
import type { CandidateProfile } from '@employment-agent/domain';

vi.mock('playwright', () => ({
  chromium: {
    launchPersistentContext: vi.fn(),
  },
}));

import { chromium } from 'playwright';

import {
  BASE_URL,
  PROFILE_DIR,
  PAGE_SIZE,
  MAX_PAGES_PER_QUERY,
  MAX_QUERIES,
  MAX_CHALLENGE_RETRIES,
  DEFAULT_QUERIES,
  DEFAULT_USER_AGENT,
  buildQueries,
  buildSearchUrl,
  buildCanonicalUrl,
  extractJkFromUrl,
  backoffMs,
  backoffBounds,
  classifyPage,
  hasJobsMarker,
  isChallengeMarker,
  isBlockedMarker,
  extractMosaicJson,
  parseDomCards,
  parseSearchPage,
  mapMosaicJobCard,
  mapDomCard,
  mapIndeedJob,
  openPersistentContext,
  resolveHeadless,
  resolveProfileDir,
  scanIndeed,
  scanWithPersistentContext,
  selfCheck,
  SELF_CHECK_URL,
  indeedSkill,
  INDEED_SKILL_VERSION,
  type PersistentContextHandle,
  type ScanHooks,
  type SelfCheckHooks,
  type PersistentPage,
  type RawDomCard,
  type NormalizedJob,
} from './index.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, 'tests', 'fixtures');
const MOSAIC_HTML = readFileSync(resolve(FIXTURES, 'mosaic-page.html'), 'utf8');
const DOM_HTML = readFileSync(resolve(FIXTURES, 'dom-only-page.html'), 'utf8');
const CHALLENGE_HTML = readFileSync(resolve(FIXTURES, 'challenge-page.html'), 'utf8');

// ---------------------------------------------------------------------------
// Test helpers — mock PersistentPage
// ---------------------------------------------------------------------------

interface MockPageOptions {
  /** HTML returned by `page.content()`. */
  html?: string;
  /**
   * Pre-scripted return values for `page.evaluate` calls. Consumed FIFO.
   * Each call to `page.evaluate` advances the cursor.
   */
  evaluates?: unknown[];
}

function makePage(opts: MockPageOptions = {}): PersistentPage {
  let evalIdx = 0;
  const evaluates = opts.evaluates ?? [];
  return {
    content: vi.fn(async () => opts.html ?? ''),
    evaluate: vi.fn(async <T,>(_fn: () => T): Promise<T> => evaluates[evalIdx++] as T),
    goto: vi.fn(async () => null),
    $: vi.fn(async () => null),
    $$: vi.fn(async () => []),
    close: vi.fn(async () => undefined),
  } as PersistentPage;
}

/**
 * Re-implements the same DOM marker check `hasJobsMarker` runs in-browser,
 * so test mocks don't have to actually execute the evaluate fn. Returns
 * the boolean the in-browser `hasJobsMarker` would have returned.
 */
function detectJobsMarker(html: string): boolean {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
  // Cheap DOM check: `<a class="jcs-JobTitle"` link present?
  if (/<a\b[^>]*?\bclass="[^"]*\bjcs-JobTitle\b[^"]*"[^>]*?\bhref=/.test(stripped)) {
    return true;
  }
  // Cheap JSON check: a parseable `#mosaic-provider-script` blob with cards?
  const m = stripped.match(/<script\b[^>]*?\bid="mosaic-provider-script"[^>]*>([\s\S]*?)<\/script>/);
  if (m?.[1]) {
    try {
      const parsed = JSON.parse(m[1]) as {
        mosaicProviderJobCardsModel?: { jobCards?: unknown[] };
      };
      const cards = parsed?.mosaicProviderJobCardsModel?.jobCards;
      return Array.isArray(cards) && cards.length > 0;
    } catch {
      return false;
    }
  }
  // Also try #mosaic-data fallback
  const m2 = stripped.match(/<script\b[^>]*?\bid="mosaic-data"[^>]*>([\s\S]*?)<\/script>/);
  if (m2?.[1]) {
    try {
      const parsed = JSON.parse(m2[1]) as {
        mosaicProviderJobCardsModel?: { jobCards?: unknown[] };
      };
      const cards = parsed?.mosaicProviderJobCardsModel?.jobCards;
      return Array.isArray(cards) && cards.length > 0;
    } catch {
      return false;
    }
  }
  return false;
}

/** Pull the mosaic JSON blob out of a fixture for use as a `page.evaluate` response. */
function mosaicJsonFromHtml(html: string): unknown | null {
  // Strip HTML comments first — the regex would otherwise match a `<script
  // id="…">` literal that appears inside a comment in our fixtures.
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
  const m = stripped.match(/<script\b[^>]*?\bid="mosaic-provider-script"[^>]*>([\s\S]*?)<\/script>/);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('exposes the documented defaults', () => {
    expect(BASE_URL).toBe('https://cl.indeed.com');
    expect(PROFILE_DIR).toBe('storage/indeed-profile');
    expect(PAGE_SIZE).toBe(10);
    expect(MAX_PAGES_PER_QUERY).toBe(3);
    expect(MAX_QUERIES).toBe(3);
    expect(MAX_CHALLENGE_RETRIES).toBe(3);
    expect(DEFAULT_QUERIES).toEqual(['mantención', 'refrigeración']);
    expect(DEFAULT_USER_AGENT).toContain('Mozilla/5.0');
  });
});

// ---------------------------------------------------------------------------
// buildQueries
// ---------------------------------------------------------------------------

describe('buildQueries', () => {
  it('falls back to defaults when profile has no skills', () => {
    expect(buildQueries({} as CandidateProfile)).toEqual(['mantención', 'refrigeración']);
  });

  it('uses profile skills when available, deduped and trimmed', () => {
    const profile: CandidateProfile = {
      skills: [{ name: 'Refrigeración' }, { name: ' refrigeración ' }, { name: 'Electricidad' }],
    };
    expect(buildQueries(profile)).toEqual(['Refrigeración', 'refrigeración', 'Electricidad']);
  });

  it('caps the number of queries at MAX_QUERIES', () => {
    const profile: CandidateProfile = {
      skills: ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeee', 'ffff'].map((name) => ({ name })),
    };
    const qs = buildQueries(profile);
    expect(qs).toHaveLength(MAX_QUERIES);
    expect(qs).toEqual(['aaaa', 'bbbb', 'cccc']);
  });
});

// ---------------------------------------------------------------------------
// buildSearchUrl (SPEC-ID-006 / RED #8)
// ---------------------------------------------------------------------------

describe('buildSearchUrl', () => {
  it('builds the start=0 page', () => {
    expect(buildSearchUrl('mantención', 0)).toBe(`${BASE_URL}/jobs?q=mantenci%C3%B3n&start=0`);
  });

  it('builds the start=10 and start=20 pages (SPEC-ID-006)', () => {
    expect(buildSearchUrl('mantención', 10)).toBe(`${BASE_URL}/jobs?q=mantenci%C3%B3n&start=10`);
    expect(buildSearchUrl('mantención', 20)).toBe(`${BASE_URL}/jobs?q=mantenci%C3%B3n&start=20`);
  });

  it('every emitted URL starts with BASE_URL (threat-matrix: nav whitelist)', () => {
    for (const offset of [0, 10, 20, 30, 100]) {
      expect(buildSearchUrl('mantención', offset).startsWith(BASE_URL)).toBe(true);
    }
  });

  it('rejects empty / whitespace-only queries', () => {
    expect(() => buildSearchUrl('', 0)).toThrow(/non-empty/);
    expect(() => buildSearchUrl('   ', 0)).toThrow(/non-empty/);
  });

  it('rejects empty / whitespace-only queries with FatalSkillError(INDEED_CONFIG_INVALID)', () => {
    // sdd-verify / RED #11-followup: caller-input failures must surface as
    // classified `FatalSkillError`s, not plain `Error`s.
    expect(() => buildSearchUrl('', 0)).toThrow(FatalSkillError);
    expect(() => buildSearchUrl('   ', 0)).toThrow(FatalSkillError);
    try {
      buildSearchUrl('', 0);
    } catch (err) {
      expect(err).toBeInstanceOf(FatalSkillError);
      expect((err as FatalSkillError).code).toBe('INDEED_CONFIG_INVALID');
      expect((err as FatalSkillError).message).toMatch(/non-empty/);
    }
  });

  it('rejects negative offsets', () => {
    expect(() => buildSearchUrl('foo', -1)).toThrow(/non-negative/);
  });

  it('rejects negative offsets with FatalSkillError(INDEED_CONFIG_INVALID)', () => {
    expect(() => buildSearchUrl('foo', -1)).toThrow(FatalSkillError);
    try {
      buildSearchUrl('foo', -1);
    } catch (err) {
      expect(err).toBeInstanceOf(FatalSkillError);
      expect((err as FatalSkillError).code).toBe('INDEED_CONFIG_INVALID');
      expect((err as FatalSkillError).message).toMatch(/non-negative/);
    }
  });

  it('floors fractional offsets to integers', () => {
    expect(buildSearchUrl('foo', 10.7)).toBe(`${BASE_URL}/jobs?q=foo&start=10`);
  });
});

// ---------------------------------------------------------------------------
// buildCanonicalUrl (SPEC-ID-005 / RED #7)
// ---------------------------------------------------------------------------

describe('buildCanonicalUrl', () => {
  it('returns the viewjob?jk= form for a plain jk', () => {
    expect(buildCanonicalUrl('abc123')).toBe(`${BASE_URL}/viewjob?jk=abc123`);
  });

  it('returns the viewjob?jk= form for a 16-char jk (RED #7)', () => {
    expect(buildCanonicalUrl('abc123def456ghi7')).toBe(
      `${BASE_URL}/viewjob?jk=abc123def456ghi7`,
    );
  });

  it('rejects empty jk values', () => {
    expect(() => buildCanonicalUrl('')).toThrow(/non-empty/);
    expect(() => buildCanonicalUrl('   ')).toThrow(/non-empty/);
  });

  it('rejects empty jk values with FatalSkillError(INDEED_CONFIG_INVALID)', () => {
    // sdd-verify / RED #11-followup: caller-input failures must surface as
    // classified `FatalSkillError`s, not plain `Error`s.
    expect(() => buildCanonicalUrl('')).toThrow(FatalSkillError);
    expect(() => buildCanonicalUrl('   ')).toThrow(FatalSkillError);
    try {
      buildCanonicalUrl('');
    } catch (err) {
      expect(err).toBeInstanceOf(FatalSkillError);
      expect((err as FatalSkillError).code).toBe('INDEED_CONFIG_INVALID');
      expect((err as FatalSkillError).message).toMatch(/non-empty/);
    }
  });

  it('URL-encodes the jk', () => {
    expect(buildCanonicalUrl('a/b c')).toBe(`${BASE_URL}/viewjob?jk=a%2Fb%20c`);
  });
});

// ---------------------------------------------------------------------------
// extractJkFromUrl (RED #6)
// ---------------------------------------------------------------------------

describe('extractJkFromUrl', () => {
  it('extracts jk from a relative /rc/clk URL (RED #6)', () => {
    expect(extractJkFromUrl('/rc/clk?jk=abc123&from=serp')).toBe('abc123');
  });

  it('extracts jk from an absolute https URL', () => {
    expect(
      extractJkFromUrl('https://cl.indeed.com/rc/clk?jk=abc123&from=serp&vjk=1'),
    ).toBe('abc123');
  });

  it('returns null when no jk is present', () => {
    expect(extractJkFromUrl('/some/page?foo=bar')).toBeNull();
  });

  it('returns null when the URL is malformed', () => {
    expect(extractJkFromUrl('not a url at all')).toBeNull();
  });

  it('returns null for non-Indeed hostnames (threat-matrix: nav whitelist)', () => {
    expect(extractJkFromUrl('https://evil.example.com/rc/clk?jk=abc123')).toBeNull();
  });

  it('returns null for empty / whitespace / non-string inputs', () => {
    expect(extractJkFromUrl('')).toBeNull();
    expect(extractJkFromUrl('   ')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// backoffMs / backoffBounds (SPEC-ID-003)
// ---------------------------------------------------------------------------

describe('backoffMs', () => {
  it('attempt 0 lands in [2000, 3000)', () => {
    for (let i = 0; i < 50; i++) {
      const ms = backoffMs(0);
      expect(ms).toBeGreaterThanOrEqual(2000);
      expect(ms).toBeLessThan(3000);
    }
  });

  it('attempt 2 lands in [8000, 9000)', () => {
    for (let i = 0; i < 50; i++) {
      const ms = backoffMs(2);
      expect(ms).toBeGreaterThanOrEqual(8000);
      expect(ms).toBeLessThan(9000);
    }
  });

  it('monotonically increases by ~2x per attempt (jitter-free upper bound)', () => {
    // The base doubles each attempt (jitter is a fixed [+0, +1000) addend,
    // so the BASE itself grows by 2x, and the upper bound inherits +1000).
    const a0 = backoffBounds(0).min;
    const a1 = backoffBounds(1).min;
    const a2 = backoffBounds(2).min;
    expect(a1).toBe(a0 * 2);
    expect(a2).toBe(a1 * 2);

    // Upper bounds track the same doubling + the constant jitter window.
    expect(backoffBounds(0).max).toBe(2000 + 1000);
    expect(backoffBounds(1).max).toBe(4000 + 1000);
    expect(backoffBounds(2).max).toBe(8000 + 1000);
  });

  it('is deterministic when given a fixed rand', () => {
    expect(backoffMs(0, () => 0)).toBe(2000);
    expect(backoffMs(0, () => 0.9999)).toBe(2999);
    expect(backoffMs(2, () => 0.5)).toBe(8000 + 500);
  });

  it('collapses invalid attempts to attempt=0 (total function)', () => {
    expect(backoffBounds(-1)).toEqual({ min: 2000, max: 3000 });
    expect(backoffBounds(Number.NaN)).toEqual({ min: 2000, max: 3000 });
  });
});

// ---------------------------------------------------------------------------
// Classifier (SPEC-ID-002 / RED #3)
// ---------------------------------------------------------------------------

describe('isChallengeMarker', () => {
  it('detects Cloudflare interstitial markers', () => {
    expect(isChallengeMarker(CHALLENGE_HTML)).toBe(true);
    expect(isChallengeMarker('<html><title>Just a moment...</title></html>')).toBe(true);
    expect(isChallengeMarker('<html cf-mitigated="true"></html>')).toBe(true);
  });

  it('does not flag a normal search page', () => {
    expect(isChallengeMarker(MOSAIC_HTML)).toBe(false);
    expect(isChallengeMarker(DOM_HTML)).toBe(false);
  });
});

describe('isBlockedMarker', () => {
  it('detects Indeed error page markers', () => {
    expect(isBlockedMarker('<html>Access Denied</html>')).toBe(true);
    expect(isBlockedMarker('<html>HTTP 403 forbidden</html>')).toBe(true);
    expect(isBlockedMarker('<html>Indeed has blocked your IP</html>')).toBe(true);
  });

  it('does not flag a normal search page', () => {
    expect(isBlockedMarker(MOSAIC_HTML)).toBe(false);
  });
});

describe('classifyPage', () => {
  it('classifies a challenge page as "challenge", NOT "empty" (RED #3, SPEC-ID-002)', async () => {
    // Challenge check runs first via cheap text scan — no evaluate calls.
    const page = makePage({ html: CHALLENGE_HTML });
    expect(await classifyPage(page)).toBe('challenge');
  });

  it('classifies a blocked page as "blocked"', async () => {
    const page = makePage({ html: '<html><body>Access Denied — Indeed</body></html>' });
    expect(await classifyPage(page)).toBe('blocked');
  });

  it('classifies a mosaic page as "jobs"', async () => {
    const page = makePage({
      html: MOSAIC_HTML,
      evaluates: [detectJobsMarker(MOSAIC_HTML)],
    });
    expect(await classifyPage(page)).toBe('jobs');
  });

  it('classifies a dom-only page as "jobs"', async () => {
    const page = makePage({
      html: DOM_HTML,
      evaluates: [detectJobsMarker(DOM_HTML)],
    });
    expect(await classifyPage(page)).toBe('jobs');
  });

  it('classifies a page with no markers as "empty"', async () => {
    const page = makePage({
      html: '<html><body>No results found.</body></html>',
      evaluates: [false],
    });
    expect(await classifyPage(page)).toBe('empty');
  });

  it('is idempotent (calling twice yields the same result)', async () => {
    const page = makePage({
      html: CHALLENGE_HTML,
      evaluates: [],
    });
    expect(await classifyPage(page)).toBe('challenge');
    expect(await classifyPage(page)).toBe('challenge');
  });
});

describe('hasJobsMarker', () => {
  it('returns true when DOM cards are present', async () => {
    const page = makePage({ html: DOM_HTML, evaluates: [true] });
    expect(await hasJobsMarker(page)).toBe(true);
  });

  it('returns true when mosaic JSON with cards is present', async () => {
    const page = makePage({ html: MOSAIC_HTML, evaluates: [true] });
    expect(await hasJobsMarker(page)).toBe(true);
  });

  it('returns false when neither marker is present', async () => {
    const page = makePage({ html: '<html></html>', evaluates: [false] });
    expect(await hasJobsMarker(page)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mosaic parser
// ---------------------------------------------------------------------------

describe('extractMosaicJson', () => {
  it('returns the parsed JSON blob from #mosaic-provider-script', async () => {
    const json = mosaicJsonFromHtml(MOSAIC_HTML);
    const page = makePage({ evaluates: [json] });
    const out = await extractMosaicJson(page);
    expect(out).not.toBeNull();
    const cards = (out as { mosaicProviderJobCardsModel: { jobCards: unknown[] } })
      .mosaicProviderJobCardsModel.jobCards;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards.length).toBe(4);
  });

  it('returns null when the script tag is missing (null textContent)', async () => {
    const page = makePage({ evaluates: [null] });
    expect(await extractMosaicJson(page)).toBeNull();
  });

  it('returns null when the JSON is malformed', async () => {
    const page = makePage({ evaluates: ['{not valid json}'] });
    expect(await extractMosaicJson(page)).toBeNull();
  });
});

describe('mapMosaicJobCard', () => {
  const baseCard = {
    viewJobTitle: 'Téc. Mantención',
    applyJobUrl: 'https://cl.indeed.com/rc/clk?jk=abc123&from=serp',
    companyName: 'ACME',
    formattedLocation: 'Santiago',
    relativeDate: 'hace 1 día',
  };

  it('maps a full mosaic card to NormalizedJob', () => {
    const job = mapMosaicJobCard(baseCard);
    expect(job).toEqual({
      externalId: 'abc123',
      title: 'Téc. Mantención',
      url: `${BASE_URL}/viewjob?jk=abc123`,
      company: 'ACME',
      location: 'Santiago',
      postedAt: 'hace 1 día',
    });
  });

  it('falls back to viewJobLink when applyJobUrl is missing', () => {
    const job = mapMosaicJobCard({
      viewJobTitle: 'Other',
      viewJobLink: 'https://cl.indeed.com/viewjob?jk=other001',
    });
    expect(job?.externalId).toBe('other001');
  });

  it('falls back to `title` when `viewJobTitle` is missing', () => {
    const job = mapMosaicJobCard({
      title: 'Plain title',
      applyJobUrl: 'https://cl.indeed.com/rc/clk?jk=plain001',
    });
    expect(job?.title).toBe('Plain title');
  });

  it('returns null when no jk can be extracted', () => {
    expect(mapMosaicJobCard({ viewJobTitle: 'No jk', applyJobUrl: '/rc/clk' })).toBeNull();
    expect(mapMosaicJobCard({ viewJobTitle: 'No jk' })).toBeNull();
  });

  it('returns null when title is missing', () => {
    expect(
      mapMosaicJobCard({ applyJobUrl: 'https://cl.indeed.com/rc/clk?jk=foo' }),
    ).toBeNull();
  });

  it('omits blank optional fields (never emits empty strings)', () => {
    const job = mapMosaicJobCard({
      viewJobTitle: 'Téc',
      applyJobUrl: 'https://cl.indeed.com/rc/clk?jk=foo',
      companyName: '   ',
      formattedLocation: '',
      relativeDate: '  ',
    });
    expect(job).toEqual({
      externalId: 'foo',
      title: 'Téc',
      url: `${BASE_URL}/viewjob?jk=foo`,
    });
    expect(job && 'company' in job).toBe(false);
    expect(job && 'location' in job).toBe(false);
    expect(job && 'postedAt' in job).toBe(false);
  });

  it('returns null for non-object input', () => {
    expect(mapMosaicJobCard(null)).toBeNull();
    expect(mapMosaicJobCard(undefined)).toBeNull();
    expect(mapMosaicJobCard('string')).toBeNull();
    expect(mapMosaicJobCard(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DOM parser
// ---------------------------------------------------------------------------

describe('parseDomCards', () => {
  it('extracts raw DOM cards (mocked evaluate)', async () => {
    const cards: RawDomCard[] = [
      {
        href: '/rc/clk?jk=dom111aaa&from=serp',
        title: 'Técnico Eléctrico',
        company: 'DomEmpresa Uno',
        location: 'Santiago',
        postedAt: 'hace 2 días',
      },
    ];
    const page = makePage({ evaluates: [cards] });
    expect(await parseDomCards(page)).toEqual(cards);
  });

  it('returns an empty array when no cards match', async () => {
    const page = makePage({ evaluates: [[]] });
    expect(await parseDomCards(page)).toEqual([]);
  });
});

describe('mapDomCard', () => {
  it('maps a full DOM card to NormalizedJob', () => {
    const job = mapDomCard({
      href: '/rc/clk?jk=dom111aaa&from=serp',
      title: 'Técnico Eléctrico',
      company: 'DomEmpresa Uno',
      location: 'Santiago',
      postedAt: 'hace 2 días',
    });
    expect(job).toEqual({
      externalId: 'dom111aaa',
      title: 'Técnico Eléctrico',
      url: `${BASE_URL}/viewjob?jk=dom111aaa`,
      company: 'DomEmpresa Uno',
      location: 'Santiago',
      postedAt: 'hace 2 días',
    });
  });

  it('returns null when jk cannot be extracted', () => {
    expect(mapDomCard({ href: '/some/other', title: 'X' })).toBeNull();
  });

  it('returns null when title is blank', () => {
    expect(mapDomCard({ href: '/rc/clk?jk=foo', title: '   ' })).toBeNull();
  });

  it('omits undefined optional fields', () => {
    const job = mapDomCard({ href: '/rc/clk?jk=foo', title: 'Téc' });
    expect(job).toEqual({
      externalId: 'foo',
      title: 'Téc',
      url: `${BASE_URL}/viewjob?jk=foo`,
    });
  });

  it('returns null for null / undefined / non-object input', () => {
    expect(mapDomCard(null as unknown as RawDomCard)).toBeNull();
    expect(mapDomCard(undefined as unknown as RawDomCard)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapIndeedJob — shared mapper contract
// ---------------------------------------------------------------------------

describe('mapIndeedJob', () => {
  it('builds canonical url from jk', () => {
    expect(mapIndeedJob({ title: 'X', jk: 'foo' })).toEqual({
      externalId: 'foo',
      title: 'X',
      url: `${BASE_URL}/viewjob?jk=foo`,
    });
  });

  it('strips blank optional fields', () => {
    const job = mapIndeedJob({ title: 'X', jk: 'foo', company: '', location: '   ' });
    expect('company' in job).toBe(false);
    expect('location' in job).toBe(false);
    expect(job.postedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseSearchPage orchestrator (SPEC-ID-004 / RED #1, #2, #13)
// ---------------------------------------------------------------------------

describe('parseSearchPage', () => {
  it('returns mosaic jobs when the mosaic blob has cards (RED #1 — primary wins)', async () => {
    const json = mosaicJsonFromHtml(MOSAIC_HTML);
    const page = makePage({ evaluates: [json] });

    const result = await parseSearchPage(page, 'jobs');
    expect(result.source).toBe('mosaic');
    // 4 cards in the fixture, 3 have a usable jk, 1 is malformed → 3 jobs.
    expect(result.jobs).toHaveLength(3);
    const ids = result.jobs.map((j) => j.externalId);
    expect(ids).toContain('abc123def456');
    expect(ids).toContain('987fed654cba');
    expect(ids).toContain('el3ctr1c0');
    expect(ids).not.toContain('dom01dom01dom'); // DOM row ignored — mosaic wins
  });

  it('canonical URLs are always viewjob?jk=… (RED #7 cross-check)', async () => {
    const json = mosaicJsonFromHtml(MOSAIC_HTML);
    const page = makePage({ evaluates: [json] });

    const result = await parseSearchPage(page, 'jobs');
    for (const job of result.jobs) {
      expect(job.url.startsWith(`${BASE_URL}/viewjob?jk=`)).toBe(true);
      expect(job.url).not.toContain('/rc/clk');
    }
  });

  it('falls back to DOM only when mosaic is missing (RED #2)', async () => {
    // First evaluate: mosaic extract → null
    // Second evaluate: DOM cards
    const domCards: RawDomCard[] = [
      {
        href: '/rc/clk?jk=dom111aaa&from=serp',
        title: 'Técnico Eléctrico',
        company: 'DomEmpresa Uno',
        location: 'Santiago',
        postedAt: 'hace 2 días',
      },
      {
        href: '/rc/clk?jk=dom222bbb&from=serp',
        title: 'Operario Mantención',
        company: 'DomEmpresa Dos',
        location: 'Antofagasta',
        postedAt: 'Hoy',
      },
    ];
    const page = makePage({ evaluates: [null, domCards] });

    const result = await parseSearchPage(page, 'jobs');
    expect(result.source).toBe('dom');
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]?.externalId).toBe('dom111aaa');
    expect(result.jobs[1]?.externalId).toBe('dom222bbb');
  });

  it('falls back to DOM only when mosaic JSON is malformed (RED #2)', async () => {
    const domCards: RawDomCard[] = [
      {
        href: '/rc/clk?jk=foo&from=serp',
        title: 'Téc',
        company: 'Co',
        location: 'Loc',
      },
    ];
    const page = makePage({ evaluates: ['{broken json}', domCards] });

    const result = await parseSearchPage(page, 'jobs');
    expect(result.source).toBe('dom');
    expect(result.jobs).toHaveLength(1);
  });

  it('falls back to DOM when mosaic blob exists but has zero usable cards (RED #2)', async () => {
    // Mosaic JSON with an empty cards list — DOM should be tried.
    const emptyMosaic = { mosaicProviderJobCardsModel: { jobCards: [] } };
    const domCards: RawDomCard[] = [
      { href: '/rc/clk?jk=foo&from=serp', title: 'Téc', company: 'Co', location: 'Loc' },
    ];
    const page = makePage({ evaluates: [emptyMosaic, domCards] });

    const result = await parseSearchPage(page, 'jobs');
    expect(result.source).toBe('dom');
    expect(result.jobs).toHaveLength(1);
  });

  it('does NOT merge — mosaic wins when it yields ≥1 job (RED #1)', async () => {
    const json = mosaicJsonFromHtml(MOSAIC_HTML);
    // Even if DOM would also yield jobs, mosaic wins — DOM evaluate must
    // not be called at all in this branch.
    const domCards: RawDomCard[] = [
      { href: '/rc/clk?jk=foo&from=serp', title: 'Téc', company: 'Co', location: 'Loc' },
    ];
    const page = makePage({ evaluates: [json] });

    const result = await parseSearchPage(page, 'jobs');
    expect(result.source).toBe('mosaic');
    // The DOM evaluate must NOT have been called — there were only 1 evaluate
    // return value scripted.
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    // Sanity: domCards is not touched.
    expect(domCards).toHaveLength(1);
  });

  it('returns source:"none" with empty jobs when pageClass is "empty"', async () => {
    const page = makePage({ evaluates: [null, []] });

    const result = await parseSearchPage(page, 'empty');
    expect(result.source).toBe('none');
    expect(result.jobs).toEqual([]);
  });

  it('throws FatalSkillError(INDEED_PARSER_INCOMPATIBLE) when pageClass is "jobs" but no parser yields jobs (RED #13)', async () => {
    // Mosaic missing, DOM returns empty → page was classified as "jobs" but
    // we got nothing → fatal. Two page instances because each parseSearchPage
    // call consumes evaluate slots.
    const page1 = makePage({ evaluates: [null, []] });
    const page2 = makePage({ evaluates: [null, []] });

    await expect(parseSearchPage(page1, 'jobs')).rejects.toBeInstanceOf(FatalSkillError);
    await expect(parseSearchPage(page2, 'jobs')).rejects.toMatchObject({
      kind: 'fatal_skill',
      code: 'INDEED_PARSER_INCOMPATIBLE',
    });
  });

  it('parseSearchPage is type-safe on the NormalizedJob shape', async () => {
    const json = mosaicJsonFromHtml(MOSAIC_HTML);
    const page = makePage({ evaluates: [json] });

    const result = await parseSearchPage(page, 'jobs');
    const sample: NormalizedJob = result.jobs[0]!;
    expect(typeof sample.externalId).toBe('string');
    expect(typeof sample.title).toBe('string');
    expect(typeof sample.url).toBe('string');
    expect(sample.url.startsWith(`${BASE_URL}/viewjob?jk=`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: full parser lib on the fixtures (parseSearchPage + classifyPage)
// ---------------------------------------------------------------------------

describe('integration: classifier + parser against real fixtures', () => {
  it('mosaic-page.html classifies as "jobs" and parses via mosaic', async () => {
    const json = mosaicJsonFromHtml(MOSAIC_HTML);
    // classifyPage → hasJobsMarker (1 evaluate)
    // parseSearchPage → extractMosaicJson (1 evaluate)
    const page = makePage({
      html: MOSAIC_HTML,
      evaluates: [detectJobsMarker(MOSAIC_HTML), json],
    });

    expect(await classifyPage(page)).toBe('jobs');
    const result = await parseSearchPage(page, 'jobs');
    expect(result.source).toBe('mosaic');
    expect(result.jobs.length).toBeGreaterThan(0);
  });

  it('dom-only-page.html classifies as "jobs" and parses via DOM fallback', async () => {
    const domCards: RawDomCard[] = [
      {
        href: '/rc/clk?jk=dom111aaa&from=serp',
        title: 'Técnico Eléctrico',
        company: 'DomEmpresa Uno',
        location: 'Santiago',
        postedAt: 'hace 2 días',
      },
      {
        href: '/rc/clk?jk=dom222bbb&from=serp',
        title: 'Operario Mantención',
        company: 'DomEmpresa Dos',
        location: 'Antofagasta',
        postedAt: 'Hoy',
      },
    ];
    const page = makePage({
      html: DOM_HTML,
      evaluates: [detectJobsMarker(DOM_HTML), null, domCards],
    });

    expect(await classifyPage(page)).toBe('jobs');
    const result = await parseSearchPage(page, 'jobs');
    expect(result.source).toBe('dom');
    expect(result.jobs).toHaveLength(2);
  });

  it('challenge-page.html classifies as "challenge" — never reaches the parser', async () => {
    const page = makePage({ html: CHALLENGE_HTML, evaluates: [] });

    expect(await classifyPage(page)).toBe('challenge');
    // classifyPage never calls evaluate for a challenge — text scan short-circuits.
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Unit 2 — Persistent context launch (TASK-301)
// ===========================================================================

describe('resolveProfileDir / resolveHeadless (pure)', () => {
  it('resolveProfileDir defaults to PROFILE_DIR resolved against cwd', () => {
    expect(resolveProfileDir('/work')).toBe(resolve('/work', PROFILE_DIR));
  });

  it('resolveProfileDir honors an explicit override (absolute or relative)', () => {
    expect(resolveProfileDir('/work', 'storage/custom')).toBe(
      resolve('/work', 'storage/custom'),
    );
    // Absolute override pinned against cwd's root: behaviour depends on the
    // host OS's `path.resolve` rules — we only assert that the override is
    // resolved (begins with the absolute-segment portion that survives on
    // the current platform).
    const absOverride = resolve('/work', 'absolute-anchored');
    expect(resolveProfileDir('/work', absOverride)).toBe(absOverride);
  });

  it('resolveHeadless defaults to true when env is unset / unrelated', () => {
    expect(resolveHeadless({} as NodeJS.ProcessEnv)).toBe(true);
    expect(resolveHeadless({ INDEED_HEADLESS: undefined } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(resolveHeadless({ INDEED_HEADLESS: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('resolveHeadless flips to false when INDEED_HEADLESS="false" (RED #11)', () => {
    expect(resolveHeadless({ INDEED_HEADLESS: 'false' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveHeadless({ INDEED_HEADLESS: 'FALSE' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveHeadless({ INDEED_HEADLESS: '0' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveHeadless({ INDEED_HEADLESS: 'no' } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it('resolveHeadless explicit override wins over env', () => {
    expect(
      resolveHeadless({ INDEED_HEADLESS: 'false' } as unknown as NodeJS.ProcessEnv, true),
    ).toBe(true);
    expect(
      resolveHeadless({ INDEED_HEADLESS: 'true' } as unknown as NodeJS.ProcessEnv, false),
    ).toBe(false);
  });
});

describe('openPersistentContext', () => {
  /**
   * Build a minimal fake BrowserContext. `chromium.launchPersistentContext`
   * returns the `BrowserContext` directly (NOT a `Browser` wrapper — that is
   * the API difference vs `chromium.launch`).
   */
  function makeMockContext(page: PersistentPage) {
    return {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
  }

  it('calls chromium.launchPersistentContext with PROFILE_DIR + headless:true by default (RED #11)', async () => {
    vi.clearAllMocks();
    const page = makePage();
    const ctx = makeMockContext(page);
    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(ctx as never);

    const handle = await openPersistentContext();
    expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);
    const args = vi.mocked(chromium.launchPersistentContext).mock.calls[0]!;
    const [userDataDir, opts] = args;
    // userDataDir is the absolute path of PROFILE_DIR relative to cwd.
    expect(userDataDir).toBe(resolveProfileDir(process.cwd()));
    expect(opts?.headless).toBe(true);
    expect(opts?.userAgent).toBe(DEFAULT_USER_AGENT);

    expect(handle.page).toBe(page);
    expect(ctx.newPage).toHaveBeenCalledTimes(1);
    expect(ctx.close).not.toHaveBeenCalled();
  });

  it('uses headless:false when INDEED_HEADLESS=false (RED #11)', async () => {
    vi.clearAllMocks();
    const prev = process.env.INDEED_HEADLESS;
    process.env.INDEED_HEADLESS = 'false';
    try {
      vi.mocked(chromium.launchPersistentContext).mockResolvedValue(
        makeMockContext(makePage()) as never,
      );

      await openPersistentContext();
      const opts = vi.mocked(chromium.launchPersistentContext).mock.calls[0]?.[1];
      expect(opts?.headless).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.INDEED_HEADLESS;
      else process.env.INDEED_HEADLESS = prev;
    }
  });

  it('honors an explicit headless override (RED #11)', async () => {
    vi.clearAllMocks();
    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(
      makeMockContext(makePage()) as never,
    );

    await openPersistentContext({ headless: false });
    const opts = vi.mocked(chromium.launchPersistentContext).mock.calls[0]?.[1];
    expect(opts?.headless).toBe(false);

    await openPersistentContext({ headless: true });
    const opts2 = vi.mocked(chromium.launchPersistentContext).mock.calls[1]?.[1];
    expect(opts2?.headless).toBe(true);
  });

  it('honors a custom profileDir override', async () => {
    vi.clearAllMocks();
    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(
      makeMockContext(makePage()) as never,
    );

    const cwd = process.cwd();
    await openPersistentContext({ profileDir: 'storage/alt-profile' });
    const userDataDir = vi.mocked(chromium.launchPersistentContext).mock.calls[0]?.[0];
    expect(userDataDir).toBe(join(cwd, 'storage', 'alt-profile'));
  });

  it('the returned handle exposes a page wired to the persistent context', async () => {
    vi.clearAllMocks();
    const page = makePage();
    const ctx = makeMockContext(page);
    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(ctx as never);

    const handle: PersistentContextHandle = await openPersistentContext();
    expect(handle.context).toBe(ctx);
    expect(handle.page).toBe(page);
    expect(typeof (handle.page as { goto: unknown }).goto).toBe('function');
  });

  it('chromium.launchPersistentContext returning a falsy value throws immediately', async () => {
    vi.clearAllMocks();
    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(null as never);
    await expect(openPersistentContext()).rejects.toThrow(/launchPersistentContext/);
  });

  it('a null launch throws FatalSkillError(INDEED_LAUNCH_FAILED) — not a plain Error', async () => {
    // sdd-verify / RED #11-followup: the launch failure must surface as a
    // classified `FatalSkillError` with the documented code so the
    // dashboard / selfCheck can branch on `err instanceof FatalSkillError`
    // and `err.code === 'INDEED_LAUNCH_FAILED'` instead of having to
    // string-match on the message.
    vi.clearAllMocks();
    vi.mocked(chromium.launchPersistentContext).mockResolvedValue(null as never);

    await expect(openPersistentContext()).rejects.toBeInstanceOf(FatalSkillError);
    await expect(openPersistentContext()).rejects.toMatchObject({
      kind: 'fatal_skill',
      code: 'INDEED_LAUNCH_FAILED',
      message: expect.stringMatching(/launchPersistentContext/),
    });
  });
});

// ===========================================================================
// Unit 2 — Persistent scan + challenge retry + dedupe (TASK-302/303)
// ===========================================================================

/**
 * Build a PersistentPage driven by two FIFO queues:
 *   - `htmls[i]`     → returned by the i-th `page.content()` call
 *   - `evaluates[i]` → returned by the i-th `page.evaluate()` call
 *   - `statuses[i]`  → returned by response.status() for the i-th `page.goto()`
 *
 * The mock cannot introspect which evaluate-closure ran (the parser, the
 * classifier, or the JSON extractor); tests must pre-script evaluates in
 * the exact order the production code invokes them. This keeps test mocks
 * dumb but predictable.
 *
 * Per page-load the production sequence is:
 *   1. content()                                ← htmls[i++]
 *   2. classifyPage → hasJobsMarker().evaluate  ← evaluates[j++]
 *   3. (if jobs) extractMosaicJson().evaluate   ← evaluates[j++]
 *   4. (if mosaic empty) parseDomCards().evaluate ← evaluates[j++]
 *
 * Challenge / blocked pages skip step 2 (text scan in `page.content()` only).
 * Empty pages skip steps 3..4 (they exit pagination).
 *
 * Returned capture lets tests inspect:
 *   - gotoCalls   : recorded urls
 *   - sleepCalls  : backoff durations observed
 *   - handle.close: whether the context was closed
 */
interface ScanPageFixture {
  htmls: string[];
  evaluates?: unknown[];
  statuses?: number[];
  throwOnGoto?: boolean;
}

interface ScanMocks {
  handle: PersistentContextHandle;
  page: PersistentPage;
  gotoCalls: Array<{ url: string }>;
  sleepCalls: number[];
}

function makeScanPage(fixture: ScanPageFixture): ScanMocks {
  const gotoCalls: Array<{ url: string }> = [];
  const sleepCalls: number[] = [];
  const evaluates = fixture.evaluates ?? [];
  const statuses = fixture.statuses ?? [];
  let htmlCursor = 0;
  let evalCursor = 0;
  let statusCursor = 0;

  const goto = vi.fn(async (url: string) => {
    gotoCalls.push({ url });
    if (fixture.throwOnGoto) throw new Error('net::ERR_ABORTED');
    const status = statuses[statusCursor] ?? 200;
    statusCursor++;
    return {
      status: () => status,
      ok: () => status >= 200 && status < 300,
    };
  });

  const content = vi.fn(async () => {
    const html = fixture.htmls[htmlCursor] ?? '';
    htmlCursor++;
    return html;
  });

  const evaluate = vi.fn(async <T,>(_fn: () => T): Promise<T> => {
    const value = evaluates[evalCursor];
    evalCursor++;
    return (value ?? null) as T;
  });

  const page = {
    goto,
    content,
    evaluate,
    $: vi.fn(async () => null),
    $$: vi.fn(async () => []),
    close: vi.fn(async () => undefined),
  } as unknown as PersistentPage;

  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  const handle = { context, page } as unknown as PersistentContextHandle;

  return { handle, page, gotoCalls, sleepCalls };
}

// Helpers to emit job_found-event jobs from a mosaic JSON or DOM HTML set.
// We keep the mocks small — most tests construct their HTML inline.

function makeSkillContext(events: Array<{ kind: string; payload?: unknown; message?: string }> = []) {
  return {
    events: {
      emit: vi.fn(async (e: { kind: string; payload?: unknown; message?: string }) => {
        events.push(e);
      }),
    },
    emitted: events,
  };
}

function sleepRecorder(into: number[]): (ms: number) => Promise<void> {
  return async (ms: number) => {
    into.push(ms);
  };
}

function randConst(v: number): () => number {
  return () => v;
}

// ---------------------------------------------------------------------------
// scanWithPersistentContext — challenge retry (TASK-302, RED #4)
// ---------------------------------------------------------------------------

const MOSAIC_BLOB = mosaicJsonFromHtml(MOSAIC_HTML);

describe('scanWithPersistentContext — challenge retry (RED #4)', () => {
  const profile: CandidateProfile = {
    id: 1,
    skills: [{ name: 'mantención' }],
  };

  it('retries the same URL up to MAX_CHALLENGE_RETRIES+1 times then throws TransientSkillError', async () => {
    // Every attempt yields challenge HTML → never classifies as jobs/empty.
    const { handle, gotoCalls, sleepCalls } = makeScanPage({
      htmls: Array.from({ length: MAX_CHALLENGE_RETRIES + 2 }, () => CHALLENGE_HTML),
    });

    const ctx = makeSkillContext();
    const hooks: ScanHooks = { sleep: sleepRecorder(sleepCalls), rand: randConst(0) };

    await expect(
      scanWithPersistentContext(profile, ctx, handle, { hooks }),
    ).rejects.toBeInstanceOf(TransientSkillError);

    // First attempt has no sleep; retries have backoff attempts 0..N-1 (here MAX_CHALLENGE_RETRIES).
    // Total goto count = MAX_CHALLENGE_RETRIES + 1.
    expect(gotoCalls.length).toBe(MAX_CHALLENGE_RETRIES + 1);
    expect(sleepCalls).toHaveLength(MAX_CHALLENGE_RETRIES);
    // All sleep durations must fall inside the documented backoff bounds.
    expect(sleepCalls[0]).toBe(backoffBounds(0).min);
    expect(sleepCalls[sleepCalls.length - 1]).toBeGreaterThanOrEqual(
      backoffBounds(MAX_CHALLENGE_RETRIES - 1).min,
    );
  });

  it('emits scan_error with code INDEED_CHALLENGE_PERSISTENT on exhaustion', async () => {
    const { handle } = makeScanPage({
      htmls: Array.from({ length: MAX_CHALLENGE_RETRIES + 2 }, () => CHALLENGE_HTML),
    });
    const ctx = makeSkillContext();
    const hooks: ScanHooks = {
      sleep: async () => undefined,
      rand: randConst(0),
    };
    await expect(scanWithPersistentContext(profile, ctx, handle, { hooks })).rejects.toMatchObject(
      { code: 'INDEED_CHALLENGE_PERSISTENT', kind: 'transient' },
    );
    const errEvent = ctx.emitted.find((e) => e.kind === 'scan_error');
    expect(errEvent).toBeDefined();
    expect(errEvent?.payload).toMatchObject({
      code: 'INDEED_CHALLENGE_PERSISTENT',
      kind: 'transient',
    });
  });

  it('recoverable challenge (2× challenge → jobs) does NOT throw — completes normally', async () => {
    // Per page-load evaluate sequence:
    //   attempt 0 (challenge) → no evaluate (classifyPage text-scan short-circuits)
    //   attempt 1 (challenge) → no evaluate
    //   attempt 2 (jobs HTML)  → hasJobsMarker evaluates[0]=true → extractMosaicJson evaluates[1]=MosaicJson
    const { handle, gotoCalls, sleepCalls } = makeScanPage({
      htmls: [
        CHALLENGE_HTML,
        CHALLENGE_HTML,
        MOSAIC_HTML,
        // (safety) — short page break means we never reach this slot
        EMPTY_HTML,
      ],
      evaluates: [
        true,            // hasJobsMarker on the mosaic HTML
        MOSAIC_BLOB,     // extractMosaicJson on the mosaic HTML
      ],
    });

    const ctx = makeSkillContext();
    const result = await scanWithPersistentContext(profile, ctx, handle, {
      hooks: { sleep: sleepRecorder(sleepCalls), rand: randConst(0) },
    });

    // 2 retries + 1 successful jobs page (MOSAIC_HTML yields 3 jobs < PAGE_SIZE → short-page break).
    expect(gotoCalls.length).toBe(3);
    expect(sleepCalls).toEqual([backoffBounds(0).min, backoffBounds(1).min]);
    expect(result.jobsFound).toBeGreaterThan(0);

    const completed = ctx.emitted.find((e) => e.kind === 'scan_completed');
    expect(completed).toBeDefined();
    const errEvent = ctx.emitted.find((e) => e.kind === 'scan_error');
    expect(errEvent).toBeUndefined();
  });

  it('uses injected `rand` deterministically — backoff values match backoffMs formula', async () => {
    const { handle, sleepCalls } = makeScanPage({
      htmls: Array.from({ length: MAX_CHALLENGE_RETRIES + 2 }, () => CHALLENGE_HTML),
    });
    const ctx = makeSkillContext();
    await expect(
      scanWithPersistentContext(profile, ctx, handle, {
        hooks: { sleep: sleepRecorder(sleepCalls), rand: () => 0.5 },
      }),
    ).rejects.toBeInstanceOf(TransientSkillError);

    expect(sleepCalls[0]).toBe(backoffMs(0, () => 0.5));
    expect(sleepCalls[1]).toBe(backoffMs(1, () => 0.5));
  });

  it('fetchOnePage throwing FatalSkillError aborts immediately with no retry budget', async () => {
    const { handle, gotoCalls, sleepCalls } = makeScanPage({
      htmls: Array.from({ length: MAX_CHALLENGE_RETRIES + 2 }, () => CHALLENGE_HTML),
    });
    const ctx = makeSkillContext();
    const hooks: ScanHooks = {
      fetchOnePage: async () => {
        throw new FatalSkillError('Force-fatal in test', 'INDEED_TEST_FATAL');
      },
      sleep: sleepRecorder(sleepCalls),
    };

    await expect(scanWithPersistentContext(profile, ctx, handle, { hooks })).rejects.toBeInstanceOf(
      FatalSkillError,
    );
    // FatalSkillError re-thrown from fetchOnePage is not retried — 0 sleeps.
    expect(sleepCalls).toHaveLength(0);
    // page.goto was never called because fetchOnePage was overridden.
    expect(gotoCalls).toHaveLength(0);
    const err = ctx.emitted.find((e) => e.kind === 'scan_error');
    expect(err).toBeDefined();
  });

  it('navigation network error counts as transient — retry budget is consumed', async () => {
    const { handle, gotoCalls, sleepCalls } = makeScanPage({
      throwOnGoto: true,
      htmls: Array.from({ length: MAX_CHALLENGE_RETRIES + 2 }, () => CHALLENGE_HTML),
    });
    const ctx = makeSkillContext();
    await expect(
      scanWithPersistentContext(profile, ctx, handle, {
        hooks: { sleep: sleepRecorder(sleepCalls), rand: randConst(0) },
      }),
    ).rejects.toBeInstanceOf(TransientSkillError);
    expect(gotoCalls.length).toBe(MAX_CHALLENGE_RETRIES + 1);
    expect(sleepCalls).toHaveLength(MAX_CHALLENGE_RETRIES);
  });
});

// ---------------------------------------------------------------------------
// scanWithPersistentContext — blocked + 5xx (TASK-303, RED #5)
// ---------------------------------------------------------------------------

describe('scanWithPersistentContext — blocked page (RED #5)', () => {
  const profile: CandidateProfile = { skills: [{ name: 'mantención' }] };

  it('throws FatalSkillError(INDEED_BLOCKED) IMMEDIATELY on a blocked HTML page — no retries, no sleeps', async () => {
    const blockedHtml = '<html><body>Indeed has blocked your IP</body></html>';
    const { handle, gotoCalls, sleepCalls } = makeScanPage({
      htmls: [blockedHtml, blockedHtml, blockedHtml],
    });
    const ctx = makeSkillContext();
    const hooks: ScanHooks = { sleep: sleepRecorder(sleepCalls), rand: randConst(0) };
    await expect(scanWithPersistentContext(profile, ctx, handle, { hooks })).rejects.toBeInstanceOf(
      FatalSkillError,
    );
    // Fetch went through page.goto exactly once (no retries).
    expect(gotoCalls).toHaveLength(1);
    expect(sleepCalls).toHaveLength(0);
  });

  it('throws TransientSkillError(INDEED_HTTP_5XX) on HTTP 503 — no retries, no sleeps', async () => {
    const { handle, gotoCalls, sleepCalls } = makeScanPage({
      statuses: [503, 503, 503],
      htmls: Array.from({ length: 5 }, () => CHALLENGE_HTML),
    });
    const ctx = makeSkillContext();
    const hooks: ScanHooks = { sleep: sleepRecorder(sleepCalls), rand: randConst(0) };
    await expect(scanWithPersistentContext(profile, ctx, handle, { hooks })).rejects.toBeInstanceOf(
      TransientSkillError,
    );
    expect(gotoCalls).toHaveLength(1); // 5xx is single-attempt → no retry
    expect(sleepCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// scanWithPersistentContext — dedupe across pages (RED #9)
// ---------------------------------------------------------------------------

function generateMosaicHtml(jks: string[]): string {
  const cards = jks
    .map((jk, i) => {
      return `{
        "jobcardUuid": "uuid-${i}",
        "title": "Téc ${jk}",
        "companyName": "Co ${i}",
        "formattedLocation": "Loc ${i}",
        "viewJobTitle": "Téc ${jk}",
        "viewJobLink": "https://cl.indeed.com/viewjob?jk=${jk}",
        "applyJobUrl": "https://cl.indeed.com/rc/clk?jk=${jk}&from=serp",
        "indeedApplyEnabled": true,
        "relativeDate": "Hoy"
      }`;
    })
    .join(',\n');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Empleos</title></head><body><main><div id="resultsCol">
    <script id="mosaic-provider-script">
{
  "mosaicProviderJobCardsModel": {
    "jobCards": [${cards}]
  }
}
    </script>
  </div></main></body></html>`;
}

/** A blank page that classifies as `empty` (no jobs marker, no challenges). */
const EMPTY_HTML = '<html><body>No results.</body></html>';

/**
 * Build the `evaluates[]` queue for a list of (mosic HTML pages + empty pages).
 * Each mosaic page-load consumes two evaluates: `hasJobsMarker` → true,
 * `extractMosaicJson` → the parsed blob. Each empty page-load consumes one
 * evaluate: `hasJobsMarker` → false (then scan breaks pagination).
 */
function evaluatesFor(htmls: string[]): unknown[] {
  const out: unknown[] = [];
  for (const html of htmls) {
    const trimmed = html.replace(/<!--[\s\S]*?-->/g, '');
    const m = trimmed.match(/<script\b[^>]*?\bid="mosaic-provider-script"[^>]*>([\s\S]*?)<\/script>/);
    if (m && m[1]) {
      try {
        out.push(true); // hasJobsMarker → found a mosaic blob
        out.push(JSON.parse(m[1])); // extractMosaicJson → blob (already parsed)
      } catch {
        out.push(true); // hasJobsMarker wouldn't actually pass on malformed JSON
        out.push(null);
      }
    } else {
      // Empty page (or no mosaic script). hasJobsMarker → false.
      out.push(false);
      // extractMosaicJson is NOT called when hasJobsMarker returns false,
      // because classifyPage returns 'empty' before parseSearchPage runs.
    }
  }
  return out;
}

/** Build a `PAGE_SIZE`-long id list with a stable prefix (no short-page break). */
function fullPage(prefix: string): string[] {
  return Array.from({ length: PAGE_SIZE }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
}

describe('scanWithPersistentContext — dedupe (RED #9)', () => {
  const profile: CandidateProfile = { skills: [{ name: 'mantención' }] };

  it('dedupes the same externalId across consecutive pages of a single query', async () => {
    // Page 1: 10 unique A-* jobs (PAGE_SIZE — no short break).
    // Page 2: 1 A-dup + 9 B-new. < PAGE_SIZE → break.
    const page1 = fullPage('A');
    const page2 = ['A01', ...fullPage('B').slice(0, 9)];
    const htmls = [generateMosaicHtml(page1), generateMosaicHtml(page2)];
    const { handle } = makeScanPage({ htmls, evaluates: evaluatesFor(htmls) });
    const ctx = makeSkillContext();

    const result = await scanWithPersistentContext(profile, ctx, handle);

    const ids = ctx.emitted
      .filter((e) => e.kind === 'job_found')
      .map((e) => (e.payload as NormalizedJob).externalId);

    expect(ids).toHaveLength(19); // 10 A's + 9 B's
    expect(result.jobsFound).toBe(19);
    expect(result.jobsDuplicate).toBe(1);
    // The A01 dup was emitted exactly once.
    expect(ids.filter((id) => id === 'A01')).toHaveLength(1);
  });

  it('dedupes the same externalId across DIFFERENT queries', async () => {
    // Profile needs ≥2 skills so buildQueries yields 2 distinct queries.
    const twoQueryProfile: CandidateProfile = {
      skills: [{ name: 'mantención' }, { name: 'refrigeración' }],
    };
    // Query 1: 5 jobs (< PAGE_SIZE → break to next query)
    // Query 2: 5 jobs incl. 2 overlap with query 1
    const htmls = [
      generateMosaicHtml(['A', 'B', 'C', 'D', 'E']),
      generateMosaicHtml(['C', 'D', 'F', 'G', 'H']),
    ];
    const { handle } = makeScanPage({ htmls, evaluates: evaluatesFor(htmls) });
    const ctx = makeSkillContext();

    const result = await scanWithPersistentContext(twoQueryProfile, ctx, handle);

    const ids = ctx.emitted
      .filter((e) => e.kind === 'job_found')
      .map((e) => (e.payload as NormalizedJob).externalId);

    expect(ids).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(result.jobsFound).toBe(8);
    expect(result.jobsDuplicate).toBe(2);
  });

  it('dedupe set persists across pages of the SAME query', async () => {
    // 3 full pages with cross-page overlap. Final empty breaks pagination.
    const p1 = fullPage('A');
    const p2 = ['A10', ...fullPage('B')];
    const p3 = ['B10', ...fullPage('C').slice(0, 9)]; // 1 dup, 9 new — 10 total
    const htmls = [generateMosaicHtml(p1), generateMosaicHtml(p2), generateMosaicHtml(p3), EMPTY_HTML];
    const { handle } = makeScanPage({ htmls, evaluates: evaluatesFor(htmls) });
    const ctx = makeSkillContext();

    const result = await scanWithPersistentContext(profile, ctx, handle);

    // 10 A's + 10 B's + 9 C's = 29 unique; 2 dups (A10, B10).
    expect(result.jobsFound).toBe(29);
    expect(result.jobsDuplicate).toBe(2);
    const ids = ctx.emitted
      .filter((e) => e.kind === 'job_found')
      .map((e) => (e.payload as NormalizedJob).externalId);
    expect(ids.filter((id) => id === 'A10')).toHaveLength(1);
    expect(ids.filter((id) => id === 'B10')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// scanWithPersistentContext — pagination + event sequence
// ---------------------------------------------------------------------------

describe('scanWithPersistentContext — pagination', () => {
  const profile: CandidateProfile = { skills: [{ name: 'mantención' }] };

  it('emits scan_started once, then per-job job_found, then scan_completed', async () => {
    const htmls = [
      generateMosaicHtml(['X1', 'X2', 'X3', 'X4', 'X5']), // p=0
      EMPTY_HTML,                                          // p=1 empty → break
    ];
    const { handle } = makeScanPage({ htmls, evaluates: evaluatesFor(htmls) });
    const ctx = makeSkillContext();

    await scanWithPersistentContext(profile, ctx, handle);

    const kinds = ctx.emitted.map((e) => e.kind);
    const startedIdx = kinds.indexOf('scan_started');
    const completedIdx = kinds.indexOf('scan_completed');
    expect(startedIdx).toBe(0);
    expect(completedIdx).toBe(kinds.length - 1);
    expect(kinds.filter((k) => k === 'job_found')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'scan_error')).toHaveLength(0);
  });

  it('stops paginating when jobs.length < PAGE_SIZE', async () => {
    const htmls = [generateMosaicHtml(['P1-S'])]; // p=0: 1 job (< PAGE_SIZE=10) → break
    const { handle, gotoCalls } = makeScanPage({ htmls, evaluates: evaluatesFor(htmls) });
    const ctx = makeSkillContext();

    await scanWithPersistentContext(profile, ctx, handle);

    expect(gotoCalls).toHaveLength(1);
  });

  it('caps pagination at MAX_PAGES_PER_QUERY', async () => {
    // Build MAX_PAGES_PER_QUERY full pages (PAGE_SIZE each).
    const fullPage = (n: number) =>
      Array.from({ length: PAGE_SIZE }, (_, i) => `P${n}-${String(i + 1).padStart(2, '0')}`);
    const htmls: string[] = [];
    for (let i = 0; i < MAX_PAGES_PER_QUERY; i++) htmls.push(generateMosaicHtml(fullPage(i + 1)));
    const { handle, gotoCalls } = makeScanPage({ htmls, evaluates: evaluatesFor(htmls) });
    const ctx = makeSkillContext();

    const result = await scanWithPersistentContext(profile, ctx, handle);

    expect(gotoCalls.length).toBe(MAX_PAGES_PER_QUERY);
    expect(result.jobsFound).toBe(PAGE_SIZE * MAX_PAGES_PER_QUERY);
  });

  it('stops paginating when a page classifies as empty', async () => {
    // First page: full PAGE_SIZE (no short-page break).
    // Second page: empty → break.
    const htmls = [generateMosaicHtml(fullPage('A')), EMPTY_HTML];
    const { handle, gotoCalls } = makeScanPage({ htmls, evaluates: evaluatesFor(htmls) });
    const ctx = makeSkillContext();

    await scanWithPersistentContext(profile, ctx, handle);

    expect(gotoCalls).toHaveLength(2);
    const searchGotos = gotoCalls.filter((c) => c.url.includes('/jobs?'));
    expect(searchGotos).toHaveLength(2);
  });

  it('clears dedupe state only at scan start — different scans see fresh sets', async () => {
    // Each scan gets its own PersistentContextHandle/mock so they don't
    // share cursors. The point is the dedupe `Set` lives inside
    // `scanWithPersistentContext` (declared fresh each call), so emitting
    // the same job from two scans is fine.
    const htmlsA = [generateMosaicHtml(['X']), EMPTY_HTML];
    const { handle: handleA } = makeScanPage({ htmls: htmlsA, evaluates: evaluatesFor(htmlsA) });
    const ctxA = makeSkillContext();
    await scanWithPersistentContext(profile, ctxA, handleA);

    const htmlsB = [generateMosaicHtml(['X']), EMPTY_HTML];
    const { handle: handleB } = makeScanPage({ htmls: htmlsB, evaluates: evaluatesFor(htmlsB) });
    const ctxB = makeSkillContext();
    await scanWithPersistentContext(profile, ctxB, handleB);

    const idsA = ctxA.emitted
      .filter((e) => e.kind === 'job_found')
      .map((e) => (e.payload as NormalizedJob).externalId);
    const idsB = ctxB.emitted
      .filter((e) => e.kind === 'job_found')
      .map((e) => (e.payload as NormalizedJob).externalId);
    expect(idsA).toEqual(['X']);
    expect(idsB).toEqual(['X']);
  });
});

// ---------------------------------------------------------------------------
// scanIndeed — high-level (launches + closes the context)
// ---------------------------------------------------------------------------

describe('scanIndeed — wraps openPersistentContext + scanWithPersistentContext', () => {
  const profile: CandidateProfile = { skills: [{ name: 'mantención' }] };

  it('opens the context via the injected launchContext hook', async () => {
    const htmls = [generateMosaicHtml(['A']), EMPTY_HTML];
    const { handle } = makeScanPage({ htmls, evaluates: evaluatesFor(htmls) });
    const launchContext = vi.fn(async () => handle);

    const ctx = makeSkillContext();
    await scanIndeed(profile, ctx, { launchContext });

    expect(launchContext).toHaveBeenCalledTimes(1);
    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });

  it('passes through to scanWithPersistentContext: emits scan_started/completed', async () => {
    const htmls = [generateMosaicHtml(['A']), EMPTY_HTML];
    const { handle } = makeScanPage({ htmls, evaluates: evaluatesFor(htmls) });
    const ctx = makeSkillContext();
    await scanIndeed(profile, ctx, { launchContext: async () => handle });

    const kinds = ctx.emitted.map((e) => e.kind);
    expect(kinds[0]).toBe('scan_started');
    expect(kinds[kinds.length - 1]).toBe('scan_completed');
  });

  it('closes the context even when the inner scan throws', async () => {
    const { handle } = makeScanPage({
      htmls: Array.from({ length: MAX_CHALLENGE_RETRIES + 2 }, () => CHALLENGE_HTML),
    });
    const launchContext = vi.fn(async () => handle);
    const ctx = makeSkillContext();

    await expect(
      scanIndeed(profile, ctx, {
        launchContext,
        sleep: async () => undefined,
        rand: () => 0,
      }),
    ).rejects.toBeInstanceOf(TransientSkillError);

    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Unit 3 — selfCheck + PlatformSkill registration (TASK-401 / TASK-402)
// ===========================================================================

/**
 * Build a probe-style handle — a single PersistentContextHandle where
 * `page.content()` returns `opts.html` and `page.goto` returns
 * `{ status: 200 }` unless the caller customizes.
 *
 * Two evaluate-mode strategies:
 *   - `evaluates` (FIFO queue): when provided, each `page.evaluate` call
 *     consumes the next entry. Use this when the test needs to feed realistic
 *     responses to `parseSearchPage` (mosaic JSON, DOM cards, etc.).
 *   - `hasJobsMarker` (boolean): used when `evaluates` is not set. Every
 *     `page.evaluate` call returns the same boolean — sufficient for the
 *     cases where `selfCheck` does NOT call `parseSearchPage` (the
 *     challenge / blocked / 5xx / navigation / launch-fail branches).
 *
 * The probe's `page.content()` is used both by `classifyPage` (for the
 * challenge / blocked markers) and by anything else the caller wants to
 * read.
 */
function makeProbeHandle(opts: {
  html?: string;
  status?: number;
  hasJobsMarker?: boolean;
  /** FIFO queue of evaluate responses; takes precedence over `hasJobsMarker`. */
  evaluates?: unknown[];
}): PersistentContextHandle {
  let evalIdx = 0;
  const page = {
    goto: vi.fn(async (_url: string) => ({
      status: () => opts.status ?? 200,
      ok: () => (opts.status ?? 200) >= 200 && (opts.status ?? 200) < 300,
    })),
    content: vi.fn(async () => opts.html ?? ''),
    evaluate: vi.fn(async <T,>(_fn: () => T): Promise<T> => {
      if (opts.evaluates !== undefined) {
        return opts.evaluates[evalIdx++] as T;
      }
      return (opts.hasJobsMarker ?? false) as T;
    }),
    $: vi.fn(async () => null),
    $$: vi.fn(async () => []),
    close: vi.fn(async () => undefined),
  } as unknown as PersistentPage;

  const context = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };

  return { context, page } as unknown as PersistentContextHandle;
}

const noSleepHooks: SelfCheckHooks = {
  sleep: async () => undefined,
  rand: () => 0,
};

describe('SELF_CHECK_URL (pure)', () => {
  it('points at BASE_URL/jobs?q=DEFAULT_QUERIES[0]&start=0', () => {
    expect(SELF_CHECK_URL).toBe(
      `${BASE_URL}/jobs?q=${encodeURIComponent(DEFAULT_QUERIES[0]!)}&start=0`,
    );
    expect(SELF_CHECK_URL.startsWith(BASE_URL)).toBe(true);
  });
});

describe('selfCheck (SPEC-ID-009 / RED #10)', () => {
  it('reports healthy when the probe URL classifies as "jobs"', async () => {
    // selfCheck now invokes `parseSearchPage` on the jobs branch to verify
    // parser compatibility (SPEC-ID-009). Feed a real mosaic blob so the
    // parser yields ≥1 job — the probe then returns `healthy`.
    // evaluate[0] = `hasJobsMarker` → true (classifyPage)
    // evaluate[1] = mosaic JSON     → parseSearchPage.extractMosaicJson
    const json = mosaicJsonFromHtml(MOSAIC_HTML);
    const handle = makeProbeHandle({
      html: MOSAIC_HTML,
      evaluates: [true, json],
    });
    const health = await selfCheck({ hooks: { ...noSleepHooks, launchContext: async () => handle } });
    expect(health.status).toBe('healthy');
    expect(health.schemaVersion).toBe(INDEED_SKILL_VERSION);
    expect(health.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(health.lastError).toBeUndefined();
    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });

  it('reports healthy when the probe URL classifies as "empty" (clean page, no jobs)', async () => {
    const handle = makeProbeHandle({ html: EMPTY_HTML, hasJobsMarker: false });
    const health = await selfCheck({ hooks: { ...noSleepHooks, launchContext: async () => handle } });
    expect(health.status).toBe('healthy');
    expect(health.lastError).toBeUndefined();
    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });

  it('reports needs-human + INDEED_CHALLENGE_PERSISTENT when every retry is challenge', async () => {
    // MAX_CHALLENGE_RETRIES + 1 attempts all returning the challenge HTML
    // — the loop falls through and selfCheck reports needs-human.
    const handle = makeProbeHandle({ html: CHALLENGE_HTML });
    const sleepCalls: number[] = [];
    const health = await selfCheck({
      hooks: {
        ...noSleepHooks,
        launchContext: async () => handle,
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      },
    });

    expect(health.status).toBe('needs-human');
    expect(health.lastError?.code).toBe('INDEED_CHALLENGE_PERSISTENT');
    expect(health.lastError?.message).toContain(SELF_CHECK_URL);
    // Backoff fired MAX_CHALLENGE_RETRIES times.
    expect(sleepCalls).toHaveLength(MAX_CHALLENGE_RETRIES);
    // The probe navigated MAX_CHALLENGE_RETRIES + 1 times.
    expect((handle.page.goto as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      MAX_CHALLENGE_RETRIES + 1,
    );
    // Context still closed on the needs-human branch.
    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });

  it('reports needs-human + INDEED_BLOCKED when the probe HTML matches the blocked marker', async () => {
    const handle = makeProbeHandle({ html: '<html>Indeed has blocked your IP</html>' });
    const health = await selfCheck({ hooks: { ...noSleepHooks, launchContext: async () => handle } });
    expect(health.status).toBe('needs-human');
    expect(health.lastError?.code).toBe('INDEED_BLOCKED');
    expect(health.lastError?.message).toContain(SELF_CHECK_URL);
    expect((handle.page.goto as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });

  it('reports needs-human + INDEED_HTTP_5XX when the probe receives HTTP 503', async () => {
    const handle = makeProbeHandle({ status: 503, html: CHALLENGE_HTML });
    const health = await selfCheck({ hooks: { ...noSleepHooks, launchContext: async () => handle } });
    expect(health.status).toBe('needs-human');
    expect(health.lastError?.code).toBe('INDEED_HTTP_5XX');
    // 5xx is single-attempt — no retries, no sleeps.
    expect((handle.page.goto as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });

  it('reports needs-human + INDEED_NAVIGATION_EMPTY when every retry navigates to null', async () => {
    const page = {
      goto: vi.fn(async () => null),
      content: vi.fn(async () => ''),
      evaluate: vi.fn(async <T,>(_fn: () => T): Promise<T> => false as T),
      $: vi.fn(async () => null),
      $$: vi.fn(async () => []),
      close: vi.fn(async () => undefined),
    } as unknown as PersistentPage;
    const handle = { context: { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) }, page } as unknown as PersistentContextHandle;

    const health = await selfCheck({ hooks: { ...noSleepHooks, launchContext: async () => handle } });
    expect(health.status).toBe('needs-human');
    expect(health.lastError?.code).toBe('INDEED_NAVIGATION_EMPTY');
    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });

  it('reports broken + INDEED_LAUNCH_FAILED when openPersistentContext throws', async () => {
    const health = await selfCheck({
      hooks: {
        ...noSleepHooks,
        launchContext: async () => {
          throw new Error('Chromium executable not found');
        },
      },
    });
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('INDEED_LAUNCH_FAILED');
    expect(health.lastError?.message).toContain('Chromium executable not found');
  });

  it('recovers on a transient challenge (challenge then jobs) and reports healthy', async () => {
    // First page-load = challenge; second = jobs.
    // The content cursor advances on `page.content()` calls (one per
    // classification round). The eval cursor advances separately because
    // selfCheck now invokes parseSearchPage on the jobs branch — that
    // second evaluate must return a usable mosaic JSON, NOT the boolean
    // returned by hasJobsMarker.
    let cursor = 0;
    let evalIdx = 0;
    const htmls = [CHALLENGE_HTML, MOSAIC_HTML];
    const json = mosaicJsonFromHtml(MOSAIC_HTML);
    const evalResponses: unknown[] = [
      true, // hasJobsMarker (round 2) — page has jobs
      json, // extractMosaicJson — parseSearchPage yields ≥1 job
    ];
    const page = {
      goto: vi.fn(async (_url: string) => ({
        status: () => 200,
        ok: () => true,
      })),
      content: vi.fn(async () => htmls[cursor++] ?? ''),
      evaluate: vi.fn(async <T,>(_fn: () => T): Promise<T> => evalResponses[evalIdx++] as T),
      $: vi.fn(async () => null),
      $$: vi.fn(async () => []),
      close: vi.fn(async () => undefined),
    } as unknown as PersistentPage;
    const handle = { context: { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) }, page } as unknown as PersistentContextHandle;

    const health = await selfCheck({ hooks: { ...noSleepHooks, launchContext: async () => handle } });
    expect(health.status).toBe('healthy');
    expect((handle.page.goto as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });

  it('closes the context even when an unexpected synchronous throw escapes probePage', async () => {
    // `page.goto` throws are caught INSIDE `probePage` and surface as
    // `navigation-error` (transient → needs-human). But a throw from
    // `page.content()` or `page.evaluate()` escapes `probePage` entirely
    // because those calls are NOT inside the inner try/catch — that's the
    // path the outer selfCheck try/catch + finally exists to handle.
    const page = {
      goto: vi.fn(async () => ({ status: () => 200, ok: () => true })),
      content: vi.fn(async () => {
        throw new Error('synthetic probe crash');
      }),
      evaluate: vi.fn(async <T,>(_fn: () => T): Promise<T> => false as T),
      $: vi.fn(async () => null),
      $$: vi.fn(async () => []),
      close: vi.fn(async () => undefined),
    } as unknown as PersistentPage;
    const handle = { context: { newPage: vi.fn(async () => page), close: vi.fn(async () => undefined) }, page } as unknown as PersistentContextHandle;

    // The throw escapes `probePage`, the outer try/catch maps it to
    // INDEED_LAUNCH_FAILED, and the finally still closes the context.
    const health = await selfCheck({ hooks: { ...noSleepHooks, launchContext: async () => handle } });
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('INDEED_LAUNCH_FAILED');
    expect(health.lastError?.message).toContain('synthetic probe crash');
    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });

  it('reports broken + INDEED_PARSER_INCOMPATIBLE when classified "jobs" but parser yields zero jobs', async () => {
    // The classifier accepts the page (hasJobsMarker=true) but parseSearchPage
    // cannot extract any job — both mosaic and DOM return empty. SPEC-ID-009
    // requires the probe to surface this as `broken` so the dashboard sees a
    // genuine skill breakage even when the page "looks" like a jobs page.
    // evaluate[0] = `hasJobsMarker`        → true  (classifyPage)
    // evaluate[1] = extractMosaicJson      → null  (mosaic missing)
    // evaluate[2] = parseDomCards          → []    (DOM empty)
    // → parseSearchPage throws FatalSkillError(INDEED_PARSER_INCOMPATIBLE)
    // → selfCheck maps it to broken + INDEED_PARSER_INCOMPATIBLE
    const handle = makeProbeHandle({
      html: MOSAIC_HTML,
      evaluates: [true, null, []],
    });
    const health = await selfCheck({ hooks: { ...noSleepHooks, launchContext: async () => handle } });
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('INDEED_PARSER_INCOMPATIBLE');
    // The human-readable message describes the failure; the code lives in
    // the dedicated `code` field — assert both surfaces to lock the contract.
    expect(health.lastError?.message).toMatch(/parser could not extract/i);
    // Context must still close on the broken branch.
    expect(handle.context.close).toHaveBeenCalledTimes(1);
  });

  it('reports healthy on "empty" pages WITHOUT invoking parseSearchPage', async () => {
    // The probe must skip parser verification on the empty branch — only the
    // jobs branch needs the compat check. We assert this by counting
    // `page.evaluate` calls: with `evaluates: [false]` (only hasJobsMarker
    // returns false), we expect evaluate to be called exactly ONCE — for
    // hasJobsMarker inside classifyPage. parseSearchPage must NOT run.
    const handle = makeProbeHandle({
      html: EMPTY_HTML,
      evaluates: [false],
    });
    const health = await selfCheck({ hooks: { ...noSleepHooks, launchContext: async () => handle } });
    expect(health.status).toBe('healthy');
    expect(health.lastError).toBeUndefined();
    // Exactly one evaluate call (hasJobsMarker). No parseSearchPage.
    expect((handle.page.evaluate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PlatformSkill registration — boot wiring (TASK-402 / SPEC-ID-010)
// ---------------------------------------------------------------------------

describe('indeedSkill — PlatformSkill shape (TASK-402)', () => {
  it('exposes the documented slug / version / displayName / capabilities', () => {
    expect(indeedSkill.slug).toBe('indeed');
    expect(indeedSkill.version).toBe(INDEED_SKILL_VERSION);
    expect(indeedSkill.displayName).toBe('Indeed.cl');
    expect(indeedSkill.requiredCandidateFields).toEqual([]);
    expect(indeedSkill.capabilities).toEqual({
      canScan: true,
      canApply: false,
      canDetectLoggedOut: false,
    });
  });

  it('does NOT implement apply (Indeed has no public apply surface)', () => {
    expect(indeedSkill.apply).toBeUndefined();
  });

  it('selfCheck is the PlatformSkill contract — delegates to the selfCheck module', async () => {
    // The wrapper is intentionally a thin pass-through, so we verify the
    // delegation contract structurally (the runtime `selfCheck` behavior is
    // covered by the unit tests above).
    expect(typeof indeedSkill.selfCheck).toBe('function');
    // The wrapper is a zero-argument async function — it MUST NOT accept a
    // hooks parameter, since the `PlatformSkill.selfCheck(): SkillHealth`
    // contract is fixed by `@employment-agent/skill-runtime`.
    expect(indeedSkill.selfCheck.length).toBe(0);

    // Spy the module-level `selfCheck` so we can invoke the PlatformSkill
    // wrapper without launching Chromium. This verifies the wrapper
    // actually delegates (not just exists).
    const skillModule = await import('./src/skill.js');
    const selfCheckModule = await import('./src/selfCheck.js');
    const spy = vi.spyOn(selfCheckModule, 'selfCheck').mockResolvedValue({
      status: 'healthy',
      schemaVersion: INDEED_SKILL_VERSION,
      detectedAt: new Date().toISOString(),
    });
    try {
      const health = await skillModule.indeedSkill.selfCheck();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(health.status).toBe('healthy');
      expect(health.schemaVersion).toBe(INDEED_SKILL_VERSION);
    } finally {
      spy.mockRestore();
    }
  });

  it('scan is a function that delegates to scanIndeed (verified via spy)', async () => {
    // The PlatformSkill.scan wrapper does NOT accept hooks (the runtime
    // contract is `scan(profile, ctx)`) — so we verify delegation via a
    // spy on scanIndeed instead of injecting a launchContext through the
    // public API. The full scan semantics are covered by the Unit 2
    // `scanIndeed` tests above.
    const { scanIndeed } = await import('./index.js');
    const spy = vi.spyOn(
      await import('./src/scan.js'),
      'scanIndeed',
    );
    const profile: CandidateProfile = { skills: [{ name: 'mantención' }] };
    const ctx = makeSkillContext();

    // Stub the spy to return a canned ScanResult so the test doesn't need
    // a real launchPersistentContext.
    spy.mockResolvedValue({
      jobsFound: 1,
      jobsNew: 1,
      jobsDuplicate: 0,
      errors: 0,
    });

    try {
      const result = await indeedSkill.scan(profile, ctx);
      expect(result.jobsFound).toBe(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(profile, ctx, {});
    } finally {
      spy.mockRestore();
    }
    // Quiet the unused-import lint without runtime cost.
    expect(scanIndeed).toBeDefined();
  });
});

describe('boot registration — worker/src/skill-init.ts wires the skill', () => {
  it('imports indeedSkill and registers it into the global SkillRegistry', async () => {
    const { registry } = await import('@employment-agent/skill-runtime');
    const before = new Set(registry.list().map((s) => s.slug));
    before.delete('indeed');

    // Re-run the boot wiring directly (mirrors worker/src/skill-init.ts).
    // We spy on `register` so we can verify our wrapper delegates correctly
    // AND assert that the live registry accepts the skill.
    const realRegister = registry.register.bind(registry);
    const registerSpy = vi.fn((skill: Parameters<typeof registry.register>[0]) => {
      return realRegister(skill);
    });
    registry.register = registerSpy as typeof registry.register;

    try {
      // First register call MUST go through the spy and NOT throw.
      registerSpy(indeedSkill);
      expect(registerSpy).toHaveBeenCalledWith(indeedSkill);
      // Second call MUST throw (registry guards against double-registration).
      expect(() => registerSpy(indeedSkill)).toThrow(/Skill already registered/);
    } finally {
      registry.register = realRegister as typeof registry.register;
    }

    expect(registry.has('indeed')).toBe(true);
    const skill = registry.get('indeed');
    expect(skill?.slug).toBe('indeed');
    expect(skill?.version).toBe(INDEED_SKILL_VERSION);
    expect(skill?.displayName).toBe('Indeed.cl');
    expect(skill?.capabilities).toEqual({
      canScan: true,
      canApply: false,
      canDetectLoggedOut: false,
    });

    // Boot wiring does not drop any pre-existing skill.
    for (const slug of before) {
      expect(registry.has(slug), `lost skill: ${slug}`).toBe(true);
    }
  });

  it('initializeSkills() registers indeedSkill into the global registry (boot integration)', async () => {
    // sdd-verify warning: the previous test wired `indeedSkill` into the
    // registry directly, which only proves the `indeedSkill` object is
    // well-formed. This test exercises the REAL boot wiring
    // (`worker/src/skill-init.ts`) and asserts that the live registry ends
    // up with the Indeed entry — so a regression in `initializeSkills`
    // (typo, dropped import, missing `register` call) is caught here.
    const { registry } = await import('@employment-agent/skill-runtime');
    const { initializeSkills } = await import('../../worker/src/skill-init.js');

    // Snapshot whatever skills other tests / global state left in the
    // registry, then clear it so `initializeSkills()` can run idempotently.
    const before = registry.list().map((s) => s);
    registry.clear();

    // `initializeSkills()` emits one `[skills] registered …` log line per
    // registered skill — silence it for clean test output.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      // First call MUST succeed and register every documented skill.
      expect(() => initializeSkills()).not.toThrow();
      expect(registry.has('indeed')).toBe(true);
      const skill = registry.get('indeed');
      expect(skill).toBeDefined();
      expect(skill?.slug).toBe('indeed');
      expect(skill?.displayName).toBe('Indeed.cl');
      expect(skill?.version).toBe(INDEED_SKILL_VERSION);
      // Boot wiring registers real platform skills but excludes fixtures.
      expect(registry.has('laborum')).toBe(true);
      expect(registry.has('computrabajo')).toBe(true);
      expect(registry.has('example-platform')).toBe(false);

      // Second call MUST throw — the registry guards against
      // double-registration and the boot wiring has no idempotency layer.
      expect(() => initializeSkills()).toThrow(/Skill already registered/);
    } finally {
      logSpy.mockRestore();
      // Restore the registry to whatever it looked like before the test so
      // we don't leak state into other test files that share the same
      // module-level singleton.
      registry.clear();
      for (const skill of before) {
        registry.register(skill);
      }
    }
  });
});
