import type { CandidateProfile } from '@employment-agent/domain';

const BASE_URL = 'https://www.trabajando.cl';
const APPROVED_HOST = 'trabajando.cl';
const SITEMAP_PATHS = { index: '/sitemap.xml', offers: '/sitemap-ofertas.xml' } as const;
const DETAIL_PREFIX = '/trabajo/';
const MAX_OFFERS_PER_SCAN = 60;
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