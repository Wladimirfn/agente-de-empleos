import type { PlatformSkill, ScanResult, SkillHealth, SkillContext } from '@employment-agent/skill-runtime';
import type { CandidateProfile } from '@employment-agent/domain';

const BASE_URL = 'https://www.empleosaqua.cl';
const APPROVED_HOST = 'empleosaqua.cl';
const LISTINGS_PATH = '/offer/list';
const FEATURED_PATH = '/offer/featured';
const DETAIL_PREFIX = '/offer/show/';
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
const DEFAULT_QUERIES = ['acuicultura', 'salmonero', 'mantención', 'operario', 'técnico'];
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

export interface ListingsFetch {
  get(url: string, options?: { timeout?: number }): Promise<{ ok(): boolean; status(): number; text(): Promise<string>; url?: () => string }>;
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

export function buildListingsUrl(featured: boolean, page: number): string {
  const path = featured ? FEATURED_PATH : LISTINGS_PATH;
  if (page <= 1) return `${BASE_URL}${path}`;
  return `${BASE_URL}${path}?page=${page}`;
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
    const match = url.pathname.match(/^\/offer\/show\/([^/?#]+)/);
    if (!match) return null;
    return parseJobSlugAndId(match[1] ?? '')?.id ?? null;
  } catch {
    return null;
  }
}

const H5_RE = /<h5\b[^>]*>\s*<a\b[^>]*?\bhref="([^"]*?)"[^>]*>([\s\S]*?)<\/a>\s*<\/h5>/gi;

export function parseListingsHtml(html: string): ListingCard[] {
  if (!html) return [];
  const cards: ListingCard[] = [];
  for (const match of html.matchAll(H5_RE)) {
    const href = match[1] ?? '';
    const inner = (match[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!href.includes('/offer/show/')) continue;
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
  const anchorRe = new RegExp(`<h5\\b[^>]*>\\s*<a\\b[^>]*?\\bhref="[^"]*${externalId}[^"]*"[^>]*>([\\s\\S]*?)<\\/a>\\s*<\\/h5>([\\s\\S]*?)(?=<h5\\b|<\\/ul>)`, 'i');
  const anchorMatch = html.match(anchorRe);
  if (!anchorMatch) return null;
  const titleText = (anchorMatch[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const siblingText = (anchorMatch[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const company = (siblingText.match(/^([^-]+?)\s*-\s*[^,·.]+/)?.[1]?.trim()) ?? undefined;
  const city = (siblingText.match(/-\s*([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑ\s]+),\s*[A-ZÁÉÍÓÚÑ]+/)?.[1]?.trim()) ?? siblingText.match(/^([^,·.\n]+)$/m)?.[1]?.trim();
  const modality = siblingText.match(/Presencial|Teletrabajo|Híbrido|Remoto/i)?.[0]?.trim();
  return {
    title: titleText.slice(0, MAX_TITLE_LENGTH),
    company: company?.slice(0, MAX_COMPANY_LENGTH),
    location: city?.slice(0, MAX_LOCATION_LENGTH),
    publishedAt: undefined,
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

export interface EmpleosAquaScanOptions { fetcher?: ListingsFetch; now?: () => number; featured?: boolean }

export interface PlaywrightApiResponse {
  ok(): boolean;
  status(): number;
  text(): Promise<string>;
  url(): string;
}

interface PlaywrightRequestContext { get(url: string, options?: unknown): Promise<PlaywrightApiResponse>; dispose(): Promise<void> }

function sanitizeMessage(text: string): string {
  return text
    .replace(/https?:\/\/[^\s<>"']+/gi, '<url>')
    .replace(/file:\/\/[^\s<>"']+/gi, '<url>')
    .replace(/(?:[A-Za-z]:\\|\/tmp\/|\/opt\/|\/srv\/|\/home\/|\/var\/|\/etc\/)[^\s<>"']*/gi, '<path>')
    .replace(/cf[-_ ]?ray(?:\s*id)?\s*[:=]?\s*[a-z0-9-]+/gi, 'cf-ray')
    .replace(/\bbearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <token>')
    .replace(/\bsk-live-[A-Za-z0-9_-]+/gi, 'sk-live-<redacted>')
    .replace(/([?&])(key|api[_-]?key|token)=([^&\s]+)/gi, '$1$2=<redacted>')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeJobPayload<T extends Record<string, unknown>>(payload: T): T {
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') return sanitizeMessage(value);
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

async function resolveClient(opts: EmpleosAquaScanOptions): Promise<{ client: ListingsFetch; owned: boolean; dispose?: () => Promise<void> }> {
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

// Cloudflare / blocked vocabulary — intentionally duplicated from
// `skills/chiletrabajos/index.ts` per skill-isolation (Empleos Aqua must
// remain independent of other runtime surfaces).
const CHALLENGE_MARKERS = ['cf-mitigated', 'challenge-running', 'just a moment', 'attention required', 'verify you are human', 'checking your browser'];
const BLOCKED_MARKERS = ['access denied', 'forbidden', 'service unavailable', 'http 403', 'http 500'];

export type PortalResponseKind = 'jobs' | 'challenge' | 'blocked' | 'redirect' | 'error';

function isApprovedFinalUrl(finalUrl: string | undefined): boolean {
  if (!finalUrl) return false;
  try { return new URL(finalUrl).hostname.toLowerCase().endsWith(APPROVED_HOST); } catch { return false; }
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
  readonly kind = 'EMPLEOSAQUA_CHALLENGE' as const;
  readonly code = 'EMPLEOSAQUA_CHALLENGE' as const;
  constructor() { super('Portal requires human verification; cannot scan from this environment'); this.name = 'ChallengeBlockedError'; }
}

export class BlockedPortalError extends Error {
  readonly kind = 'EMPLEOSAQUA_BLOCKED' as const;
  readonly code = 'EMPLEOSAQUA_BLOCKED' as const;
  constructor() { super('Portal has blocked this client; cannot scan from this environment'); this.name = 'BlockedPortalError'; }
}

export class TransportError extends Error {
  readonly kind = 'EMPLEOSAQUA_TRANSPORT' as const;
  readonly code = 'EMPLEOSAQUA_TRANSPORT' as const;
  constructor(message: string) { super(message); this.name = 'TransportError'; }
}

async function fetchListings(client: ListingsFetch, url: string): Promise<string> {
  ensureApprovedOrigin(url);
  const response = await client.get(url, { timeout: REQUEST_TIMEOUT_MS });
  const status = response.status();
  const finalUrl = response.url?.();
  const text = await response.text();
  if (status >= 300 && status < 400) {
    if (finalUrl && new URL(finalUrl).hostname.toLowerCase().endsWith(APPROVED_HOST)) return text;
    throw new TransportError('Redirect fuera del host aprobado');
  }
  if (status >= 200 && status < 300) {
    const kind = classifyPortalResponse(status, text, finalUrl);
    if (kind === 'challenge') throw new ChallengeBlockedError();
    if (kind === 'blocked') throw new BlockedPortalError();
    return text;
  }
  throw new TransportError(`Empleos Aqua search HTTP ${status} (<url>)`);
}

async function crawlPage(client: ListingsFetch, query: string, page: number, stats: ScanStats, ctx: SkillContext, featured: boolean): Promise<string | null> {
  try { return await fetchListings(client, buildListingsUrl(featured, page)); }
  catch (err) {
    if (err instanceof ChallengeBlockedError || err instanceof BlockedPortalError) throw err;
    stats.errors++;
    await ctx.events.emit({ kind: 'scan_error', message: `Error consultando Empleos Aqua: ${sanitizeMessage(err instanceof Error ? err.message : String(err))}`, payload: { query, page } });
    return null;
  }
}

async function buildJobCard(client: ListingsFetch, listingsHtml: string, card: ListingCard, now: () => number, deadline: number): Promise<NormalizedJob> {
  const meta = parseListingMeta(listingsHtml, card.externalId);
  const job = normalizeListing(card, meta);
  if (now() >= deadline) {
    job.description = `Oferta en Empleos Aqua: ${job.title}.`.slice(0, MAX_TRUNCATED_DESCRIPTION);
    return job;
  }
  if (now() >= deadline) return job;
  try {
    const detailHtml = await fetchListings(client, card.url);
    const detail = parseDetailDescription(detailHtml);
    if (detail.description) job.description = detail.description;
    if (detail.modality) job.modality = detail.modality;
    if (detail.employmentType) job.employmentType = detail.employmentType;
  } catch {
    job.description = `Oferta en Empleos Aqua: ${job.title}.`;
  }
  return job;
}

export const empleosaquaSkill: PlatformSkill = {
  slug: 'empleosaqua',
  version: '0.1.0',
  displayName: 'Empleos Aqua',
  requiredCandidateFields: [],
  capabilities: { canScan: true, canApply: false, canDetectLoggedOut: false },

  async scan(profile: CandidateProfile, ctx: SkillContext): Promise<ScanResult> {
    const queries = buildQueries(profile);
    await ctx.events.emit({ kind: 'scan_started', message: `Iniciando escaneo de Empleos Aqua (${queries.join(', ')})`, payload: { queries } });
    const opts: EmpleosAquaScanOptions = {};
    const featured = opts.featured ?? false;
    const now = opts.now ?? Date.now;
    const deadline = now() + PER_SCAN_TIME_BUDGET_MS;
    let resolved: Awaited<ReturnType<typeof resolveClient>> | undefined;
    try {
      resolved = await resolveClient(opts);
    } catch (err) {
      await ctx.events.emit({ kind: 'scan_error', message: `Error inicializando Empleos Aqua: ${sanitizeMessage(err instanceof Error ? err.message : String(err))}`, payload: { code: 'EMPLEOSAQUA_FETCH' } });
      await ctx.events.emit({ kind: 'scan_completed', message: 'Escaneo de Empleos Aqua detenido: no se pudo inicializar el cliente', payload: { jobsFound: 0, errors: 1 } });
      return { jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 1 };
    }
    const stats: ScanStats = { jobsFound: 0, jobsDuplicate: 0, errors: 0 };
    const seen = new Set<string>();
    let blocked: ChallengeBlockedError | BlockedPortalError | null = null;
    try {
      try { await fetchListings(resolved.client, buildListingsUrl(featured, 1)); }
      catch (err) {
        if (err instanceof ChallengeBlockedError || err instanceof BlockedPortalError) blocked = err;
        else { stats.errors++; await ctx.events.emit({ kind: 'scan_error', message: `Error en warm-up de Empleos Aqua: ${sanitizeMessage(err instanceof Error ? err.message : String(err))}`, payload: { query: '<home>', page: 0 } }); }
      }
      if (blocked) {
        await ctx.events.emit({ kind: 'scan_error', message: blocked.message, payload: { code: blocked.code, reason: blocked instanceof ChallengeBlockedError ? 'challenge' : 'blocked' } });
        await ctx.events.emit({ kind: 'scan_completed', message: `Escaneo de Empleos Aqua detenido: ${blocked.message}`, payload: { jobsFound: 0, errors: 1 } });
        return { jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 1 };
      }
      for (const query of queries) {
        for (let page = 1; page <= MAX_PAGES_PER_QUERY; page++) {
          if (now() >= deadline) break;
          const html = await crawlPage(resolved.client, query, page, stats, ctx, featured);
          if (html === null) break;
          const cards = parseListingsHtml(html);
          if (cards.length === 0) break;
          for (const card of cards) {
            if (now() >= deadline) break;
            if (seen.has(card.externalId)) { stats.jobsDuplicate++; continue; }
            seen.add(card.externalId);
            const job = await buildJobCard(resolved.client, html, card, now, deadline);
            stats.jobsFound++;
            await ctx.events.emit({ kind: 'job_found', message: sanitizeMessage(`Encontrada: ${job.title}${job.company ? ` en ${job.company}` : ''}`), payload: sanitizeJobPayload(job as unknown as Record<string, unknown>) });
          }
        }
      }
    } catch (err) {
      if (err instanceof ChallengeBlockedError || err instanceof BlockedPortalError) blocked = err;
      else throw err;
    } finally {
      if (resolved?.owned && resolved.dispose) {
        try { await resolved.dispose(); } catch { /* swallow dispose errors */ }
      }
    }
    if (blocked) {
      await ctx.events.emit({ kind: 'scan_error', message: blocked.message, payload: { code: blocked.code, reason: blocked instanceof ChallengeBlockedError ? 'challenge' : 'blocked' } });
      await ctx.events.emit({ kind: 'scan_completed', message: `Escaneo de Empleos Aqua detenido: ${blocked.message}`, payload: { jobsFound: 0, errors: 1 } });
      return { jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 1 };
    }
    await ctx.events.emit({ kind: 'scan_completed', message: `Escaneo de Empleos Aqua completado: ${stats.jobsFound} ofertas encontradas`, payload: { jobsFound: stats.jobsFound, errors: stats.errors } });
    return { jobsFound: stats.jobsFound, jobsNew: stats.jobsFound, jobsDuplicate: stats.jobsDuplicate, errors: stats.errors };
  },

  async selfCheck(): Promise<SkillHealth> {
    const detectedAt = new Date().toISOString();
    let resolved: Awaited<ReturnType<typeof resolveClient>> | undefined;
    try { resolved = await resolveClient({}); }
    catch (err) {
      return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'EMPLEOSAQUA_FETCH', message: sanitizeMessage(err instanceof Error ? err.message : String(err)) } };
    }
    try {
      const response = await resolved.client.get(`${BASE_URL}${LISTINGS_PATH}`, { timeout: REQUEST_TIMEOUT_MS });
      const status = response.status();
      const finalUrl = response.url?.() ?? `${BASE_URL}${LISTINGS_PATH}`;
      if (status >= 300 && status < 400) {
        try { ensureApprovedOrigin(finalUrl); return { status: 'healthy', schemaVersion: '0.1.0', detectedAt }; }
        catch { return { status: 'degraded', schemaVersion: '0.1.0', detectedAt }; }
      }
      if (status >= 200 && status < 300) {
        const kind = classifyPortalResponse(status, await response.text(), finalUrl);
        if (kind === 'challenge') return { status: 'needs-human', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'EMPLEOSAQUA_CHALLENGE', message: new ChallengeBlockedError().message } };
        if (kind === 'blocked') return { status: 'needs-human', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'EMPLEOSAQUA_BLOCKED', message: new BlockedPortalError().message } };
        try { ensureApprovedOrigin(finalUrl); return { status: 'healthy', schemaVersion: '0.1.0', detectedAt }; }
        catch { return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'EMPLEOSAQUA_HTTP', message: 'probe landed on a foreign origin' } }; }
      }
      return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'EMPLEOSAQUA_HTTP', message: `HTTP ${status}` } };
    } catch (err) {
      if (err instanceof ChallengeBlockedError) return { status: 'needs-human', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'EMPLEOSAQUA_CHALLENGE', message: err.message } };
      if (err instanceof BlockedPortalError) return { status: 'needs-human', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'EMPLEOSAQUA_BLOCKED', message: err.message } };
      return { status: 'broken', schemaVersion: '0.1.0', detectedAt, lastError: { code: 'EMPLEOSAQUA_FETCH', message: sanitizeMessage(err instanceof Error ? err.message : String(err)) } };
    } finally {
      if (resolved?.owned && resolved.dispose) {
        try { await resolved.dispose(); } catch { /* swallow dispose errors */ }
      }
    }
  },
};

export default empleosaquaSkill;