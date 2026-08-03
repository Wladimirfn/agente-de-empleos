import { describe, it, expect } from 'vitest';
import type { CandidateProfile } from '@employment-agent/domain';
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
  type ListingCard,
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