import type { JobSource, JobSourceResult } from './types.js';

const BASE_URL = 'https://arbeitnow.com/api/job-board-api';

/**
 * Arbeitnow — Germany/EU-centric job board with a free public JSON API.
 * No auth, no rate-limit key. Useful as a backup when GetOnboard returns
 * nothing for a query (e.g. non-tech Chilean roles).
 *
 * The API does not support server-side search filters, so we pull the
 * current page and filter client-side. Pagination is shallow (the API
 * paginates over the whole corpus); for MVP we only read page 1.
 */
export class ArbeitnowSource implements JobSource {
  readonly name = 'arbeitnow';

  async searchJobs(query: string, _location?: string): Promise<JobSourceResult[]> {
    const url = `${BASE_URL}?page=1`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'employment-agent/0.1 (local-first job agent)',
      },
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const rows = Array.isArray(json.data) ? json.data : [];
    const q = query.toLowerCase();
    return rows
      .filter((row) => {
        const title = String(row.title ?? '').toLowerCase();
        const description = String(row.description ?? '').toLowerCase();
        const company = String(row.company_name ?? '').toLowerCase();
        return title.includes(q) || description.includes(q) || company.includes(q);
      })
      .map((row) => ({
        externalId: String(row.slug ?? ''),
        platformSlug: 'arbeitnow',
        title: String(row.title ?? ''),
        company: typeof row.company_name === 'string' ? row.company_name : undefined,
        location: typeof row.location === 'string' ? row.location : undefined,
        url: typeof row.url === 'string' ? row.url : undefined,
        description: typeof row.description === 'string' ? row.description : undefined,
        rawPayload: row,
      } satisfies JobSourceResult))
      .filter((r) => r.externalId.length > 0 && r.title.length > 0);
  }
}
