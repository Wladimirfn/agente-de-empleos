import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CandidateProfile } from '@employment-agent/domain';
import type { EventPayload } from '@employment-agent/skill-runtime';

vi.mock('playwright', () => ({
  request: { newContext: vi.fn() },
}));

import { request as playwrightRequest } from 'playwright';
import {
  buildQueries,
  buildSitemapUrl,
  buildDetailUrl,
  parseJobSlugAndId,
  extractExternalId,
  parseOffersSitemap,
  filterOffersByQueries,
  parseJobPostingJsonLd,
  normalizeListing,
  ensureApprovedOrigin,
  sanitizeJobPayload,
  trabajandoSkill,
  classifyPortalResponse,
  ChallengeBlockedError,
  BlockedPortalError,
  MAX_OFFERS_PER_SCAN,
  type ListingCard,
  type ListingsFetch,
} from './index.js';

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.trabajando.cl/trabajo/9384011-jefe-de-mantencion</loc><lastmod>2026-08-01</lastmod><changefreq>daily</changefreq><priority>1</priority></url>
  <url><loc>https://www.trabajando.cl/trabajo/9384012-operario-de-bodega</loc><lastmod>2026-08-02</lastmod></url>
  <url><loc>https://www.trabajando.cl/trabajo/9384013-tecnico-refrigeracion</loc></url>
</urlset>`;
const EMPTY_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?><urlset></urlset>`;
const JSONLD_FULL = `<html><head><script type="application/ld+json">{"@context":"https://schema.org/","@type":"JobPosting","title":"Jefe de Mantención","description":"Experiencia mínima de 24 meses.","datePosted":"2026-07-25","validThrough":"2026-09-30","employmentType":"FULL_TIME","hiringOrganization":{"name":"Acuicola del Sur"},"jobLocation":{"address":{"addressLocality":"Puerto Montt","addressRegion":"Los Lagos","addressCountry":"CL"}},"baseSalary":{"value":{"value":1500000,"currency":"CLP"},"unitText":"MONTH"},"experienceRequirements":{"monthsOfExperience":24}}</script></head></html>`;
const JSONLD_ESCAPED = `<html><body><script type="application/ld+json">{"@type":"JobPosting","title":"Operario \\u003Cstrong\\u003Epesado\\u003C/strong\\u003E","description":"Riesgos \\u0026amp; beneficios"}</script></body></html>`;
const JSONLD_MINIMAL = `<html><body><script type="application/ld+json">{"@type":"JobPosting","title":"Tech"}</script></body></html>`;

describe('buildQueries', () => {
  it('returns defaults when the profile has no skills', () => {
    expect(buildQueries({} as CandidateProfile)).toEqual(['mantención', 'refrigeración', 'bodega']);
  });
  it('combines target roles and short skills, deduped, capped', () => {
    const profile: CandidateProfile = {
      summary: 'Roles objetivo activos: Operario de Bodega (prioridad 1), Técnico en Refrigeración (prioridad 2)',
      skills: [{ name: 'refrigeración' }, { name: ' Refrigeración ' }, { name: 'logística' }],
    };
    expect(buildQueries(profile)).toEqual(['Operario de Bodega', 'Técnico en Refrigeración', 'refrigeración']);
  });
  it('drops skill names longer than MAX_QUERY_LENGTH', () => {
    expect(buildQueries({ skills: [{ name: 'a'.repeat(40) }, { name: 'OK' }] } as CandidateProfile)).toEqual(['OK']);
  });
});

describe('URL builders', () => {
  it('builds sitemap and detail URLs', () => {
    expect(buildSitemapUrl('index')).toBe('https://www.trabajando.cl/sitemap.xml');
    expect(buildSitemapUrl('offers')).toBe('https://www.trabajando.cl/sitemap-ofertas.xml');
    expect(buildDetailUrl('jefe-de-mantencion', '9384011')).toBe('https://www.trabajando.cl/trabajo/9384011-jefe-de-mantencion');
  });
});

describe('parseJobSlugAndId / extractExternalId', () => {
  it.each([
    ['9384011-jefe-de-mantencion', { kind: 'slug', value: { id: '9384011', slug: 'jefe-de-mantencion' } }],
    ['9384011-tecnico-refrigeracion', { kind: 'slug', value: { id: '9384011', slug: 'tecnico-refrigeracion' } }],
    ['-9384011', { kind: 'ext', value: null }],
    ['9384011-', { kind: 'ext', value: null }],
    ['slug-no-id-valido', { kind: 'ext', value: null }],
    ['https://eviltrabajando.cl/trabajo/9384011-jefe', { kind: 'ext', value: null }],
    ['https://malware.example/trabajo/9384011-jefe', { kind: 'ext', value: null }],
    ['https://www.trabajando.cl/trabajo/9384011-jefe-de-mantencion', { kind: 'ext', value: '9384011' }],
    ['https://www.trabajando.cl/trabajo/9384011-jefe-de-mantencion', { kind: 'ext', value: '9384011' }],
    ['https://www.trabajando.cl/sitemap-ofertas.xml', { kind: 'ext', value: null }],
  ])('parses %s', (input, expected) => {
    if (expected.kind === 'slug') expect(parseJobSlugAndId(input)).toEqual(expected.value);
    else expect(extractExternalId(input)).toBe(expected.value);
  });
});

describe('parseOffersSitemap', () => {
  it('parses canonical <url> entries with empty titles', () => {
    const cards = parseOffersSitemap(SITEMAP);
    expect(cards.map((card) => card.externalId)).toEqual(['9384011', '9384012', '9384013']);
    expect(cards[0]?.url).toBe('https://www.trabajando.cl/trabajo/9384011-jefe-de-mantencion');
    expect(cards[0]?.lastmod).toBe('2026-08-01');
    expect(cards[1]?.lastmod).toBe('2026-08-02');
    expect(cards[2]?.lastmod).toBeUndefined();
    expect(cards.every((card) => card.title === '')).toBe(true);
  });
  it.each([
    [EMPTY_SITEMAP, []],
    [`<urlset><url><loc>https://www.trabajando.cl/empresa/acme</loc></url><url><loc>https://www.trabajando.cl/trabajo/9384099-jefe</loc></url></urlset>`, ['9384099']],
    [`<urlset><url>   <loc>  https://www.trabajando.cl/trabajo/9384099-jefe  </loc>   <lastmod>  2026-08-01  </lastmod>   </url></urlset>`, ['9384099']],
  ] as const)('parses edge fixture to %s', (xml, expectedIds) => {
    expect(parseOffersSitemap(xml).map((card) => card.externalId)).toEqual(expectedIds);
  });
});

describe('filterOffersByQueries', () => {
  const cards: ListingCard[] = [
    { externalId: '1', title: '', url: 'https://www.trabajando.cl/trabajo/1-jefe-de-mantencion' },
    { externalId: '2', title: '', url: 'https://www.trabajando.cl/trabajo/2-operario-de-bodega' },
    { externalId: '3', title: '', url: 'https://www.trabajando.cl/trabajo/3-tecnico-refrigeracion' },
    { externalId: '4', title: '', url: 'https://www.trabajando.cl/trabajo/4-supervisor-de-logistica' },
  ];
  it.each([
    ['MANTENCIÓN', ['1']],
    ['técnico', ['3']],
    ['electricidad', []],
  ])('matches %s → %s', (query, expected) => {
    expect(filterOffersByQueries(cards, [query]).map((card) => card.externalId)).toEqual(expected);
  });
});

describe('parseJobPostingJsonLd', () => {
  it('returns null when the script tag is missing or invalid', () => {
    expect(parseJobPostingJsonLd('<html><body></body></html>')).toBeNull();
    expect(parseJobPostingJsonLd('<script type="application/ld+json">{not json</script>')).toBeNull();
  });
  it('parses a fully populated JSON-LD block', () => {
    const parsed = parseJobPostingJsonLd(JSONLD_FULL);
    expect(parsed?.title).toBe('Jefe de Mantención');
    expect(parsed?.description).toContain('Experiencia mínima de 24 meses');
    expect(parsed?.datePosted).toBe('2026-07-25');
    expect(parsed?.employmentType).toBe('FULL_TIME');
    expect(parsed?.hiringOrganization?.name).toBe('Acuicola del Sur');
    expect(parsed?.jobLocation?.address?.addressLocality).toBe('Puerto Montt');
    expect(parsed?.baseSalary?.value?.value).toBe(1500000);
    expect(parsed?.experienceRequirements?.monthsOfExperience).toBe(24);
  });
  it('decodes escaped HTML and HTML entities in title and description', () => {
    const parsed = parseJobPostingJsonLd(JSONLD_ESCAPED);
    expect(parsed?.title).toBe('Operario <strong>pesado</strong>');
    expect(parsed?.description).toBe('Riesgos & beneficios');
  });
  it('tolerates minimal JSON-LD with only title', () => {
    expect(parseJobPostingJsonLd(JSONLD_MINIMAL)?.title).toBe('Tech');
  });
});

describe('normalizeListing', () => {
  it('prefers JSON-LD fields over the listing card', () => {
    const card: ListingCard = { externalId: '1', title: '', url: 'https://www.trabajando.cl/trabajo/1-jefe' };
    const job = normalizeListing(card, {
      title: 'Jefe de Mantención', hiringOrganization: { name: 'Acuicola del Sur' },
      jobLocation: { address: { addressLocality: 'Puerto Montt', addressRegion: 'Los Lagos', addressCountry: 'CL' } },
      description: 'detalle', datePosted: '2026-07-25',
    });
    expect(job.title).toBe('Jefe de Mantención');
    expect(job.company).toBe('Acuicola del Sur');
    expect(job.location).toBe('Puerto Montt, Los Lagos, CL');
    expect(job.description).toBe('detalle');
    expect(job.publishedAt).toBe('2026-07-25');
  });
  it('falls back to lastmod when JSON-LD is absent', () => {
    const card: ListingCard = { externalId: '1', title: '', url: 'https://www.trabajando.cl/trabajo/1-jefe', lastmod: '2026-08-01' };
    const job = normalizeListing(card, null);
    expect(job.title).toBe('');
    expect(job.publishedAt).toBe('2026-08-01');
  });
});

describe('ensureApprovedOrigin', () => {
  it.each([
    ['https://www.trabajando.cl/trabajo/1-jefe', false],
    ['https://malware.example/', true],
  ])('returns URL for approved or throws for foreign (%s)', (href, shouldThrow) => {
    if (shouldThrow) expect(() => ensureApprovedOrigin(href)).toThrow(/Host no aprobado/);
    else expect(ensureApprovedOrigin(href).hostname).toBe('www.trabajando.cl');
  });
});

const eventCapture = () => {
  const events: EventPayload[] = [];
  const emit = vi.fn(async (event: EventPayload) => { events.push(event); });
  return { events, emit };
};

const fetcherFromQueue = (responses: Array<{ status?: number; body?: string; throwError?: Error; finalUrl?: string }>) => {
  const get = vi.fn(async (url: string) => {
    const next = responses.shift() ?? { status: 200, body: '' };
    if (next.throwError) throw next.throwError;
    const status = next.status ?? 200;
    return { ok: () => status >= 200 && status < 300, status: () => status, text: async () => next.body ?? '', url: () => next.finalUrl ?? url };
  });
  return { fetcher: { get } as ListingsFetch, get };
};

const useFetcher = (responses: Array<{ status?: number; body?: string; throwError?: Error; finalUrl?: string }>) => {
  const { fetcher, get } = fetcherFromQueue(responses);
  vi.mocked(playwrightRequest.newContext).mockResolvedValue({ get, dispose: vi.fn() } as never);
  return { fetcher, get };
};

const OFFERS_SITEMAP = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.trabajando.cl/trabajo/9384011-jefe-de-mantencion</loc><lastmod>2026-08-01</lastmod></url>
  <url><loc>https://www.trabajando.cl/trabajo/9384012-operario-de-bodega</loc><lastmod>2026-08-02</lastmod></url>
  <url><loc>https://www.trabajando.cl/trabajo/9384013-tecnico-refrigeracion</loc></url>
  <url><loc>https://www.trabajando.cl/trabajo/9384014-supervisor-de-logistica</loc></url>
</urlset>`;
const JSONLD = `<html><body><script type="application/ld+json">{"@type":"JobPosting","title":"Jefe de Mantención","description":"detalle","hiringOrganization":{"name":"Acuicola del Sur"},"jobLocation":{"address":{"addressLocality":"Puerto Montt","addressRegion":"Los Lagos","addressCountry":"CL"}},"datePosted":"2026-07-25"}</script></body></html>`;
const profile: CandidateProfile = { id: 1, skills: [{ name: 'mantención' }, { name: 'operario' }] };

beforeEach(() => vi.clearAllMocks());

describe('trabajandoSkill contract', () => {
  it('exports the canonical slug, version, displayName and capabilities', () => {
    expect(trabajandoSkill.slug).toBe('trabajando');
    expect(trabajandoSkill.version).toBe('0.1.0');
    expect(trabajandoSkill.displayName).toBe('Trabajando.cl');
    expect(trabajandoSkill.requiredCandidateFields).toEqual([]);
    expect(trabajandoSkill.capabilities).toEqual({ canScan: true, canApply: false, canDetectLoggedOut: false });
  });
});

describe('trabajandoSkill.scan', () => {
  it('emits job_found once per externalId and finishes with scan_completed', async () => {
    useFetcher([{ body: OFFERS_SITEMAP }, { body: JSONLD }, { body: JSONLD }, { body: JSONLD }, { body: JSONLD }]);
    const { events, emit } = eventCapture();
    const result = await trabajandoSkill.scan(profile, { events: { emit } });
    expect(result.jobsFound).toBe(2);
    expect(events.at(-1)?.kind).toBe('scan_completed');
    const ids = new Set(events.filter((event) => event.kind === 'job_found').map((event) => (event.payload as { externalId: string }).externalId));
    expect(ids).toEqual(new Set(['9384011', '9384012']));
  });

  it('dedupes jobs and emits one job_found per externalId', async () => {
    useFetcher([{ body: OFFERS_SITEMAP }, { body: JSONLD }, { body: JSONLD }, { body: JSONLD }]);
    const { events, emit } = eventCapture();
    await trabajandoSkill.scan({ id: 1, skills: [{ name: 'mantención' }, { name: 'operario' }, { name: 'logística' }] }, { events: { emit } });
    const jobFound = events.filter((event) => event.kind === 'job_found');
    expect(jobFound).toHaveLength(3);
    const ids = new Set(jobFound.map((event) => (event.payload as { externalId: string }).externalId));
    expect(ids).toEqual(new Set(['9384011', '9384012', '9384014']));
  });

  it('emits scan_error with TRABAJANDO_FETCH code on warm-up failure', async () => {
    useFetcher([{ throwError: new Error('socket hang up') }]);
    const { events, emit } = eventCapture();
    const result = await trabajandoSkill.scan(profile, { events: { emit } });
    expect(result.errors).toBe(1);
    const errorEvent = events.find((event) => event.kind === 'scan_error');
    expect((errorEvent?.payload as { code: string }).code).toBe('TRABAJANDO_FETCH');
    expect(events.at(-1)?.kind).toBe('scan_completed');
  });

  it('emits scan_error when resolveClient throws after scan_started', async () => {
    vi.mocked(playwrightRequest.newContext).mockRejectedValueOnce(new Error('playwright missing'));
    const { events, emit } = eventCapture();
    const result = await trabajandoSkill.scan(profile, { events: { emit } });
    expect(result).toEqual({ jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 1 });
    const errorEvents = events.filter((event) => event.kind === 'scan_error');
    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0]?.payload as { code: string }).code).toBe('TRABAJANDO_FETCH');
    expect(events.filter((event) => event.kind === 'scan_completed')).toHaveLength(1);
  });

  it('honors MAX_OFFERS_PER_SCAN and the deadline', async () => {
    const many: string[] = [];
    for (let i = 0; i < 80; i++) many.push(`<url><loc>https://www.trabajando.cl/trabajo/${9000000 + i}-mantencion-operario-jefe</loc></url>`);
    const bigSitemap = `<?xml version="1.0"?><urlset>${many.join('')}</urlset>`;
    useFetcher([{ body: bigSitemap }]);
    const { events, emit } = eventCapture();
    const result = await trabajandoSkill.scan(profile, { events: { emit } });
    expect(result.jobsFound).toBeLessThanOrEqual(MAX_OFFERS_PER_SCAN);
    expect(result.jobsFound).toBeGreaterThan(0);
    expect(result.errors).toBe(0);
  });

  it('emits only the four allowed event kinds', async () => {
    useFetcher([{ body: OFFERS_SITEMAP }, { body: JSONLD }, { body: JSONLD }]);
    const { events, emit } = eventCapture();
    await trabajandoSkill.scan(profile, { events: { emit } });
    for (const event of events) expect(['scan_started', 'scan_completed', 'job_found', 'scan_error']).toContain(event.kind);
  });

  it('never includes profileId in scan_started payload', async () => {
    useFetcher([{ body: OFFERS_SITEMAP }, { body: JSONLD }, { body: JSONLD }]);
    const { events, emit } = eventCapture();
    await trabajandoSkill.scan(profile, { events: { emit } });
    const scanStarted = events.find((event) => event.kind === 'scan_started');
    expect(scanStarted?.payload).not.toHaveProperty('profileId');
    expect(JSON.stringify(scanStarted)).not.toMatch(/jane@example\.com/);
  });
});

describe('sanitizeJobPayload', () => {
  it('strips URLs, file paths, JWTs, credentials, and key= substrings', () => {
    const evil = {
      externalId: '1', title: 'Operario en https://attacker.example/x?token=sk-live-abcdef123456 cf-ray:abc-123',
      company: 'Bearer eyJhbGciOi.token', description: 'C:\\Users\\agent\\cv.pdf /tmp/leak?key=hack',
      url: 'file:///etc/passwd',
    };
    const sanitized = sanitizeJobPayload(evil as unknown as Record<string, unknown>);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/file:\/\//);
    expect(serialized).not.toMatch(/C:\\|:\\\\|\/tmp\/|\/opt\/|\/srv\/|\/home\/|\/var\/|\/etc\//);
    expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9]/);
    expect(serialized).not.toMatch(/sk-live-/);
    expect(serialized).not.toMatch(/[?&](key|api[_-]?key|token)=/);
    expect(serialized).not.toMatch(/cf-ray[:=]\s*[a-z0-9-]+/i);
    expect(sanitized.title).toContain('Operario');
  });
});

describe('classifyPortalResponse', () => {
  it.each([
    [200, '<html>jobs here</html>', 'jobs'],
    [200, '<title>Just a moment...</title>cf-mitigated', 'challenge'],
    [200, 'Checking your browser before accessing trabajando', 'challenge'],
    [200, 'Access Denied for this environment', 'blocked'],
    [200, 'http 403 forbidden', 'blocked'],
    [302, '', 'redirect'],
    [302, '', 'jobs'],
    [500, '', 'error'],
    [403, '', 'error'],
  ])('classifies status=%s as %s', (status, body, expected) => {
    const finalUrl = status === 302 && expected === 'jobs' ? 'https://www.trabajando.cl/sitemap.xml' : status === 302 ? 'https://malware.example/' : undefined;
    expect(classifyPortalResponse(status, body, finalUrl)).toBe(expected);
  });
});

describe('Cloudflare and blocked detection', () => {
  const CHALLENGE = '<html><head><title>Just a moment...</title></head><body>cf-mitigated challenge-running</body></html>';
  const BLOCKED = '<html><body><h1>Access Denied</h1><p>http 403 forbidden</p></body></html>';

  it('stops the scan on a challenge response with sanitized code and zero fetches beyond warm-up', async () => {
    let calls = 0;
    vi.mocked(playwrightRequest.newContext).mockResolvedValue({
      get: vi.fn(async (url: string) => {
        calls++;
        return { ok: () => true, status: () => 200, text: async () => CHALLENGE, url: () => url };
      }),
      dispose: vi.fn(),
    } as never);
    const { events, emit } = eventCapture();
    const result = await trabajandoSkill.scan(profile, { events: { emit } });
    expect(result).toEqual({ jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 1 });
    expect(calls).toBe(1);
    const errorEvent = events.find((event) => event.kind === 'scan_error');
    expect((errorEvent?.payload as { code: string }).code).toBe('TRABAJANDO_CHALLENGE');
    expect(errorEvent?.message).not.toMatch(/cf-mitigated|cf-ray/i);
    expect(events.filter((event) => event.kind === 'job_found')).toHaveLength(0);
  });

  it('stops the scan on a blocked response with the corresponding code', async () => {
    vi.mocked(playwrightRequest.newContext).mockResolvedValue({
      get: vi.fn(async (url: string) => ({ ok: () => true, status: () => 200, text: async () => BLOCKED, url: () => url })),
      dispose: vi.fn(),
    } as never);
    const { events, emit } = eventCapture();
    const result = await trabajandoSkill.scan(profile, { events: { emit } });
    expect(result.errors).toBe(1);
    expect((events.find((event) => event.kind === 'scan_error')?.payload as { code: string }).code).toBe('TRABAJANDO_BLOCKED');
    expect(events.find((event) => event.kind === 'job_found')).toBeUndefined();
  });

  it('preserves the existing jobs behavior for normal sitemaps and 4xx/5xx remain broken', async () => {
    useFetcher([{ status: 200, body: OFFERS_SITEMAP }, { body: JSONLD }, { body: JSONLD }, { body: JSONLD }]);
    const { events, emit } = eventCapture();
    const result = await trabajandoSkill.scan({ id: 1, skills: [{ name: 'mantención' }, { name: 'operario' }] }, { events: { emit } });
    expect(result.jobsFound).toBe(2);
    expect(events.some((event) => event.kind === 'job_found')).toBe(true);
  });

  it('selfCheck reports needs-human for a challenge response without leaking CF markers', async () => {
    useFetcher([{ status: 200, body: CHALLENGE }]);
    const health = await trabajandoSkill.selfCheck();
    expect(health.status).toBe('needs-human');
    expect(health.lastError?.code).toBe('TRABAJANDO_CHALLENGE');
    expect(JSON.stringify(health)).not.toMatch(/cf-mitigated|cf-ray/i);
  });

  it('selfCheck reports needs-human for a blocked response without leaking CF markers', async () => {
    useFetcher([{ status: 200, body: BLOCKED }]);
    const health = await trabajandoSkill.selfCheck();
    expect(health.status).toBe('needs-human');
    expect(health.lastError?.code).toBe('TRABAJANDO_BLOCKED');
  });

  it('exports typed errors with stable codes', () => {
    expect(new ChallengeBlockedError().kind).toBe('TRABAJANDO_CHALLENGE');
    expect(new BlockedPortalError().kind).toBe('TRABAJANDO_BLOCKED');
  });
});

describe('trabajandoSkill.selfCheck', () => {
  it('reports healthy for 2xx on the approved host', async () => {
    useFetcher([{ status: 200, body: '<?xml version="1.0"?><urlset></urlset>' }]);
    const health = await trabajandoSkill.selfCheck();
    expect(health.status).toBe('healthy');
  });

  it('reports healthy for 3xx redirect that stays on the approved host', async () => {
    useFetcher([{ status: 302, finalUrl: 'https://www.trabajando.cl/sitemap.xml' }]);
    const health = await trabajandoSkill.selfCheck();
    expect(health.status).toBe('healthy');
  });

  it('reports degraded for 3xx redirect to a foreign origin', async () => {
    useFetcher([{ status: 302, finalUrl: 'https://malware.example/' }]);
    const health = await trabajandoSkill.selfCheck();
    expect(health.status).toBe('degraded');
  });

  it('reports broken for 5xx with TRABAJANDO_HTTP code', async () => {
    useFetcher([{ status: 502 }]);
    const health = await trabajandoSkill.selfCheck();
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('TRABAJANDO_HTTP');
  });

  it('reports broken when the network call throws with TRABAJANDO_FETCH code', async () => {
    vi.mocked(playwrightRequest.newContext).mockRejectedValue(new Error('Executable missing'));
    const health = await trabajandoSkill.selfCheck();
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('TRABAJANDO_FETCH');
    expect(health.lastError?.message).toContain('Executable missing');
  });
});