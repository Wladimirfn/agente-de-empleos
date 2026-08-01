import type { APIRoute } from 'astro';
import { listMatches } from '../../../lib/job-search.js';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const GET: APIRoute = async ({ url }) => {
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam) || 50)) : 50;
  const jobs = await listMatches({ limit });
  return json({ jobs, count: jobs.length });
};
