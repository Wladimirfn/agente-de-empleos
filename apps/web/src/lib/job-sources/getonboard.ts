import type { JobSource, JobSourceResult } from './types.js';

const BASE_URL = 'https://www.getonbrd.com/api/v0/search/jobs';

/**
 * GetOnboard.cl — Chilean tech + startup job board. Public JSON API, no auth.
 *
 * Query params:
 *   - query: full-text search
 *   - per_page: 1-100 (default 24)
 *   - category: filter by category id
 *   - remote: 1 to filter remote-only
 *
 * Returned job objects carry a `data` field; we ignore the rest.
 */
export class GetOnboardSource implements JobSource {
  readonly name = 'getonboard';

  async searchJobs(query: string, location?: string): Promise<JobSourceResult[]> {
    const params = new URLSearchParams({ query, per_page: '30' });
    if (location) params.set('loc', location);
    const url = `${BASE_URL}?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'employment-agent/0.1 (local-first job agent)',
      },
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { data?: Array<{ id?: string; attributes?: Record<string, unknown> }> };
    const rows = Array.isArray(json.data) ? json.data : [];
    return rows
      .map((row) => {
        const attr = row.attributes ?? {};
        const title = typeof attr.title === 'string' ? attr.title : null;
        if (!title) return null;
        const company = typeof attr.company === 'object' && attr.company !== null
          ? (attr.company as { data?: { attributes?: { name?: string } } }).data?.attributes?.name
          : undefined;
        const countries = Array.isArray(attr.countries) ? attr.countries.join(', ') : '';
        const regions = attr.location_regions && typeof attr.location_regions === 'object'
          ? (attr.location_regions as { data?: Array<{ attributes?: { name?: string } }> }).data?.map((r) => r?.attributes?.name).filter(Boolean).join(', ')
          : '';
        const locationStr = [regions, countries].filter(Boolean).join(' · ') || undefined;
        const description = [attr.description_headline, attr.description, attr.functions_headline, attr.functions]
          .filter((s) => typeof s === 'string' && s.trim().length > 0)
          .join('\n\n');
        return {
          externalId: String(row.id ?? ''),
          platformSlug: 'getonboard',
          title,
          company,
          location: locationStr,
          url: typeof attr.url === 'string' ? attr.url : undefined,
          description,
          rawPayload: attr,
        } satisfies JobSourceResult;
      })
      .filter((r): r is JobSourceResult => r !== null && r.externalId.length > 0);
  }
}
