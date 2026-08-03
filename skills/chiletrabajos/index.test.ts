import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CandidateProfile } from '@employment-agent/domain';
import type { EventPayload } from '@employment-agent/skill-runtime';

vi.mock('playwright', () => ({
  request: { newContext: vi.fn() },
}));

import { request as playwrightRequest } from 'playwright';
import {
  chiletrabajosSkill,
  type ListingsFetch,
} from './index.js';

const LISTING = `<section class="listings">
<article><a href="/trabajo/tecnico-en-refrigeracion-9384011">Técnico en Refrigeración</a><span>Empresa Refrigeración Sur · Santiago · Publicada 28-07-2026</span></article>
<article><a href="/trabajo/operario-de-bodega-9384012">Operario de Bodega Turno Día</a><span>Empresa LogAndes · Maipú · Publicada 30-07-2026</span></article>
<article><a href="/trabajo/ayudante-de-mantencion-9384013">Ayudante de Mantención</a><span>Empresa Mantención Industrial · Quilicura · Publicada 02-08-2026</span></article>
</section>`;
const PAGE2 = `<section><article><a href="/trabajo/tecnico-en-refrigeracion-9384011">Repetido</a></article><article><a href="/trabajo/supervisor-de-turno-9384033">Supervisor Nocturno</a></article></section>`;
const DETAIL = `<html><head><meta name="description" content="Empresa busca técnico con al menos dos años de experiencia en mantenimiento de cámaras de frío."></head><body><p>Modalidad: Presencial. Jornada: Full-time.</p></body></html>`;
const EMPTY = `<section class="listings"></section>`;

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

const profile: CandidateProfile = { id: 1, skills: [{ name: 'refrigeración' }] };

beforeEach(() => vi.clearAllMocks());

describe('chiletrabajosSkill contract', () => {
  it('exports the canonical slug, version, displayName and capabilities', () => {
    expect(chiletrabajosSkill.slug).toBe('chiletrabajos');
    expect(chiletrabajosSkill.version).toBe('0.1.0');
    expect(chiletrabajosSkill.displayName).toBe('Chiletrabajos.cl');
    expect(chiletrabajosSkill.requiredCandidateFields).toEqual([]);
    expect(chiletrabajosSkill.capabilities).toEqual({ canScan: true, canApply: false, canDetectLoggedOut: false });
  });
});

describe('chiletrabajosSkill.scan', () => {
  it('emits job_found once per externalId, dedupes across pages, and finishes with scan_completed', async () => {
    useFetcher([
      { body: LISTING }, // warm-up
      { body: LISTING }, // page 1
      { body: DETAIL }, { body: DETAIL }, { body: DETAIL },
      { body: PAGE2 }, // page 2 (1 duplicate + 1 new)
      { body: DETAIL },
    ]);
    const { events, emit } = eventCapture();
    const result = await chiletrabajosSkill.scan(profile, { events: { emit } });
    expect(result).toMatchObject({ jobsFound: 4, jobsNew: 4, jobsDuplicate: 1, errors: 0 });
    expect(events.find((event) => event.kind === 'scan_started')).toBeDefined();
    expect(events.at(-1)?.kind).toBe('scan_completed');
    expect(new Set(events.filter((event) => event.kind === 'job_found').map((event) => (event.payload as { externalId: string }).externalId))).toEqual(new Set(['9384011', '9384012', '9384013', '9384033']));
  });

  it('stops paginating when a page returns zero cards and only consumes the warm-up + page 1 fetches', async () => {
    useFetcher([{ body: LISTING }, { body: LISTING }, { body: DETAIL }, { body: DETAIL }, { body: DETAIL }, { body: EMPTY }]);
    const { events, emit } = eventCapture();
    const result = await chiletrabajosSkill.scan(profile, { events: { emit } });
    expect(result.jobsFound).toBe(3);
    expect(events.filter((event) => event.kind === 'job_found')).toHaveLength(3);
  });

  it('emits scan_error with warm-up failure but still completes the scan with errors=1', async () => {
    useFetcher([{ throwError: new Error('warm-up socket hang up') }, { body: EMPTY }]);
    const { events, emit } = eventCapture();
    const result = await chiletrabajosSkill.scan(profile, { events: { emit } });
    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(events.some((event) => event.kind === 'scan_error' && (event.payload as { query: string }).query === '<home>')).toBe(true);
    expect(events.at(-1)?.kind).toBe('scan_completed');
  });

  it('emits scan_error for a per-page failure and continues to the next query', async () => {
    const profileWithQueries: CandidateProfile = { id: 1, skills: [{ name: 'mantención' }, { name: 'refrigeración' }, { name: 'bodega' }] };
    useFetcher([
      { body: LISTING }, // warm-up
      { throwError: new Error('socket hang up') }, // query 1 page 1 fails
      { body: LISTING }, // query 2 page 1 succeeds
      { body: DETAIL }, { body: DETAIL }, { body: DETAIL },
    ]);
    const { events, emit } = eventCapture();
    const result = await chiletrabajosSkill.scan(profileWithQueries, { events: { emit } });
    expect(result.jobsFound).toBe(3);
    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(events.filter((event) => event.kind === 'scan_error')).toHaveLength(1);
  });

  it('emits only the four allowed event kinds', async () => {
    useFetcher([{ body: LISTING }, { body: LISTING }, { body: DETAIL }, { body: DETAIL }, { body: DETAIL }]);
    const { events, emit } = eventCapture();
    await chiletrabajosSkill.scan(profile, { events: { emit } });
    for (const event of events) expect(['scan_started', 'scan_completed', 'job_found', 'scan_error']).toContain(event.kind);
  });
});

describe('chiletrabajosSkill.selfCheck', () => {
  it('reports healthy for 2xx on the approved host', async () => {
    useFetcher([{ status: 200, body: LISTING }]);
    const health = await chiletrabajosSkill.selfCheck();
    expect(health.status).toBe('healthy');
  });

  it('reports healthy for 3xx redirect that stays on the approved host', async () => {
    useFetcher([{ status: 302, finalUrl: 'https://www.chiletrabajos.cl/encuentra-un-empleo?keyword=mantenimiento' }]);
    const health = await chiletrabajosSkill.selfCheck();
    expect(health.status).toBe('healthy');
  });

  it('reports degraded for 3xx redirect to a foreign origin', async () => {
    useFetcher([{ status: 302, finalUrl: 'https://malware.example/' }]);
    const health = await chiletrabajosSkill.selfCheck();
    expect(health.status).toBe('degraded');
    expect(health.lastError?.code).toBeUndefined();
    expect(JSON.stringify(health)).not.toMatch(/https?:\/\/|file:\/\/|:\\\\|\/tmp\/|\/opt\//);
  });

  it('reports broken for 5xx with sanitized message and no URL leakage', async () => {
    useFetcher([{ status: 502 }]);
    const health = await chiletrabajosSkill.selfCheck();
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('CHILETRABAJOS_HTTP');
    expect(health.lastError?.message).not.toMatch(/https?:\/\/|file:\/\/|:\\\\|\/tmp\/|\/opt\//);
  });

  it('reports broken when the network call throws with CHILETRABAJOS_FETCH code', async () => {
    vi.mocked(playwrightRequest.newContext).mockRejectedValue(new Error('Executable missing'));
    const health = await chiletrabajosSkill.selfCheck();
    expect(health.status).toBe('broken');
    expect(health.lastError?.code).toBe('CHILETRABAJOS_FETCH');
    expect(health.lastError?.message).toContain('Executable missing');
  });
});

describe('bounded scan behavior', () => {
  it('stops emitting jobs after the deadline', async () => {
    const virtualNow = { value: 0 };
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => virtualNow.value);
    vi.mocked(playwrightRequest.newContext).mockResolvedValue({
      get: vi.fn(async (url: string) => {
        virtualNow.value += 80_000;
        const body = '<section><article><a href="/trabajo/x-1">T1</a></article></section>';
        return { ok: () => true, status: () => 200, text: async () => body, url: () => url };
      }),
      dispose: vi.fn(),
    } as never);
    try {
      const result = await chiletrabajosSkill.scan({ id: 1, skills: [{ name: 'refrigeración' }] }, { events: { emit: vi.fn() } });
      expect(result.jobsFound).toBe(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('stops paginating after MAX_PAGES_PER_QUERY pages even when results continue', async () => {
    const buildPage = (page: number) => `<section><article><a href="/trabajo/tecnico-refrigeracion-${page}">T${page}</a></article></section>`;
    const pages: Array<{ body: string }> = [];
    for (let page = 1; page <= 6; page++) pages.push({ body: buildPage(page) });
    useFetcher([{ body: buildPage(1) }, ...pages]);
    const { events, emit } = eventCapture();
    const result = await chiletrabajosSkill.scan({ id: 1, skills: [{ name: 'mantención' }] }, { events: { emit } });
    expect(result.jobsFound).toBe(2);
    expect(events.filter((event) => event.kind === 'job_found')).toHaveLength(2);
  });
});

describe('error sanitization', () => {
  it('scan_error messages never include http(s) URLs, file URLs, Windows paths, or absolute POSIX paths', async () => {
    const queryTime = vi.fn().mockReturnValue(0);
    vi.mocked(playwrightRequest.newContext).mockResolvedValue({
      get: vi.fn(async (url: string) => {
        throw new Error(`fetch failed for https://attacker.example/payload?id=1 at /tmp/agent/runner.ts:42:7 (C:\\Users\\agent\\runner.ts:42:7)`);
      }),
      dispose: vi.fn(),
    } as never);
    const profileWithQueries: CandidateProfile = { id: 1, skills: [{ name: 'mantención' }, { name: 'refrigeración' }, { name: 'bodega' }] };
    const { events, emit } = eventCapture();
    await chiletrabajosSkill.scan(profileWithQueries, { events: { emit } });
    for (const event of events.filter((event) => event.kind === 'scan_error')) {
      expect(JSON.stringify(event)).not.toMatch(/https?:\/\/|file:\/\/|:\\\\|\/tmp\/|\/opt\//);
    }
  });
});