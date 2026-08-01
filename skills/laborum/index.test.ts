import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CandidateProfile } from '@employment-agent/domain';
import type { EventPayload } from '@employment-agent/skill-runtime';

vi.mock('playwright', () => ({
  request: {
    newContext: vi.fn(),
  },
  chromium: {
    launch: vi.fn(),
  },
}));

import { request as playwrightRequest, chromium } from 'playwright';
import {
  laborumSkill,
  buildQueries,
  buildSearchBody,
  buildJobUrl,
  mapJobPosting,
  parseSearchResponse,
} from './index.js';

const SAMPLE_POSTING = {
  id: 1118383973,
  titulo: 'MAESTRO EN MANTENCIÓN',
  detalle: 'Requisitos: experiencia mínima 1 año.',
  empresa: 'Layner',
  localizacion: 'San Carlos, Región XVI',
  fechaPublicacion: '29-07-2026',
  modalidadTrabajo: 'Presencial',
  tipoTrabajo: 'Full-time',
};

function makeEmitter() {
  const events: EventPayload[] = [];
  return {
    events,
    emit: vi.fn(async (e: EventPayload) => {
      events.push(e);
    }),
  };
}

function makeApiClient(pages: Array<{ status?: number; body?: unknown; throwError?: Error }>) {
  const post = vi.fn(async () => {
    const next = pages.shift() ?? { status: 200, body: { total: 0, content: [] } };
    if (next.throwError) throw next.throwError;
    const status = next.status ?? 200;
    return {
      ok: () => status >= 200 && status < 300,
      status: () => status,
      json: async () => next.body,
    };
  });
  return { post, dispose: vi.fn(async () => undefined) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildQueries', () => {
  it('falls back to default queries when profile has no skills', () => {
    expect(buildQueries({} as CandidateProfile)).toEqual(['mantención', 'refrigeración', 'mantenimiento']);
  });

  it('uses profile skills when available and dedupes them', () => {
    const profile: CandidateProfile = {
      skills: [{ name: 'Refrigeración' }, { name: ' refrigeración ' }, { name: 'Electricidad' }],
    };
    expect(buildQueries(profile)).toEqual(['Refrigeración', 'refrigeración', 'Electricidad']);
  });

  it('caps the number of queries', () => {
    const profile: CandidateProfile = {
      skills: ['aa', 'bb', 'cc', 'dd', 'ee'].map((name) => ({ name })),
    };
    expect(buildQueries(profile)).toHaveLength(3);
  });
});

describe('buildSearchBody / buildJobUrl', () => {
  it('builds the API request body', () => {
    expect(buildSearchBody('mantención')).toEqual({
      filtros: [],
      query: 'mantención',
      internacional: false,
    });
  });

  it('builds the public job URL', () => {
    expect(buildJobUrl(1118383973)).toBe('https://www.laborum.cl/empleos/1118383973.html');
  });
});

describe('mapJobPosting', () => {
  it('maps a full posting', () => {
    const job = mapJobPosting(SAMPLE_POSTING);
    expect(job).toEqual({
      externalId: '1118383973',
      title: 'MAESTRO EN MANTENCIÓN',
      company: 'Layner',
      location: 'San Carlos, Región XVI',
      url: 'https://www.laborum.cl/empleos/1118383973.html',
      description: 'Requisitos: experiencia mínima 1 año.',
      publishedAt: '29-07-2026',
      modality: 'Presencial',
      employmentType: 'Full-time',
    });
  });

  it('returns null when id is missing or not a number', () => {
    expect(mapJobPosting({ ...SAMPLE_POSTING, id: undefined as unknown as number })).toBeNull();
    expect(mapJobPosting({ ...SAMPLE_POSTING, id: 'x' as unknown as number })).toBeNull();
  });

  it('returns null when title is missing or blank', () => {
    expect(mapJobPosting({ id: 1, titulo: '   ' })).toBeNull();
    expect(mapJobPosting({ id: 1 })).toBeNull();
  });

  it('omits empty optional fields', () => {
    const job = mapJobPosting({ id: 7, titulo: 'Técnico', empresa: ' ', localizacion: '' });
    expect(job?.company).toBeUndefined();
    expect(job?.location).toBeUndefined();
  });
});

describe('parseSearchResponse', () => {
  it('parses totals and jobs', () => {
    const { total, jobs } = parseSearchResponse({ total: 116, content: [SAMPLE_POSTING] });
    expect(total).toBe(116);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.externalId).toBe('1118383973');
  });

  it('tolerates malformed payloads', () => {
    expect(parseSearchResponse(null)).toEqual({ total: 0, jobs: [] });
    expect(parseSearchResponse('oops')).toEqual({ total: 0, jobs: [] });
    expect(parseSearchResponse({ total: -1, content: 'nope' })).toEqual({ total: 0, jobs: [] });
  });

  it('skips malformed postings but keeps valid ones', () => {
    const { jobs } = parseSearchResponse({
      total: 2,
      content: [{ id: 'bad' }, SAMPLE_POSTING],
    });
    expect(jobs).toHaveLength(1);
  });
});

describe('laborumSkill.scan', () => {
  const profile: CandidateProfile = { id: 1, skills: [{ name: 'mantención' }] };

  it('emits job_found per job and returns counts', async () => {
    const client = makeApiClient([
      { body: { total: 2, content: [SAMPLE_POSTING, { ...SAMPLE_POSTING, id: 222, titulo: 'TÉCNICO HVAC' }] } },
    ]);
    vi.mocked(playwrightRequest.newContext).mockResolvedValue(client as never);

    const emitter = makeEmitter();
    const result = await laborumSkill.scan(profile, { events: emitter });

    expect(result).toEqual({ jobsFound: 2, jobsNew: 2, jobsDuplicate: 0, errors: 0 });
    const jobEvents = emitter.events.filter((e) => e.kind === 'job_found');
    expect(jobEvents).toHaveLength(2);
    expect(jobEvents[0]?.payload).toMatchObject({ externalId: '1118383973' });
    expect(emitter.events.at(-1)?.kind).toBe('scan_completed');
    expect(client.dispose).toHaveBeenCalled();
  });

  it('dedupes jobs that repeat across pages', async () => {
    const full = Array.from({ length: 20 }, (_, i) => ({ ...SAMPLE_POSTING, id: 1000 + i }));
    const client = makeApiClient([
      { body: { total: 21, content: full } },
      { body: { total: 21, content: [full[0], { ...SAMPLE_POSTING, id: 9999 }] } },
      { body: { total: 21, content: [] } },
    ]);
    vi.mocked(playwrightRequest.newContext).mockResolvedValue(client as never);

    const emitter = makeEmitter();
    const result = await laborumSkill.scan(profile, { events: emitter });

    expect(result.jobsFound).toBe(21);
    expect(client.post).toHaveBeenCalledTimes(2);
  });

  it('stops paginating when a page returns fewer than PAGE_SIZE jobs', async () => {
    const client = makeApiClient([
      { body: { total: 116, content: [SAMPLE_POSTING] } },
    ]);
    vi.mocked(playwrightRequest.newContext).mockResolvedValue(client as never);

    const emitter = makeEmitter();
    await laborumSkill.scan(profile, { events: emitter });
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it('counts errors and continues when the API returns non-2xx', async () => {
    const client = makeApiClient([{ status: 403, body: {} }]);
    vi.mocked(playwrightRequest.newContext).mockResolvedValue(client as never);

    const emitter = makeEmitter();
    const result = await laborumSkill.scan(profile, { events: emitter });

    expect(result.jobsFound).toBe(0);
    expect(result.errors).toBe(1);
    expect(emitter.events.some((e) => e.kind === 'scan_error')).toBe(true);
  });

  it('counts errors and continues on network failure', async () => {
    const client = makeApiClient([{ throwError: new Error('socket hang up') }]);
    vi.mocked(playwrightRequest.newContext).mockResolvedValue(client as never);

    const emitter = makeEmitter();
    const result = await laborumSkill.scan(profile, { events: emitter });

    expect(result).toEqual({ jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 1 });
  });

  it('tolerates unexpected response shapes (site changed)', async () => {
    const client = makeApiClient([{ body: '<html>Cloudflare challenge</html>' }]);
    vi.mocked(playwrightRequest.newContext).mockResolvedValue(client as never);

    const emitter = makeEmitter();
    const result = await laborumSkill.scan(profile, { events: emitter });

    expect(result.jobsFound).toBe(0);
    expect(result.errors).toBe(0);
  });
});

describe('laborumSkill.selfCheck', () => {
  it('reports healthy when chromium launches', async () => {
    vi.mocked(chromium.launch).mockResolvedValue({ close: vi.fn(async () => undefined) } as never);
    const health = await laborumSkill.selfCheck();
    expect(health.status).toBe('healthy');
    expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
  });

  it('reports broken when chromium fails to launch', async () => {
    vi.mocked(chromium.launch).mockRejectedValue(new Error('Executable missing'));
    const health = await laborumSkill.selfCheck();
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('PLAYWRIGHT_LAUNCH_FAILED');
    expect(health.lastError?.message).toContain('Executable missing');
  });
});
