import { chromium, type Browser, type BrowserContext, type Page, type ElementHandle } from 'playwright';
import type { PlatformSkill, ScanResult, SkillHealth, SkillContext } from '@employment-agent/skill-runtime';
import type { CandidateProfile } from '@employment-agent/domain';

export const BASE_URL = 'https://www.computrabajo.cl';
export const PAGE_SIZE = 20;
export const MAX_PAGES_PER_QUERY = 3;
export const MAX_QUERIES = 3;
export const DEFAULT_QUERIES = ['mantención', 'refrigeración', 'mantenimiento'];
const MAX_QUERY_LENGTH = 30; // Skip overly long skill descriptions as search queries

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface NormalizedJob {
  externalId: string;
  title: string;
  company?: string;
  location?: string;
  url: string;
  publishedAt?: string;
}

export interface RawBoxOffer {
  dataId: string | null;
  title: string;
  url: string;
  company?: string;
  location?: string;
  publishedAt?: string;
}

/**
 * Build a search slug from a candidate query per SPEC-CB-001.
 *
 * Pipeline:
 *  trim → toLowerCase → normalize('NFD') strip combining marks →
 *  replace any non-`[a-z0-9]` run with a single `-` → trim('-')
 */
export function slugify(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve a list of search queries for the scan loop per SPEC-CB-005.
 * Uses target roles from summary first, then short skill names, caps to
 * MAX_QUERIES, falls back to DEFAULT_QUERIES when nothing usable.
 */
export function buildQueries(profile: CandidateProfile): string[] {
  // 1. Extract target roles from the summary (short job titles).
  const summary = profile.summary ?? '';
  const rolesMatch = summary.match(/Roles objetivo activos:\s*(.+)/);
  const targetRoles = rolesMatch
    ? rolesMatch[1].split(',').map((r) => r.replace(/\s*\(prioridad\s*\d+\)/, '').trim()).filter(Boolean)
    : [];

  // 2. Short skill names work as search queries; long descriptions don't.
  const shortSkills = (profile.skills ?? [])
    .map((s) => s.name?.trim())
    .filter((name): name is string => Boolean(name && name.length > 1 && name.length <= MAX_QUERY_LENGTH));

  // 3. Combine: target roles first, then short skills, then defaults.
  const combined = [...new Set([...targetRoles, ...shortSkills])];
  return (combined.length > 0 ? combined : DEFAULT_QUERIES).slice(0, MAX_QUERIES);
}

/**
 * Normalize a parsed `article.box_offer` row per SPEC-CB-004.
 * Returns null when `data-id` or `title` is missing/blank.
 * Optional fields are OMITTED entirely (undefined) when blank,
 * never emitted as empty strings.
 */
export function mapBoxOffer(raw: RawBoxOffer): NormalizedJob | null {
  const dataId = raw.dataId?.trim();
  if (!dataId) return null;
  const title = raw.title?.trim();
  if (!title || !raw.url) return null;

  const job: NormalizedJob = {
    externalId: dataId,
    title,
    url: raw.url,
  };
  const company = raw.company?.trim();
  if (company) job.company = company;
  const location = raw.location?.trim();
  if (location) job.location = location;
  if (raw.publishedAt?.trim()) job.publishedAt = raw.publishedAt.trim();
  return job;
}

const META_SEP = '·';

/**
 * Split a sibling `<p>` like `Empresa X · Santiago · 30-07-2026`
 * into company / location / publishedAt. Returns whatever subset
 * is present (each may be undefined).
 */
function parseMetaParagraph(text: string): { company?: string; location?: string; publishedAt?: string } {
  if (!text || !text.includes(META_SEP)) return {};
  const parts = text
    .split(META_SEP)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const result: { company?: string; location?: string; publishedAt?: string } = {};
  if (parts[0]) result.company = parts[0];
  if (parts[1]) result.location = parts[1];
  if (parts[2]) result.publishedAt = parts[2];
  return result;
}

async function safeText(node: ElementHandle<HTMLElement | SVGElement> | null | undefined): Promise<string> {
  if (!node) return '';
  try {
    const txt = await node.textContent();
    return (txt ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * Parse every `article.box_offer[data-id]` element on the current page
 * per SPEC-CB-003. Selectors: `h2 > a.js-o-link` for title+href,
 * the first `<p>` containing a `·` separator for company/location/publishedAt.
 * Malformed rows (missing `data-id`, blank title) are silently skipped.
 */
export async function parseSearchPage(page: Page): Promise<NormalizedJob[]> {
  const articles = await page.$$('article.box_offer[data-id]');
  const jobs: NormalizedJob[] = [];
  for (const article of articles) {
    try {
      const dataId = (await article.getAttribute('data-id')) ?? '';
      const link = await article.$('h2 > a.js-o-link');
      const title = await safeText(link as ElementHandle<HTMLElement | SVGElement> | null);
      const href = link ? await link.getAttribute('href') : null;
      if (!dataId || !title || !href) continue;

      const url = new URL(href, BASE_URL).toString();

      // Look at sibling <p> elements for "Empresa · Ciudad · DD-MM-YYYY".
      // Only the first one that contains '·' is consumed.
      const paragraphs = await article.$$('p');
      let meta: { company?: string; location?: string; publishedAt?: string } = {};
      for (const p of paragraphs) {
        const text = await safeText(p as ElementHandle<HTMLElement | SVGElement>);
        if (!text) continue;
        meta = parseMetaParagraph(text);
        if (meta.company || meta.location || meta.publishedAt) break;
      }

      const job = mapBoxOffer({ dataId, title, url, ...meta });
      if (job) jobs.push(job);
    } catch {
      // Malformed row — keep parsing the remaining articles.
    }
  }
  return jobs;
}

/**
 * Build the URL for the nth page of search results for a given query slug.
 */
function buildSearchUrl(slug: string, pageNo: number): string {
  return `${BASE_URL}/trabajo-de-${slug}?p=${pageNo}`;
}

/**
 * Navigate to the search results page and parse the offer list per SPEC-CB-003.
 * Throws on non-2xx HTTP responses (the caller turns them into scan_error events).
 */
export async function fetchSearchPage(page: Page, query: string, pageNo: number): Promise<NormalizedJob[]> {
  const slug = slugify(query);
  if (!slug) return [];
  const response = await page.goto(buildSearchUrl(slug, pageNo), { waitUntil: 'load' });
  if (!response) {
    throw new Error(`Computrabajo navigation failed for query="${query}", page=${pageNo}`);
  }
  const status = response.status();
  if (status < 200 || status >= 300) {
    throw new Error(`Computrabajo search HTTP ${status} (query="${query}", page=${pageNo})`);
  }
  return parseSearchPage(page);
}

export const computrabajoSkill: PlatformSkill = {
  slug: 'computrabajo',
  version: '0.1.0',
  displayName: 'Computrabajo.cl',
  requiredCandidateFields: [],
  capabilities: {
    canScan: true,
    canApply: false,
    canDetectLoggedOut: false,
  },

  async scan(profile: CandidateProfile, ctx: SkillContext): Promise<ScanResult> {
    const queries = buildQueries(profile);
    await ctx.events.emit({
      kind: 'scan_started',
      message: `Iniciando escaneo de Computrabajo.cl (${queries.join(', ')})`,
      payload: { profileId: profile.id ?? null, queries },
    });

    const seen = new Set<string>();
    let jobsFound = 0;
    let jobsDuplicate = 0;
    let errors = 0;

    let browser: Browser | undefined;
    let context: BrowserContext | undefined;

    try {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({
        extraHTTPHeaders: { 'User-Agent': DEFAULT_USER_AGENT },
      });
      const page = await context.newPage();

      // Warm-up: navigate to homepage BEFORE any search goto so that the
      // site can set its own cookies (SPEC-CB-002). A warm-up failure is
      // counted as a scan_error but does NOT abort the scan — the search
      // pages may still respond without cookies.
      try {
        const warmUp = await page.goto(BASE_URL, { waitUntil: 'load' });
        if (warmUp && (warmUp.status() < 200 || warmUp.status() >= 300)) {
          throw new Error(`homepage HTTP ${warmUp.status()}`);
        }
      } catch (err) {
        errors++;
        await ctx.events.emit({
          kind: 'scan_error',
          message: `Error en warm-up de Computrabajo.cl: ${err instanceof Error ? err.message : String(err)}`,
          payload: { query: '<home>', page: 0 },
        });
      }

      for (const query of queries) {
        for (let pageNo = 1; pageNo <= MAX_PAGES_PER_QUERY; pageNo++) {
          let jobs: NormalizedJob[];
          try {
            jobs = await fetchSearchPage(page, query, pageNo);
          } catch (err) {
            errors++;
            await ctx.events.emit({
              kind: 'scan_error',
              message: `Error consultando Computrabajo.cl: ${err instanceof Error ? err.message : String(err)}`,
              payload: { query, page: pageNo },
            });
            // Stop paginating this query on error — try the next query.
            break;
          }

          if (jobs.length === 0) break;

          for (const job of jobs) {
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

          if (jobs.length < PAGE_SIZE) break;
        }
      }
    } finally {
      // Resource cleanup per SPEC-CB-006: the browser is always closed,
      // even when individual pages throw. `close()` swallows its own errors
      // here because we already propagated anything that mattered.
      if (context) await context.close().catch(() => undefined);
      if (browser) await browser.close().catch(() => undefined);
    }

    await ctx.events.emit({
      kind: 'scan_completed',
      message: `Escaneo de Computrabajo.cl completado: ${jobsFound} ofertas encontradas`,
      payload: { jobsFound, errors },
    });

    return { jobsFound, jobsNew: jobsFound, jobsDuplicate, errors };
  },

  async selfCheck(): Promise<SkillHealth> {
    const detectedAt = new Date().toISOString();
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        extraHTTPHeaders: { 'User-Agent': DEFAULT_USER_AGENT },
      });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: 'load' });
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      browser = undefined;
      return { status: 'healthy', schemaVersion: '0.1.0', detectedAt };
    } catch (err) {
      if (browser) await browser.close().catch(() => undefined);
      return {
        status: 'broken',
        schemaVersion: '0.1.0',
        detectedAt,
        lastError: {
          code: 'PLAYWRIGHT_LAUNCH_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  },
};

export default computrabajoSkill;
