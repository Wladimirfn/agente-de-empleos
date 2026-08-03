import type { PlatformSkill, ScanResult, SkillHealth, SkillContext } from '@employment-agent/skill-runtime';
import type { CandidateProfile } from '@employment-agent/domain';

const BASE_URL = 'https://www.chiletrabajos.cl';
const APPROVED_HOST = 'chiletrabajos.cl';
const LISTINGS_PATH = '/encuentra-un-empleo';
const DETAIL_PREFIX = '/trabajo/';
const PAGE_SIZE = 30;
const MAX_PAGES_PER_QUERY = 2;
const MAX_QUERIES = 3;
const MAX_QUERY_LENGTH = 30;
const MAX_TITLE_LENGTH = 200;
const MAX_COMPANY_LENGTH = 120;
const MAX_LOCATION_LENGTH = 120;
const MAX_DETAIL_DESCRIPTION = 1200;
const MAX_TRUNCATED_DESCRIPTION = 280;
const REQUEST_TIMEOUT_MS = 15_000;
const PER_SCAN_TIME_BUDGET_MS = 60_000;
const DEFAULT_QUERIES = ['mantención', 'refrigeración', 'bodega', 'operario'];
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'es-CL,es;q=0.9,en;q=0.5',
  Referer: `${BASE_URL}${LISTINGS_PATH}`,
};

export interface NormalizedJob {
  externalId: string;
  title: string;
  company?: string;
  location?: string;
  url: string;
  description?: string;
  publishedAt?: string;
  modality?: string;
  employmentType?: string;
}

export interface ListingCard {
  externalId: string;
  title: string;
  url: string;
  company?: string;
  location?: string;
  publishedAt?: string;
}

export interface ListingMeta {
  title: string;
  company?: string;
  location?: string;
  publishedAt?: string;
}

export function buildQueries(profile: CandidateProfile): string[] {
  const summary = profile.summary ?? '';
  const rolesMatch = summary.match(/Roles objetivo activos:\s*(.+)/);
  const targetRoles = rolesMatch
    ? (rolesMatch[1] ?? '').split(',').map((role) => role.replace(/\s*\(prioridad\s*\d+\)/, '').trim()).filter(Boolean)
    : [];
  const shortSkills = (profile.skills ?? [])
    .map((skill) => skill.name?.trim())
    .filter((name): name is string => Boolean(name && name.length > 1 && name.length <= MAX_QUERY_LENGTH));
  const combined = [...new Set([...targetRoles, ...shortSkills])];
  return (combined.length > 0 ? combined : DEFAULT_QUERIES).slice(0, MAX_QUERIES);
}

export function buildListingsUrl(query: string, page: number): string {
  const params = new URLSearchParams({ keyword: query, sort: 'Fecha' });
  if (page <= 1) return `${BASE_URL}${LISTINGS_PATH}?${params.toString()}`;
  return `${BASE_URL}${LISTINGS_PATH}/${page}?${params.toString()}`;
}

export function buildDetailUrl(slug: string, id: string): string {
  return `${BASE_URL}${DETAIL_PREFIX}${slug}-${id}`;
}

export function parseJobSlugAndId(slugId: string): { slug: string; id: string } | null {
  const idx = slugId.lastIndexOf('-');
  if (idx <= 0 || idx >= slugId.length - 1) return null;
  const slug = slugId.slice(0, idx).trim();
  const id = slugId.slice(idx + 1).trim();
  if (!/^\d+$/.test(id)) return null;
  return { slug, id };
}

export function extractExternalId(href: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, BASE_URL);
    if (url.hostname.toLowerCase().endsWith(APPROVED_HOST) === false) return null;
    const match = url.pathname.match(/^\/trabajo\/([^/?#]+)/);
    if (!match) return null;
    return parseJobSlugAndId(match[1] ?? '')?.id ?? null;
  } catch {
    return null;
  }
}

const ANCHOR_RE = /<a\b[^>]*?\bhref="([^"]*?)"[^>]*>([\s\S]*?)<\/a>/gi;

export function parseListingsHtml(html: string): ListingCard[] {
  if (!html) return [];
  const cards: ListingCard[] = [];
  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = match[1] ?? '';
    const inner = (match[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!href.includes('/trabajo/')) continue;
    const id = extractExternalId(href);
    if (!id) continue;
    const title = inner.slice(0, MAX_TITLE_LENGTH);
    if (!title) continue;
    cards.push({ externalId: id, title, url: new URL(href, BASE_URL).toString() });
  }
  const seen = new Set<string>();
  return cards.filter((card) => (seen.has(card.externalId) ? false : seen.add(card.externalId)));
}

export function parseListingMeta(html: string, externalId: string): ListingMeta | null {
  if (!html) return null;
  const anchorRe = new RegExp(`<a\\b[^>]*?\\bhref="[^"]*${externalId}[^"]*"[^>]*>([\\s\\S]*?)<\/a>([\\s\\S]*?)<a\\b`, 'i');
  const anchorMatch = html.match(anchorRe);
  if (!anchorMatch) return null;
  const titleText = (anchorMatch[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const siblingText = (anchorMatch[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const segments = siblingText.split('·').map((segment) => segment.trim()).filter(Boolean);
  const companySegment = segments[0] ?? '';
  const company = companySegment.replace(/^Empresa\s+/i, '').trim() || undefined;
  const location = segments.find((segment) => /^Ubicaci[oó]n\b/i.test(segment))?.replace(/^Ubicaci[oó]n\s+/i, '').trim() || segments[1];
  const publishedAt = segments.find((segment) => /^Publicada\b/i.test(segment))?.replace(/^Publicada\s+/i, '').trim();
  return {
    title: titleText.slice(0, MAX_TITLE_LENGTH),
    company: company?.slice(0, MAX_COMPANY_LENGTH),
    location: location?.slice(0, MAX_LOCATION_LENGTH),
    publishedAt,
  };
}

export function parseDetailDescription(html: string): { description?: string; modality?: string; employmentType?: string } {
  if (!html) return {};
  const description = html.match(/<meta\b[^>]*?\bname="description"[^>]*?\bcontent="([^"]*)"/i)?.[1]?.trim().slice(0, MAX_DETAIL_DESCRIPTION);
  const detailText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const modality = (detailText.match(/Modalidad:\s*([^·.]+)/i)?.[1] ?? detailText.match(/Modalidad\s+([^·.]+)/i)?.[1])?.trim().slice(0, 60);
  const employmentType = (detailText.match(/Jornada:\s*([^·.]+)/i)?.[1] ?? detailText.match(/Jornada\s+([^·.]+)/i)?.[1])?.trim().slice(0, 60);
  return { description, modality, employmentType };
}

export function normalizeListing(card: ListingCard, meta: ListingMeta | null): NormalizedJob {
  const title = meta?.title || card.title;
  const job: NormalizedJob = { externalId: card.externalId, title, url: card.url };
  const company = (meta?.company ?? card.company)?.trim();
  if (company) job.company = company.slice(0, MAX_COMPANY_LENGTH);
  const location = (meta?.location ?? card.location)?.trim();
  if (location) job.location = location.slice(0, MAX_LOCATION_LENGTH);
  if (card.publishedAt || meta?.publishedAt) job.publishedAt = (card.publishedAt ?? meta?.publishedAt)?.trim();
  return job;
}

export function ensureApprovedOrigin(url: string): URL {
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase().endsWith(APPROVED_HOST) === false) {
    throw new Error(`Host no aprobado: ${parsed.hostname}`);
  }
  return parsed;
}

export interface ListingsFetch {
  get(url: string, options?: { timeout?: number }): Promise<{ ok(): boolean; status(): number; text(): Promise<string>; url?: () => string }>;
}

export interface ChiletrabajosScanOptions { fetcher?: ListingsFetch; now?: () => number }

export interface PlaywrightApiResponse {
  ok(): boolean;
  status(): number;
  text(): Promise<string>;
  url(): string;
}

interface PlaywrightRequestContext { get(url: string, options?: unknown): Promise<PlaywrightApiResponse>; dispose(): Promise<void> }

async function resolveClient(opts: ChiletrabajosScanOptions): Promise<{ client: ListingsFetch; owned: boolean; dispose?: () => Promise<void> }> {
  if (opts.fetcher) return { client: opts.fetcher, owned: false };
  const mod = await import('playwright');
  const context = (await mod.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: DEFAULT_HEADERS })) as unknown as PlaywrightRequestContext;
  return {
    client: {
      get: async (url: string, options?: { timeout?: number }) => {
        const response = await context.get(url, options ?? {});
        return { ok: () => response.ok(), status: () => response.status(), text: async () => response.text(), url: () => response.url() };
      },
    },
    owned: true,
    dispose: () => context.dispose(),
  };
}

interface ScanStats { jobsFound: number; jobsDuplicate: number; errors: number }

async function fetchListings(client: ListingsFetch, url: string): Promise<string> {
  ensureApprovedOrigin(url);
  const response = await client.get(url, { timeout: REQUEST_TIMEOUT_MS });
  const status = response.status();
  if (status >= 200 && status < 300) return response.text();
  if (status >= 300 && status < 400) throw new Error(`Redirect no resuelto para <url>`);
  throw new Error(`Chiletrabajos search HTTP ${status} (<url>)`);
}

function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let cleaned = raw.replace(/\s+(at\s+[\w./:$<>]+\s*\(?[^)]*\)?|\bat\s+[\w./:$<>]+:\d+:\d+\)?)/gi, ' ');
  cleaned = cleaned.replace(/https?:\/\/[^\s<>"']+/gi, '<url>').replace(/file:\/\/[^\s<>"']+/gi, '<url>');
  cleaned = cleaned.replace(/(?:[A-Za-z]:\\|\/tmp\/|\/opt\/|\/srv\/|\/home\/|\/var\/|\/etc\/)[^\s<>"']*/gi, '<path>');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned || 'error';
}

async function crawlPage(client: ListingsFetch, query: string, page: number, stats: ScanStats, ctx: SkillContext): Promise<string | null> {
  try { return await fetchListings(client, buildListingsUrl(query, page)); }
  catch (err) {
    stats.errors++;
    await ctx.events.emit({ kind: 'scan_error', message: `Error consultando Chiletrabajos.cl: ${sanitizeError(err)}`, payload: { query, page } });
    return null;
  }
}

async function buildJobCard(client: ListingsFetch, listingsHtml: string, card: ListingCard, now: () => number, deadline: number): Promise<NormalizedJob> {
  const meta = parseListingMeta(listingsHtml, card.externalId);
  const job = normalizeListing(card, meta);
  if (now() >= deadline) {
    job.description = `Oferta en Chiletrabajos.cl: ${job.title}.`.slice(0, MAX_TRUNCATED_DESCRIPTION);
    return job;
  }
  try {
    const detailHtml = await fetchListings(client, card.url);
    const detail = parseDetailDescription(detailHtml);
    if (detail.description) job.description = detail.description;
    if (detail.modality) job.modality = detail.modality;
    if (detail.employmentType) job.employmentType = detail.employmentType;
  } catch {
    job.description = `Oferta en Chiletrabajos.cl: ${job.title}.`;
  }
  return job;
}

export const chiletrabajosSkill: PlatformSkill = {
  slug: 'chiletrabajos',
  version: '0.1.0',
  displayName: 'Chiletrabajos.cl',
  requiredCandidateFields: [],
  capabilities: { canScan: true, canApply: false, canDetectLoggedOut: false },

  async scan(profile: CandidateProfile, ctx: SkillContext): Promise<ScanResult> {
    const queries = buildQueries(profile);
    await ctx.events.emit({ kind: 'scan_started', message: `Iniciando escaneo de Chiletrabajos.cl (${queries.join(', ')})`, payload: { profileId: profile.id ?? null, queries } });
    const opts: ChiletrabajosScanOptions = {};
    const now = opts.now ?? Date.now;
    const deadline = now() + PER_SCAN_TIME_BUDGET_MS;
    const resolved = await resolveClient(opts);
    const stats: ScanStats = { jobsFound: 0, jobsDuplicate: 0, errors: 0 };
    const seen = new Set<string>();
    try {
      try { await fetchListings(resolved.client, buildListingsUrl(queries[0] ?? '', 1)); }
      catch (err) {
        stats.errors++;
        await ctx.events.emit({ kind: 'scan_error', message: `Error en warm-up de Chiletrabajos.cl: ${sanitizeError(err)}`, payload: { query: '<home>', page: 0 } });
      }
      for (const query of queries) {
        for (let page = 1; page <= MAX_PAGES_PER_QUERY; page++) {
          if (now() > deadline) break;
          const html = await crawlPage(resolved.client, query, page, stats, ctx);
          if (html === null) break;
          const cards = parseListingsHtml(html);
          if (cards.length === 0) break;
          for (const card of cards) {
            if (now() > deadline) break;
            if (seen.has(card.externalId)) { stats.jobsDuplicate++; continue; }
            seen.add(card.externalId);
            const job = await buildJobCard(resolved.client, html, card, now, deadline);
            stats.jobsFound++;
            await ctx.events.emit({ kind: 'job_found', message: `Encontrada: ${job.title}${job.company ? ` en ${job.company}` : ''}`, payload: job });
          }
        }
      }
    } finally {
      if (resolved?.owned && resolved.dispose) {
        try { await resolved.dispose(); } catch { /* swallow dispose errors */ }
      }
    }
    await ctx.events.emit({ kind: 'scan_completed', message: `Escaneo de Chiletrabajos.cl completado: ${stats.jobsFound} ofertas encontradas`, payload: { jobsFound: stats.jobsFound, errors: stats.errors } });
    return { jobsFound: stats.jobsFound, jobsNew: stats.jobsFound, jobsDuplicate: stats.jobsDuplicate, errors: stats.errors };
  },

  async selfCheck(): Promise<SkillHealth> {
    const detectedAt = new Date().toISOString();
    let resolved: Awaited<ReturnType<typeof resolveClient>> | undefined;
    try {
      resolved = await resolveClient({});
    } catch (err) {
      return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'CHILETRABAJOS_FETCH', message: err instanceof Error ? err.message : String(err) } };
    }
    try {
      const response = await resolved.client.get(`${BASE_URL}${LISTINGS_PATH}`, { timeout: REQUEST_TIMEOUT_MS });
      const status = response.status();
      const finalUrl = response.url?.() ?? `${BASE_URL}${LISTINGS_PATH}`;
      if (status >= 200 && status < 300) {
        try { ensureApprovedOrigin(finalUrl); return { status: 'healthy', schemaVersion: '0.1.0', detectedAt }; }
        catch { return { status: 'degraded', schemaVersion: '0.1.0', detectedAt }; }
      }
      if (status >= 300 && status < 400) {
        try { ensureApprovedOrigin(finalUrl); return { status: 'healthy', schemaVersion: '0.1.0', detectedAt }; }
        catch { return { status: 'degraded', schemaVersion: '0.1.0', detectedAt }; }
      }
      return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'CHILETRABAJOS_HTTP', message: `HTTP ${status}` } };
} catch (err) {
      return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'CHILETRABAJOS_FETCH', message: sanitizeError(err) } };
    } finally {
      if (resolved?.owned && resolved.dispose) {
        try { await resolved.dispose(); } catch { /* swallow dispose errors */ }
      }
    }
  },
};

export default chiletrabajosSkill;