import { describe, it, expect } from 'vitest';
import type { CandidateProfile } from '@employment-agent/domain';
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
} from './index.js';

const LISTING = `<section class="listings">
<article><a href="/trabajo/tecnico-en-refrigeracion-9384011">Técnico en Refrigeración</a><span>Empresa Refrigeración Sur · Santiago · Publicada 28-07-2026</span></article>
<article><a href="/trabajo/operario-de-bodega-9384012">Operario de Bodega Turno Día</a><span>Empresa LogAndes · Maipú · Publicada 30-07-2026</span></article>
<article><a href="/trabajo/ayudante-de-mantencion-9384013">Ayudante de Mantención</a><span>Empresa Mantención Industrial · Quilicura · Publicada 02-08-2026</span></article>
</section>`;
const MALFORMED = `<section>
<article><a href="https://malware.example/oferta">Enlace externo</a></article>
<article><a href="/trabajo/oferta-sin-id">Sin id</a></article>
<article><a href="/trabajo/tecnico-refrigeracion-9384050">  </a></article>
<article><a href="/trabajo/operario-limpieza-9384051">Operario de Limpieza</a></article>
</section>`;
const EMPTY = `<section class="listings"></section>`;
const DETAIL = `<html><head><meta name="description" content="Empresa busca técnico con al menos dos años de experiencia en mantenimiento de cámaras de frío."></head><body><p>Modalidad: Presencial. Jornada: Full-time.</p></body></html>`;

describe('buildQueries', () => {
  it('uses defaults and caps at MAX_QUERIES when the profile has no skills', () => {
    expect(buildQueries({} as CandidateProfile)).toEqual(['mantención', 'refrigeración', 'bodega']);
    expect(buildQueries({ skills: ['aa', 'bb', 'cc', 'dd', 'ee'].map((name) => ({ name })) } as CandidateProfile)).toHaveLength(3);
  });

  it('combines target roles and short skills, deduped', () => {
    const profile: CandidateProfile = {
      summary: 'Roles objetivo activos: Técnico de Refrigeración (prioridad 1), Operario Logístico (prioridad 2)',
      skills: [{ name: 'Refrigeración' }, { name: ' refrigeración ' }, { name: 'Electricidad' }],
    };
    expect(buildQueries(profile)).toEqual([
      'Técnico de Refrigeración', 'Operario Logístico', 'Refrigeración', 'Electricidad',
    ].slice(0, 3));
  });

  it('drops skill names longer than MAX_QUERY_LENGTH', () => {
    const long = 'a'.repeat(40);
    expect(buildQueries({ skills: [{ name: long }, { name: 'OK' }] } as CandidateProfile)).toEqual(['OK']);
  });
});

describe('URL builders', () => {
  it.each([
    [1, 'https://www.chiletrabajos.cl/encuentra-un-empleo?keyword=mantenci%C3%B3n&sort=Fecha'],
    [2, 'https://www.chiletrabajos.cl/encuentra-un-empleo/2?keyword=mantenci%C3%B3n&sort=Fecha'],
    [3, 'https://www.chiletrabajos.cl/encuentra-un-empleo/3?keyword=mantenci%C3%B3n&sort=Fecha'],
  ])('builds page %i URL', (page, expected) => {
    expect(buildListingsUrl('mantención', page)).toBe(expected);
  });

  it('builds the canonical detail URL from slug and id', () => {
    expect(buildDetailUrl('tecnico-refrigeracion', '9384011')).toBe('https://www.chiletrabajos.cl/trabajo/tecnico-refrigeracion-9384011');
  });
});

describe('parseJobSlugAndId', () => {
  it.each([
    ['tecnico-refrigeracion-9384011', { slug: 'tecnico-refrigeracion', id: '9384011' }],
    ['-9384011', null],
    ['slug-no-id-valido', null],
    ['operario-limpieza-9384051', { slug: 'operario-limpieza', id: '9384051' }],
  ])('parses %s', (input, expected) => {
    expect(parseJobSlugAndId(input)).toEqual(expected);
  });
});

describe('extractExternalId', () => {
  it.each([
    ['https://malware.example/trabajo/x-1', null],
    ['https://www.chiletrabajos.cl/trabajo/tecnico-refrigeracion-9384011', '9384011'],
    ['https://www.chiletrabajos.cl/search?q=mantenimiento', null],
  ])('returns %s for %s', (href, expected) => {
    expect(extractExternalId(href)).toBe(expected);
  });
});

describe('parseListingsHtml', () => {
  it('parses canonical anchor cards', () => {
    const cards = parseListingsHtml(LISTING);
    expect(cards.map((card) => card.externalId)).toEqual(['9384011', '9384012', '9384013']);
    expect(cards[0]?.url).toBe('https://www.chiletrabajos.cl/trabajo/tecnico-en-refrigeracion-9384011');
    expect(cards[0]?.title).toBe('Técnico en Refrigeración');
  });

  it('returns no cards for an empty listings section', () => {
    expect(parseListingsHtml(EMPTY)).toEqual([]);
  });

  it('skips malformed anchors and external hosts but keeps valid cards', () => {
    expect(parseListingsHtml(MALFORMED).map((card) => card.externalId)).toEqual(['9384051']);
  });

  it('deduplicates repeated anchors on the same page', () => {
    const html = `<section><article><a href="/trabajo/tecnico-en-refrigeracion-9384011">Repetido 1</a></article><article><a href="/trabajo/tecnico-en-refrigeracion-9384011">Repetido 2</a></article></section>`;
    expect(parseListingsHtml(html)).toHaveLength(1);
  });
});

describe('parseListingMeta', () => {
  it('extracts company, location and publishedAt from sibling segments', () => {
    const meta = parseListingMeta(LISTING, '9384012');
    expect(meta?.company).toContain('LogAndes');
    expect(meta?.location).toContain('Maipú');
    expect(meta?.publishedAt).toContain('30-07-2026');
  });

  it('returns null when the external id is not in the html', () => {
    expect(parseListingMeta(LISTING, '9999999')).toBeNull();
  });

  it('returns null when no matching anchor exists', () => {
    const html = `<section><article><a href="/trabajo/oferta-1">Oferta</a></article></section>`;
    expect(parseListingMeta(html, '9999')).toBeNull();
  });
});

describe('parseDetailDescription', () => {
  it('extracts the meta description plus modality and employment type', () => {
    const detail = parseDetailDescription(DETAIL);
    expect(detail.description).toContain('mantenimiento de cámaras');
    expect(detail.modality).toBe('Presencial');
    expect(detail.employmentType).toBe('Full-time');
  });

  it('returns empty detail for a challenge page', () => {
    expect(parseDetailDescription('<html><body><h1>Verify</h1></body></html>')).toEqual({});
  });

  it('truncates a long meta description', () => {
    const long = 'a'.repeat(2000);
    const html = `<head><meta name="description" content="${long}"></head><body></body>`;
    const detail = parseDetailDescription(html);
    expect(detail.description?.length).toBeLessThanOrEqual(1200);
  });
});

describe('normalizeListing', () => {
  it('merges anchor and sibling metadata and applies field caps', () => {
    const card = parseListingsHtml(LISTING).find((item) => item.externalId === '9384012')!;
    const job = normalizeListing(card, parseListingMeta(LISTING, card.externalId)!);
    expect(job).toMatchObject({ externalId: '9384012', title: 'Operario de Bodega Turno Día', company: expect.stringContaining('LogAndes'), location: expect.stringContaining('Maipú') });
    expect(job.url).toBe('https://www.chiletrabajos.cl/trabajo/operario-de-bodega-9384012');
  });

  it('falls back to the anchor title when meta is null', () => {
    const card = { externalId: '1', title: 'Anchor Title', url: 'https://www.chiletrabajos.cl/trabajo/anchor-title-1' };
    const job = normalizeListing(card, null);
    expect(job.title).toBe('Anchor Title');
    expect(job.company).toBeUndefined();
  });

  it('prefers the meta title when provided and falls back to the anchor otherwise', () => {
    const card = { externalId: '1', title: 'Anchor Title', url: 'https://www.chiletrabajos.cl/trabajo/anchor-title-1' };
    expect(normalizeListing(card, null).title).toBe('Anchor Title');
    const metaTitle = { title: 'Meta Title' };
    expect(normalizeListing(card, metaTitle).title).toBe('Meta Title');
  });
});

describe('ensureApprovedOrigin', () => {
  it('accepts the canonical host', () => {
    expect(ensureApprovedOrigin('https://www.chiletrabajos.cl/encuentra-un-empleo').hostname).toBe('www.chiletrabajos.cl');
  });

  it('rejects external hosts', () => {
    expect(() => ensureApprovedOrigin('https://malware.example/')).toThrow(/Host no aprobado/);
  });
});