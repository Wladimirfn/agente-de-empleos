import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CandidateProfile } from '@employment-agent/domain';
import type { EventPayload } from '@employment-agent/skill-runtime';

vi.mock('playwright', () => ({
  request: { newContext: vi.fn() },
}));

import { request as playwrightRequest } from 'playwright';
import {
  buildQueries,
  buildListingsUrl,
  buildDetailUrl,
  parseJobSlugAndId,
  extractExternalId,
  parseListingsHtml,
  parseListingMeta,
  parseDetailDescription,
  normalizeListing,
  ensureApprovedOrigin,
  empleosaquaSkill,
  type ListingsFetch,
} from './index.js';

const LISTING = `<div class="listings">
<h5><a href="/offer/show/jefe-de-mantencion-piscicultura-9384011">Jefe de Mantención Piscicultura</a></h5>
<p class="meta">Acuícola del Sur - hace 2 días, Puerto Montt</p>
<p class="meta">Presencial</p>
<h5><a href="/offer/show/operario-salmonero-9384012">Operario Salmonero</a></h5>
<p class="meta">SalmonChile SpA - hace 1 día, Chiloé</p>
<p class="meta">Teletrabajo</p>
<h5><a href="/offer/show/tecnico-de-centro-de-cultivo-9384013">Técnico de Centro de Cultivo</a></h5>
<p class="meta">MultiExport - hace 5 horas, Chonchi</p>
<p class="meta">Presencial</p>
</div>`;

const EMPTY = `<div class="listings"></div>`;
const DETAIL = `<html><head><meta name="description" content="Acuícola del Sur busca Jefe de Mantención con al menos cinco años de experiencia en piscicultura."></head><body><h1>Jefe de Mantención Piscicultura</h1><p>Modalidad: Presencial. Jornada: Full-time.</p></body></html>`;
const MALFORMED = `<div class="listings">
<h5><a href="https://malware.example/oferta">Enlace externo</a></h5>
<h5><a href="/offer/show/sin-id">Sin identificador</a></h5>
<h5><a href="/offer/show/tecnico-con-dobles-guiones-9384050">  </a></h5>
<h5><a href="/offer/show/operario-limpeza-9384051">Operario de Limpeza Industrial</a></h5>
</div>`;

describe('buildQueries', () => {
  it('uses defaults and caps at MAX_QUERIES when the profile has no skills', () => {
    expect(buildQueries({} as CandidateProfile)).toEqual(['acuicultura', 'salmonero', 'mantención']);
    expect(buildQueries({ skills: ['aa', 'bb', 'cc', 'dd', 'ee'].map((name) => ({ name })) } as CandidateProfile)).toHaveLength(3);
  });

  it('combines target roles and short skills, deduped', () => {
    const profile: CandidateProfile = {
      summary: 'Roles objetivo activos: Operario Salmonero (prioridad 1), Técnico Acuícola (prioridad 2)',
      skills: [{ name: 'Piscicultura' }, { name: ' piscicultura ' }, { name: 'Operario' }],
    };
    expect(buildQueries(profile)).toEqual([
      'Operario Salmonero', 'Técnico Acuícola', 'Piscicultura',
    ].slice(0, 3));
  });

  it('drops skill names longer than MAX_QUERY_LENGTH', () => {
    const long = 'a'.repeat(40);
    expect(buildQueries({ skills: [{ name: long }, { name: 'OK' }] } as CandidateProfile)).toEqual(['OK']);
  });
});

describe('URL builders', () => {
  it.each([
    [false, 1, 'https://www.empleosaqua.cl/offer/list'],
    [false, 2, 'https://www.empleosaqua.cl/offer/list?page=2'],
    [false, 3, 'https://www.empleosaqua.cl/offer/list?page=3'],
    [true, 1, 'https://www.empleosaqua.cl/offer/featured'],
    [true, 2, 'https://www.empleosaqua.cl/offer/featured?page=2'],
  ])('builds %s page %i URL', (featured, page, expected) => {
    expect(buildListingsUrl(featured, page)).toBe(expected);
  });

  it('builds the canonical detail URL from slug and id', () => {
    expect(buildDetailUrl('jefe-de-mantencion-piscicultura', '9384011')).toBe('https://www.empleosaqua.cl/offer/show/jefe-de-mantencion-piscicultura-9384011');
  });
});

describe('parseJobSlugAndId', () => {
  it.each([
    ['jefe-de-mantencion-piscicultura-9384011', { slug: 'jefe-de-mantencion-piscicultura', id: '9384011' }],
    ['-9384011', null],
    ['slug-no-id-valido', null],
    ['operario-limpeza-9384051', { slug: 'operario-limpeza', id: '9384051' }],
  ])('parses %s', (input, expected) => {
    expect(parseJobSlugAndId(input)).toEqual(expected);
  });
});

describe('extractExternalId', () => {
  it.each([
    ['https://malware.example/offer/show/x-1', null],
    ['https://www.empleosaqua.cl/offer/show/jefe-de-mantencion-piscicultura-9384011', '9384011'],
    ['https://www.empleosaqua.cl/offer/list', null],
    ['https://www.empleosaqua.cl/offer/featured?page=2', null],
  ])('returns %s for %s', (href, expected) => {
    expect(extractExternalId(href)).toBe(expected);
  });
});

describe('parseListingsHtml', () => {
  it('parses canonical h5 anchor cards into listings', () => {
    const cards = parseListingsHtml(LISTING);
    expect(cards.map((card) => card.externalId)).toEqual(['9384011', '9384012', '9384013']);
    expect(cards[0]?.url).toBe('https://www.empleosaqua.cl/offer/show/jefe-de-mantencion-piscicultura-9384011');
    expect(cards[0]?.title).toBe('Jefe de Mantención Piscicultura');
  });

  it('returns no cards for an empty listings section', () => {
    expect(parseListingsHtml(EMPTY)).toEqual([]);
  });

  it('skips malformed anchors and external hosts but keeps valid cards', () => {
    const cards = parseListingsHtml(MALFORMED);
    expect(cards.map((card) => card.externalId)).toEqual(['9384051']);
  });

  it('deduplicates repeated anchors on the same page', () => {
    const html = `<div><h5><a href="/offer/show/jefe-de-mantencion-piscicultura-9384011">Repetido 1</a></h5><h5><a href="/offer/show/jefe-de-mantencion-piscicultura-9384011">Repetido 2</a></h5></div>`;
    expect(parseListingsHtml(html)).toHaveLength(1);
  });
});

describe('parseListingMeta', () => {
  it('returns null when no matching anchor exists', () => {
    expect(parseListingMeta(LISTING, '9999')).toBeNull();
  });

  it('prefers the anchor title over fallback when meta is null', () => {
    const card = { externalId: '1', title: 'Anchor Title', url: 'https://www.empleosaqua.cl/offer/show/anchor-title-1' };
    const job = normalizeListing(card, null);
    expect(job.title).toBe('Anchor Title');
    expect(job.company).toBeUndefined();
  });
});

describe('parseDetailDescription', () => {
  it('extracts the meta description plus modality and employment type', () => {
    const detail = parseDetailDescription(DETAIL);
    expect(detail.description).toContain('piscicultura');
    expect(detail.modality).toBe('Presencial');
    expect(detail.employmentType).toBe('Full-time');
  });

  it('returns empty detail for an empty page', () => {
    expect(parseDetailDescription('')).toEqual({});
  });

  it('truncates a long meta description', () => {
    const long = 'a'.repeat(2000);
    const html = `<head><meta name="description" content="${long}"></head><body></body>`;
    const detail = parseDetailDescription(html);
    expect(detail.description?.length).toBeLessThanOrEqual(1200);
  });
});

describe('normalizeListing', () => {
  it('prefers meta title when provided', () => {
    const card = { externalId: '1', title: 'Anchor Title', url: 'https://www.empleosaqua.cl/offer/show/anchor-title-1' };
    expect(normalizeListing(card, null).title).toBe('Anchor Title');
    expect(normalizeListing(card, { title: 'Meta Title' }).title).toBe('Meta Title');
  });
});

describe('ensureApprovedOrigin', () => {
  it('accepts the canonical host', () => {
    expect(ensureApprovedOrigin('https://www.empleosaqua.cl/offer/list').hostname).toBe('www.empleosaqua.cl');
  });

  it('rejects external hosts', () => {
    expect(() => ensureApprovedOrigin('https://malware.example/')).toThrow(/Host no aprobado/);
  });
});

const eventCapture = () => {
  const events: EventPayload[] = [];
  const emit = vi.fn(async (event: EventPayload) => { events.push(event); });
  return { events, emit };
};

const fetcherFromQueue = (responses: Array<{ status?: number; body?: string; throwError?: Error; finalUrl?: string }>) => {
  const get = vi.fn(async (url: string) => {
    const next = responses.shift() ?? { status: 200, body: EMPTY };
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

const profile: CandidateProfile = { id: 1, skills: [{ name: 'acuicultura' }] };

beforeEach(() => vi.clearAllMocks());

describe('empleosaquaSkill contract', () => {
  it('exports the canonical slug, version, displayName and capabilities', () => {
    expect(empleosaquaSkill.slug).toBe('empleosaqua');
    expect(empleosaquaSkill.version).toBe('0.1.0');
    expect(empleosaquaSkill.displayName).toBe('Empleos Aqua');
    expect(empleosaquaSkill.requiredCandidateFields).toEqual([]);
    expect(empleosaquaSkill.capabilities).toEqual({ canScan: true, canApply: false, canDetectLoggedOut: false });
  });
});

describe('empleosaquaSkill.scan', () => {
  it('emits job_found once per externalId, dedupes across pages, and finishes with scan_completed', async () => {
    const PAGE2 = `<div><h5><a href="/offer/show/jefe-de-mantencion-piscicultura-9384011">Repetido</a></h5><h5><a href="/offer/show/supervisor-de-centro-9384033">Supervisor de Centro</a></h5></div>`;
    const DETAIL = `<html><body><h1>Job</h1></body></html>`;
    useFetcher([
      { body: LISTING }, // warm-up
      { body: LISTING }, // page 1
      { body: DETAIL }, { body: DETAIL }, { body: DETAIL },
      { body: PAGE2 }, // page 2 (1 duplicate + 1 new)
      { body: DETAIL },
    ]);
    const { events, emit } = eventCapture();
    const result = await empleosaquaSkill.scan(profile, { events: { emit } });
    expect(result).toMatchObject({ jobsFound: 4, jobsNew: 4, jobsDuplicate: 1, errors: 0 });
    expect(events.find((event) => event.kind === 'scan_started')).toBeDefined();
    expect(events.at(-1)?.kind).toBe('scan_completed');
    expect(new Set(events.filter((event) => event.kind === 'job_found').map((event) => (event.payload as { externalId: string }).externalId))).toEqual(new Set(['9384011', '9384012', '9384013', '9384033']));
  });

  it('stops paginating when a page returns zero cards', async () => {
    useFetcher([{ body: LISTING }, { body: LISTING }, { body: DETAIL }, { body: DETAIL }, { body: DETAIL }, { body: EMPTY }]);
    const { events, emit } = eventCapture();
    const result = await empleosaquaSkill.scan(profile, { events: { emit } });
    expect(result.jobsFound).toBe(3);
    expect(events.filter((event) => event.kind === 'job_found')).toHaveLength(3);
  });

  it('emits scan_error with warm-up failure but still completes the scan with errors=1', async () => {
    useFetcher([{ throwError: new Error('warm-up socket hang up') }, { body: EMPTY }]);
    const { events, emit } = eventCapture();
    const result = await empleosaquaSkill.scan(profile, { events: { emit } });
    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(events.some((event) => event.kind === 'scan_error' && (event.payload as { query: string }).query === '<home>')).toBe(true);
    expect(events.at(-1)?.kind).toBe('scan_completed');
  });

  it('emits scan_error for a per-page failure and continues to the next query', async () => {
    const profileWithQueries: CandidateProfile = { id: 1, skills: [{ name: 'salmonero' }, { name: 'mantención' }, { name: 'operario' }] };
    const DETAIL = `<html><body><h1>Job</h1></body></html>`;
    useFetcher([
      { body: LISTING }, // warm-up
      { throwError: new Error('socket hang up') }, // query 1 page 1 fails
      { body: LISTING }, // query 2 page 1 succeeds
      { body: DETAIL }, { body: DETAIL }, { body: DETAIL },
    ]);
    const { events, emit } = eventCapture();
    const result = await empleosaquaSkill.scan(profileWithQueries, { events: { emit } });
    expect(result.jobsFound).toBe(3);
    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(events.filter((event) => event.kind === 'scan_error')).toHaveLength(1);
  });

  it('emits only the four allowed event kinds', async () => {
    const DETAIL = `<html><body><h1>Job</h1></body></html>`;
    useFetcher([{ body: LISTING }, { body: LISTING }, { body: DETAIL }, { body: DETAIL }, { body: DETAIL }]);
    const { events, emit } = eventCapture();
    await empleosaquaSkill.scan(profile, { events: { emit } });
    for (const event of events) expect(['scan_started', 'scan_completed', 'job_found', 'scan_error']).toContain(event.kind);
  });
});

describe('empleosaquaSkill.selfCheck', () => {
  it('reports healthy for 2xx on the approved host', async () => {
    useFetcher([{ status: 200, body: LISTING }]);
    const health = await empleosaquaSkill.selfCheck();
    expect(health.status).toBe('healthy');
  });

  it('reports healthy for 3xx redirect that stays on the approved host', async () => {
    useFetcher([{ status: 302, finalUrl: 'https://www.empleosaqua.cl/offer/list' }]);
    const health = await empleosaquaSkill.selfCheck();
    expect(health.status).toBe('healthy');
  });

  it('reports degraded for 3xx redirect to a foreign origin', async () => {
    useFetcher([{ status: 302, finalUrl: 'https://malware.example/' }]);
    const health = await empleosaquaSkill.selfCheck();
    expect(health.status).toBe('degraded');
  });

  it('reports broken when a 2xx response lands on a foreign origin', async () => {
    useFetcher([{ status: 200, finalUrl: 'https://malware.example/' }]);
    const health = await empleosaquaSkill.selfCheck();
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('EMPLEOSAQUA_HTTP');
    expect(JSON.stringify(health)).not.toMatch(/https?:\/\/malware\.example/);
  });

  it('reports broken for 5xx with EMPLEOSAQUA_HTTP code', async () => {
    useFetcher([{ status: 502 }]);
    const health = await empleosaquaSkill.selfCheck();
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('EMPLEOSAQUA_HTTP');
  });

  it('reports broken when the network call throws with EMPLEOSAQUA_FETCH code', async () => {
    vi.mocked(playwrightRequest.newContext).mockRejectedValue(new Error('Executable missing'));
    const health = await empleosaquaSkill.selfCheck();
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('EMPLEOSAQUA_FETCH');
    expect(health.lastError?.message).toContain('Executable missing');
  });
});

describe('slice B bounded fix regressions', () => {
  it('scan_started payload never contains profileId or profile-derived identifiers', async () => {
    const profileWithPII: CandidateProfile = { id: 1, fullName: 'Jane Doe', email: 'jane@example.com', phone: '+56 9 1111 1111', skills: [{ name: 'acuicultura' }] } as unknown as CandidateProfile;
    useFetcher([{ body: LISTING }, { body: LISTING }, { body: DETAIL }, { body: DETAIL }, { body: DETAIL }]);
    const { events, emit } = eventCapture();
    await empleosaquaSkill.scan(profileWithPII, { events: { emit } });
    const scanStarted = events.find((event) => event.kind === 'scan_started');
    const serialized = JSON.stringify(scanStarted);
    expect(scanStarted?.payload).not.toHaveProperty('profileId');
    expect(serialized).not.toMatch(/jane@example\.com/);
    expect(serialized).not.toMatch(/Jane Doe/);
    expect(serialized).not.toMatch(/\+56 9 1111/);
  });

  it('job_found payloads never contain URLs, file paths, JWTs, credentials, or key= substrings', async () => {
    const evilTitle = 'Operario en https://attacker.example/x?token=sk-live-abcdef123456 (C:\\Users\\agent\\cv.pdf /tmp/leak)';
    const evilCard = `<h5><a href="/offer/show/operario-limpeza-9384051">${evilTitle}</a></h5>`;
    const evilDetail = `<html><body>https://attacker.example/x Bearer eyJhbGciOi.token /opt/leak?key=hack</body></html>`;
    const profileWithQueries: CandidateProfile = { id: 1, skills: [{ name: 'salmonero' }] };
    useFetcher([{ body: `<div>${evilCard}</div>` }, { body: `<div>${evilCard}</div>` }, { body: evilDetail }]);
    const { events, emit } = eventCapture();
    await empleosaquaSkill.scan(profileWithQueries, { events: { emit } });
    const jobFound = events.find((event) => event.kind === 'job_found');
    expect(jobFound).toBeDefined();
    const serialized = JSON.stringify(jobFound);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/file:\/\//);
    expect(serialized).not.toMatch(/C:\\|:\\\\|\/tmp\/|\/opt\/|\/srv\/|\/home\/|\/var\/|\/etc\//);
    expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9]/);
    expect(serialized).not.toMatch(/sk-live-/);
    expect(serialized).not.toMatch(/[?&](key|api[_-]?key|token)=/);
  });

  it('does not fetch when scheduled exactly at the deadline', async () => {
    const profileWithQueries: CandidateProfile = { id: 1, skills: [{ name: 'salmonero' }, { name: 'mantención' }, { name: 'operario' }] };
    let virtualNow = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => virtualNow);
    const get = vi.fn(async (url: string) => {
      virtualNow = 60_000;
      const body = `<div><h5><a href="/offer/show/operario-limpeza-9384051">Job</a></h5></div>`;
      return { ok: () => true, status: () => 200, text: async () => body, url: () => url };
    });
    vi.mocked(playwrightRequest.newContext).mockResolvedValue({ get, dispose: vi.fn() } as never);
    try {
      const result = await empleosaquaSkill.scan(profileWithQueries, { events: { emit: vi.fn() } });
      expect(result.jobsFound).toBe(0);
      expect(get).toHaveBeenCalledTimes(1); // only the warm-up
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('emits scan_error and scan_completed when resolveClient throws after scan_started', async () => {
    vi.mocked(playwrightRequest.newContext).mockRejectedValueOnce(new Error('playwright missing'));
    const { events, emit } = eventCapture();
    const result = await empleosaquaSkill.scan(profile, { events: { emit } });
    expect(result).toEqual({ jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 1 });
    const errorEvents = events.filter((event) => event.kind === 'scan_error');
    const completedEvents = events.filter((event) => event.kind === 'scan_completed');
    expect(errorEvents).toHaveLength(1);
    expect((errorEvents[0]?.payload as { code: string }).code).toBe('EMPLEOSAQUA_FETCH');
    expect(completedEvents).toHaveLength(1);
    expect((completedEvents[0]?.payload as { jobsFound: number }).jobsFound).toBe(0);
  });
});