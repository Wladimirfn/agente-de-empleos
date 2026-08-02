import { request as playwrightRequest, chromium, type APIRequestContext } from 'playwright';
import type { PlatformSkill, ScanResult, SkillHealth, SkillContext } from '@employment-agent/skill-runtime';
import type { CandidateProfile } from '@employment-agent/domain';

const BASE_URL = 'https://www.laborum.cl';
const SEARCH_PATH = '/api/avisos/searchV2';
const SITE_ID = 'BMCL';
const PAGE_SIZE = 20;
const MAX_PAGES_PER_QUERY = 3;
const MAX_QUERIES = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_QUERIES = ['mantención', 'refrigeración', 'mantenimiento'];
const MAX_QUERY_LENGTH = 30; // Skip overly long skill descriptions as search queries

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'x-site-id': SITE_ID,
};

export interface LaborumJobPosting {
  id: number;
  titulo?: string;
  empresa?: string;
  localizacion?: string;
  detalle?: string;
  fechaPublicacion?: string;
  modalidadTrabajo?: string;
  tipoTrabajo?: string;
}

export interface LaborumSearchResponse {
  total?: number;
  content?: LaborumJobPosting[];
}

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

export function buildQueries(profile: CandidateProfile): string[] {
  // 1. Extract target roles from the summary (they're short job titles).
  const summary = profile.summary ?? '';
  const rolesMatch = summary.match(/Roles objetivo activos:\s*(.+)/);
  const targetRoles = rolesMatch
    ? (rolesMatch[1] ?? '').split(',').map((r) => r.replace(/\s*\(prioridad\s*\d+\)/, '').trim()).filter(Boolean)
    : [];

  // 2. Short skill names work as search queries; long descriptions don't.
  const shortSkills = (profile.skills ?? [])
    .map((s) => s.name?.trim())
    .filter((name): name is string => Boolean(name && name.length > 1 && name.length <= MAX_QUERY_LENGTH));

  // 3. Combine: target roles first, then short skills, then defaults.
  const combined = [...new Set([...targetRoles, ...shortSkills])];
  return (combined.length > 0 ? combined : DEFAULT_QUERIES).slice(0, MAX_QUERIES);
}

export function buildSearchBody(query: string): Record<string, unknown> {
  return { filtros: [], query, internacional: false };
}

export function buildJobUrl(id: number | string): string {
  return `${BASE_URL}/empleos/${id}.html`;
}

export function mapJobPosting(raw: LaborumJobPosting): NormalizedJob | null {
  if (raw == null || typeof raw.id !== 'number' || !Number.isFinite(raw.id)) return null;
  const title = raw.titulo?.trim();
  if (!title) return null;
  return {
    externalId: String(raw.id),
    title,
    company: raw.empresa?.trim() || undefined,
    location: raw.localizacion?.trim() || undefined,
    url: buildJobUrl(raw.id),
    description: raw.detalle?.trim() || undefined,
    publishedAt: raw.fechaPublicacion || undefined,
    modality: raw.modalidadTrabajo || undefined,
    employmentType: raw.tipoTrabajo || undefined,
  };
}

export function parseSearchResponse(json: unknown): { total: number; jobs: NormalizedJob[] } {
  if (json == null || typeof json !== 'object') return { total: 0, jobs: [] };
  const data = json as LaborumSearchResponse;
  const total = typeof data.total === 'number' && data.total >= 0 ? data.total : 0;
  const content = Array.isArray(data.content) ? data.content : [];
  const jobs: NormalizedJob[] = [];
  for (const raw of content) {
    try {
      const job = mapJobPosting(raw);
      if (job) jobs.push(job);
    } catch {
      // Skip malformed posting, keep parsing the rest.
    }
  }
  return { total, jobs };
}

async function fetchSearchPage(
  client: APIRequestContext,
  query: string,
  page: number,
): Promise<{ total: number; jobs: NormalizedJob[] }> {
  const response = await client.post(
    `${SEARCH_PATH}?pageSize=${PAGE_SIZE}&page=${page}&sort=RELEVANTES`,
    { data: buildSearchBody(query), timeout: REQUEST_TIMEOUT_MS },
  );
  if (!response.ok()) {
    throw new Error(`Laborum search failed: HTTP ${response.status()} (query="${query}", page=${page})`);
  }
  const json: unknown = await response.json();
  return parseSearchResponse(json);
}

export const laborumSkill: PlatformSkill = {
  slug: 'laborum',
  version: '0.1.0',
  displayName: 'Laborum.cl',
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
      message: `Iniciando escaneo de Laborum.cl (${queries.join(', ')})`,
      payload: { profileId: profile.id ?? null, queries },
    });

    const seen = new Set<string>();
    let jobsFound = 0;
    let errors = 0;

    const client = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        ...DEFAULT_HEADERS,
        Referer: `${BASE_URL}/empleos-busqueda-empleos.html`,
      },
    });

    try {
      for (const query of queries) {
        for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
          let result: { total: number; jobs: NormalizedJob[] };
          try {
            result = await fetchSearchPage(client, query, page);
          } catch (err) {
            errors++;
            await ctx.events.emit({
              kind: 'scan_error',
              message: `Error consultando Laborum.cl: ${err instanceof Error ? err.message : String(err)}`,
              payload: { query, page },
            });
            break;
          }

          if (result.jobs.length === 0) break;

          for (const job of result.jobs) {
            if (seen.has(job.externalId)) continue;
            seen.add(job.externalId);
            jobsFound++;
            await ctx.events.emit({
              kind: 'job_found',
              message: `Encontrada: ${job.title}${job.company ? ` en ${job.company}` : ''}`,
              payload: job,
            });
          }

          const fetched = (page + 1) * PAGE_SIZE;
          if (result.jobs.length < PAGE_SIZE || fetched >= result.total) break;
        }
      }
    } finally {
      await client.dispose();
    }

    await ctx.events.emit({
      kind: 'scan_completed',
      message: `Escaneo de Laborum.cl completado: ${jobsFound} ofertas encontradas`,
      payload: { jobsFound, errors },
    });

    return { jobsFound, jobsNew: jobsFound, jobsDuplicate: 0, errors };
  },

  async selfCheck(): Promise<SkillHealth> {
    const detectedAt = new Date().toISOString();
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      await browser.close();
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
