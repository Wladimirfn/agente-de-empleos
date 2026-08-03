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