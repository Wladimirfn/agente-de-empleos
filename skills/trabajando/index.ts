import type { PlatformSkill, ScanResult, SkillHealth, SkillContext } from '@employment-agent/skill-runtime';
import type { CandidateProfile } from '@employment-agent/domain';

const BASE_URL = 'https://www.trabajando.cl';
const APPROVED_HOST = 'trabajando.cl';
const SITEMAP_PATHS = { index: '/sitemap.xml', offers: '/sitemap-ofertas.xml' } as const;
const DETAIL_PREFIX = '/trabajo/';
export const MAX_OFFERS_PER_SCAN = 60;
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
const DEFAULT_QUERIES = ['mantención', 'refrigeración', 'bodega', 'operario', 'técnico', 'logística'];
const DEFAULT_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Accept-Language': 'es-CL,es;q=0.9,en;q=0.5', Referer: `${BASE_URL}/` };

export interface NormalizedJob { externalId: string; title: string; company?: string; location?: string; url: string; description?: string; publishedAt?: string; modality?: string; employmentType?: string }
export interface ListingCard { externalId: string; title: string; url: string; lastmod?: string }
export interface ListingsFetch { get(url: string, options?: { timeout?: number }): Promise<{ ok(): boolean; status(): number; text(): Promise<string>; url?: () => string }> }
export interface JsonLdJobPosting {
  title?: string; description?: string; datePosted?: string; validThrough?: string; employmentType?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
  baseSalary?: { value?: { value?: number | string; unitText?: string } };
  experienceRequirements?: { monthsOfExperience?: number };
}

export function buildQueries(profile: CandidateProfile): string[] {
  const summary = profile.summary ?? '';
  const rolesMatch = summary.match(/Roles objetivo activos:\s*(.+)/);
  const targetRoles = rolesMatch ? (rolesMatch[1] ?? '').split(',').map((role) => role.replace(/\s*\(prioridad\s*\d+\)/, '').trim()).filter(Boolean) : [];
  const shortSkills = (profile.skills ?? []).map((skill) => skill.name?.trim()).filter((name): name is string => Boolean(name && name.length > 1 && name.length <= MAX_QUERY_LENGTH));
  const combined = [...new Set([...targetRoles, ...shortSkills])];
  return (combined.length > 0 ? combined : DEFAULT_QUERIES).slice(0, MAX_QUERIES);
}

export function buildSitemapUrl(kind: keyof typeof SITEMAP_PATHS): string { return `${BASE_URL}${SITEMAP_PATHS[kind]}`; }
export function buildDetailUrl(slug: string, id: string): string { return `${BASE_URL}${DETAIL_PREFIX}${id}-${slug}`; }

export function parseJobSlugAndId(slugId: string): { slug: string; id: string } | null {
  const match = slugId.match(/^(\d+)-(.+)$/);
  return match ? { id: match[1]!, slug: match[2]! } : null;
}

export function extractExternalId(href: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, BASE_URL);
    if (!isApprovedHost(url.hostname)) return null;
    const match = url.pathname.match(/^\/trabajo\/([^/?#]+)/);
    return match ? parseJobSlugAndId(match[1] ?? '')?.id ?? null : null;
  } catch { return null; }
}

const URL_RE = /<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]*)<\/lastmod>)?[\s\S]*?<\/url>/gi;

export function parseOffersSitemap(xml: string): ListingCard[] {
  if (!xml) return [];
  const cards: ListingCard[] = [];
  for (const match of xml.matchAll(URL_RE)) {
    const loc = (match[1] ?? '').trim();
    const lastmod = match[2]?.trim();
    const id = extractExternalId(loc);
    if (!id) continue;
    cards.push({ externalId: id, title: '', url: new URL(loc, BASE_URL).toString(), ...(lastmod ? { lastmod } : {}) });
    if (cards.length >= MAX_OFFERS_PER_SCAN) break;
  }
  return cards;
}

function normalize(value: string): string { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }

export function filterOffersByQueries(cards: readonly ListingCard[], queries: readonly string[]): ListingCard[] {
  const tokens = queries.flatMap((query) => normalize(query).split(/\s+/).filter((token) => token.length > 1));
  if (tokens.length === 0) return [];
  const tokenSet = new Set(tokens);
  return cards.filter((card) => {
    let slugId = '';
    try { slugId = new URL(card.url).pathname.replace(/^\/trabajo\//, ''); } catch { /* malformed url */ }
    if (!slugId) return false;
    const normalizedSlug = normalize(slugId);
    return Array.from(tokenSet).some((token) => normalizedSlug.includes(token));
  });
}

function decodeEscaped(value: string): string {
  return value.replace(/\\u003[Cc]/g, '<').replace(/\\u003[Ee]/g, '>').replace(/\\u0026/g, '&').replace(/\\u0022/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

const JSONLD_RE = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i;

export function parseJobPostingJsonLd(html: string): JsonLdJobPosting | null {
  if (!html) return null;
  const match = html.match(JSONLD_RE);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse((match[1] ?? '').trim());
    if (!parsed || typeof parsed !== 'object') return null;
    const root = Array.isArray(parsed) ? (parsed[0] as Record<string, unknown>) : (parsed as Record<string, unknown>);
    if (!root || root['@type'] !== 'JobPosting') return null;
    const address = ((root.jobLocation as Record<string, unknown> | undefined)?.address) as Record<string, unknown> | undefined;
    const org = root.hiringOrganization as Record<string, unknown> | undefined;
    const salary = root.baseSalary as Record<string, unknown> | undefined;
    const salaryValue = salary?.value as Record<string, unknown> | number | string | undefined;
    const exp = root.experienceRequirements as Record<string, unknown> | undefined;
    const text = (v: unknown) => typeof v === 'string' ? decodeEscaped(v) : undefined;
    const bounded = (v: unknown, max: number) => { const s = text(v); return s ? s.slice(0, max) : undefined; };
    return {
      title: bounded(root.title, MAX_TITLE_LENGTH),
      description: bounded(root.description, MAX_DETAIL_DESCRIPTION),
      datePosted: typeof root.datePosted === 'string' ? root.datePosted : undefined,
      validThrough: typeof root.validThrough === 'string' ? root.validThrough : undefined,
      employmentType: typeof root.employmentType === 'string' ? root.employmentType : undefined,
      hiringOrganization: org ? { name: bounded(org.name, MAX_COMPANY_LENGTH) } : undefined,
      jobLocation: address ? { address: { addressLocality: bounded(address.addressLocality, MAX_LOCATION_LENGTH), addressRegion: bounded(address.addressRegion, MAX_LOCATION_LENGTH), addressCountry: bounded(address.addressCountry, MAX_LOCATION_LENGTH) } } : undefined,
      baseSalary: salary && salaryValue ? { value: { value: typeof salaryValue === 'object' ? (salaryValue as Record<string, unknown>).value as number | string | undefined : salaryValue as number | string | undefined, unitText: typeof salary.unitText === 'string' ? salary.unitText : undefined } } : undefined,
      experienceRequirements: exp && typeof exp.monthsOfExperience === 'number' ? { monthsOfExperience: exp.monthsOfExperience } : undefined,
    };
  } catch { return null; }
}

export function normalizeListing(card: ListingCard, jsonLd: JsonLdJobPosting | null): NormalizedJob {
  const title = jsonLd?.title || card.title;
  const job: NormalizedJob = { externalId: card.externalId, title: title ?? '', url: card.url };
  if (card.lastmod) job.publishedAt = card.lastmod;
  if (jsonLd) {
    if (jsonLd.description) job.description = jsonLd.description;
    if (jsonLd.employmentType) job.employmentType = jsonLd.employmentType;
    if (jsonLd.hiringOrganization?.name) job.company = jsonLd.hiringOrganization.name;
    const addr = jsonLd.jobLocation?.address;
    if (addr) {
      const location = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ');
      if (location) job.location = location;
    }
    if (jsonLd.datePosted && !card.lastmod) job.publishedAt = jsonLd.datePosted;
  }
  return job;
}

export function isApprovedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === APPROVED_HOST || host.endsWith('.' + APPROVED_HOST);
}

export function ensureApprovedOrigin(url: string): URL {
  const parsed = new URL(url);
  if (!isApprovedHost(parsed.hostname)) throw new Error(`Host no aprobado: ${parsed.hostname}`);
  return parsed;
}

export interface TrabajandoScanOptions { fetcher?: ListingsFetch; now?: () => number }
export interface PlaywrightApiResponse { ok(): boolean; status(): number; text(): Promise<string>; url(): string }
interface PlaywrightRequestContext { get(url: string, options?: unknown): Promise<PlaywrightApiResponse>; dispose(): Promise<void> }

function sanitizeText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s<>"']+/gi, '<url>')
    .replace(/file:\/\/[^\s<>"']+/gi, '<url>')
    .replace(/(?:[A-Za-z]:\\|\/tmp\/|\/opt\/|\/srv\/|\/home\/|\/var\/|\/etc\/)[^\s<>"']*/gi, '<path>')
    .replace(/\bbearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <token>')
    .replace(/\bsk-live-[A-Za-z0-9_-]+/gi, 'sk-live-<redacted>')
    .replace(/([?&])(key|api[_-]?key|token)=([^&\s]+)/gi, '$1$2=<redacted>')
    .replace(/\bcf-mitigated\b/gi, 'cf-mitigated')
    .replace(/\bcf[-_ ]?ray(?:\s*id)?\s*[:=]?\s*[a-z0-9-]+/gi, 'cf-ray')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeJobPayload<T extends Record<string, unknown>>(payload: T): T {
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') return sanitizeText(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = scrub(item);
      return out;
    }
    return value;
  };
  return scrub(payload) as T;
}

async function resolveClient(opts: TrabajandoScanOptions): Promise<{ client: ListingsFetch; owned: boolean; dispose?: () => Promise<void> }> {
  if (opts.fetcher) return { client: opts.fetcher, owned: false };
  const mod = await import('playwright');
  const context = (await mod.request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: DEFAULT_HEADERS })) as unknown as PlaywrightRequestContext;
  return {
    client: {
      get: async (url: string, options?: { timeout?: number }) => {
        const response = await context.get(url, options ?? {}) as unknown as PlaywrightApiResponse;
        return { ok: () => response.ok(), status: () => response.status(), text: async () => response.text(), url: () => response.url() };
      },
    },
    owned: true,
    dispose: () => context.dispose(),
  };
}

// Cloudflare / blocked vocabulary — intentionally duplicated from
// `skills/empleosaqua/index.ts` per skill-isolation (Trabajando.cl must
// remain independent of other runtime surfaces).
const CHALLENGE_MARKERS = ['cf-mitigated', 'challenge-running', 'just a moment', 'attention required', 'verify you are human', 'checking your browser'];
const BLOCKED_MARKERS = ['access denied', 'forbidden', 'service unavailable', 'http 403', 'http 500'];

export type PortalResponseKind = 'jobs' | 'challenge' | 'blocked' | 'redirect' | 'error';

function isApprovedFinalUrl(finalUrl: string | undefined): boolean {
  if (!finalUrl) return false;
  try { return isApprovedHost(new URL(finalUrl).hostname); } catch { return false; }
}

export function classifyPortalResponse(status: number, body: string, finalUrl?: string): PortalResponseKind {
  if (status >= 300 && status < 400) return isApprovedFinalUrl(finalUrl) ? 'jobs' : 'redirect';
  if (status >= 200 && status < 300) {
    const lower = body.toLowerCase();
    if (CHALLENGE_MARKERS.some((marker) => lower.includes(marker))) return 'challenge';
    if (BLOCKED_MARKERS.some((marker) => lower.includes(marker))) return 'blocked';
    return 'jobs';
  }
  return 'error';
}

export class ChallengeBlockedError extends Error {
  readonly kind = 'TRABAJANDO_CHALLENGE' as const;
  readonly code = 'TRABAJANDO_CHALLENGE' as const;
  constructor() { super('Portal requires human verification; cannot scan from this environment'); this.name = 'ChallengeBlockedError'; }
}
export class BlockedPortalError extends Error {
  readonly kind = 'TRABAJANDO_BLOCKED' as const;
  readonly code = 'TRABAJANDO_BLOCKED' as const;
  constructor() { super('Portal has blocked this client; cannot scan from this environment'); this.name = 'BlockedPortalError'; }
}
export class TransportError extends Error {
  readonly kind = 'TRABAJANDO_TRANSPORT' as const;
  readonly code = 'TRABAJANDO_TRANSPORT' as const;
  constructor(message: string) { super(message); this.name = 'TransportError'; }
}

async function fetchSitemap(client: ListingsFetch, url: string): Promise<string> {
  ensureApprovedOrigin(url);
  const response = await client.get(url, { timeout: REQUEST_TIMEOUT_MS });
  const status = response.status();
  const finalUrl = response.url?.();
  const text = await response.text();
  if (status >= 300 && status < 400) {
    if (isApprovedFinalUrl(finalUrl)) return text;
    throw new TransportError('Redirect fuera del host aprobado');
  }
  if (status >= 200 && status < 300) {
    const kind = classifyPortalResponse(status, text, finalUrl);
    if (kind === 'challenge') throw new ChallengeBlockedError();
    if (kind === 'blocked') throw new BlockedPortalError();
    return text;
  }
  throw new TransportError(`Trabajando sitemap HTTP ${status} (<url>)`);
}

async function fetchJobPostingJsonLd(client: ListingsFetch, url: string): Promise<JsonLdJobPosting | null> {
  ensureApprovedOrigin(url);
  const response = await client.get(url, { timeout: REQUEST_TIMEOUT_MS });
  const status = response.status();
  const finalUrl = response.url?.();
  const text = await response.text();
  if (status >= 300 && status < 400) {
    if (isApprovedFinalUrl(finalUrl)) return parseJobPostingJsonLd(text);
    throw new TransportError('Redirect fuera del host aprobado');
  }
  if (status >= 200 && status < 300) {
    const kind = classifyPortalResponse(status, text, finalUrl);
    if (kind === 'challenge') throw new ChallengeBlockedError();
    if (kind === 'blocked') throw new BlockedPortalError();
    return parseJobPostingJsonLd(text);
  }
  throw new TransportError(`Trabajando detail HTTP ${status} (<url>)`);
}

interface ScanStats { jobsFound: number; jobsDuplicate: number; errors: number }

export const trabajandoSkill: PlatformSkill = {
  slug: 'trabajando',
  version: '0.1.0',
  displayName: 'Trabajando.cl',
  requiredCandidateFields: [],
  capabilities: { canScan: true, canApply: false, canDetectLoggedOut: false },

  async scan(profile: CandidateProfile, ctx: SkillContext): Promise<ScanResult> {
    const queries = buildQueries(profile);
    await ctx.events.emit({ kind: 'scan_started', message: `Iniciando escaneo de Trabajando.cl (${queries.join(', ')})`, payload: { queries } });
    const opts: TrabajandoScanOptions = {};
    const now = opts.now ?? Date.now;
    const deadline = now() + PER_SCAN_TIME_BUDGET_MS;
    let resolved: Awaited<ReturnType<typeof resolveClient>> | undefined;
    try { resolved = await resolveClient(opts); }
    catch (err) {
      await ctx.events.emit({ kind: 'scan_error', message: `Error inicializando Trabajando.cl: ${sanitizeText(err instanceof Error ? err.message : String(err))}`, payload: { code: 'TRABAJANDO_FETCH' } });
      await ctx.events.emit({ kind: 'scan_completed', message: 'Escaneo de Trabajando.cl detenido: no se pudo inicializar el cliente', payload: { jobsFound: 0, errors: 1 } });
      return { jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 1 };
    }
    const stats: ScanStats = { jobsFound: 0, jobsDuplicate: 0, errors: 0 };
    const seen = new Set<string>();
    let sitemapXml = '';
    try {
      sitemapXml = await fetchSitemap(resolved.client, buildSitemapUrl('offers'));
    } catch (err) {
      if (err instanceof ChallengeBlockedError || err instanceof BlockedPortalError) {
        try { if (resolved.owned && resolved.dispose) await resolved.dispose(); } catch { /* swallow */ }
        await ctx.events.emit({ kind: 'scan_error', message: err.message, payload: { code: err.code, reason: err instanceof ChallengeBlockedError ? 'challenge' : 'blocked' } });
        await ctx.events.emit({ kind: 'scan_completed', message: `Escaneo de Trabajando.cl detenido: ${err.message}`, payload: { jobsFound: 0, errors: 1 } });
        return { jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 1 };
      }
      stats.errors++;
      await ctx.events.emit({ kind: 'scan_error', message: `Error consultando Trabajando.cl: ${sanitizeText(err instanceof Error ? err.message : String(err))}`, payload: { code: 'TRABAJANDO_FETCH' } });
    }
    let blocked: ChallengeBlockedError | BlockedPortalError | null = null;
    try {
      const allCards = parseOffersSitemap(sitemapXml);
      if (allCards.length === 0) {
        try { if (resolved.owned && resolved.dispose) await resolved.dispose(); } catch { /* swallow */ }
        await ctx.events.emit({ kind: 'scan_completed', message: 'Escaneo de Trabajando.cl detenido: sitemap sin ofertas', payload: { jobsFound: 0, errors: stats.errors } });
        return { jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: stats.errors };
      }
      const matched = filterOffersByQueries(allCards, queries).slice(0, MAX_OFFERS_PER_SCAN);
      for (const card of matched) {
        if (now() >= deadline) break;
        if (seen.has(card.externalId)) { stats.jobsDuplicate++; continue; }
        seen.add(card.externalId);
        let job = normalizeListing(card, null);
        if (now() < deadline) {
          try {
            const jsonLd = await fetchJobPostingJsonLd(resolved.client, card.url);
            if (jsonLd) job = normalizeListing(card, jsonLd);
          } catch (err) {
            if (err instanceof ChallengeBlockedError || err instanceof BlockedPortalError) throw err;
            /* keep listing-only metadata on transport errors */
          }
        }
        stats.jobsFound++;
        await ctx.events.emit({ kind: 'job_found', message: sanitizeText(`Encontrada: ${job.title}${job.company ? ` en ${job.company}` : ''}`), payload: sanitizeJobPayload(job as unknown as Record<string, unknown>) });
      }
    } catch (err) {
      if (err instanceof ChallengeBlockedError || err instanceof BlockedPortalError) blocked = err;
      else throw err;
    } finally {
      try { if (resolved.owned && resolved.dispose) await resolved.dispose(); } catch { /* swallow */ }
    }
    if (blocked) {
      await ctx.events.emit({ kind: 'scan_error', message: blocked.message, payload: { code: blocked.code, reason: blocked instanceof ChallengeBlockedError ? 'challenge' : 'blocked' } });
      await ctx.events.emit({ kind: 'scan_completed', message: `Escaneo de Trabajando.cl detenido: ${blocked.message}`, payload: { jobsFound: 0, errors: 1 } });
      return { jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 1 };
    }
    await ctx.events.emit({ kind: 'scan_completed', message: `Escaneo de Trabajando.cl completado: ${stats.jobsFound} ofertas encontradas`, payload: { jobsFound: stats.jobsFound, errors: stats.errors } });
    return { jobsFound: stats.jobsFound, jobsNew: stats.jobsFound, jobsDuplicate: stats.jobsDuplicate, errors: stats.errors };
  },

  async selfCheck(): Promise<SkillHealth> {
    const detectedAt = new Date().toISOString();
    let resolved: Awaited<ReturnType<typeof resolveClient>> | undefined;
    try { resolved = await resolveClient({}); }
    catch (err) {
      return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'TRABAJANDO_FETCH', message: sanitizeText(err instanceof Error ? err.message : String(err)) } };
    }
    try {
      const response = await resolved.client.get(buildSitemapUrl('index'), { timeout: REQUEST_TIMEOUT_MS });
      const status = response.status();
      const finalUrl = response.url?.() ?? buildSitemapUrl('index');
      const text = await response.text();
      if (status >= 300 && status < 400) {
        try { ensureApprovedOrigin(finalUrl); return { status: 'healthy', schemaVersion: '0.1.0', detectedAt }; }
        catch { return { status: 'degraded', schemaVersion: '0.1.0', detectedAt }; }
      }
      if (status >= 200 && status < 300) {
        const kind = classifyPortalResponse(status, text, finalUrl);
        if (kind === 'challenge') return { status: 'needs-human', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'TRABAJANDO_CHALLENGE', message: new ChallengeBlockedError().message } };
        if (kind === 'blocked') return { status: 'needs-human', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'TRABAJANDO_BLOCKED', message: new BlockedPortalError().message } };
        try { ensureApprovedOrigin(finalUrl); return { status: 'healthy', schemaVersion: '0.1.0', detectedAt }; }
        catch { return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'TRABAJANDO_HTTP', message: 'probe landed on a foreign origin' } }; }
      }
      return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'TRABAJANDO_HTTP', message: `HTTP ${status}` } };
    } catch (err) {
      if (err instanceof ChallengeBlockedError) return { status: 'needs-human', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'TRABAJANDO_CHALLENGE', message: err.message } };
      if (err instanceof BlockedPortalError) return { status: 'needs-human', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'TRABAJANDO_BLOCKED', message: err.message } };
      return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'TRABAJANDO_FETCH', message: sanitizeText(err instanceof Error ? err.message : String(err)) } };
    } finally {
      if (resolved?.owned && resolved.dispose) {
        try { await resolved.dispose(); } catch { /* swallow */ }
      }
    }
  },
};

export default trabajandoSkill;