import type { APIRoute } from 'astro';
import { getActiveAgent } from '../../../lib/agent.js';
import { searchJobs } from '../../../lib/job-search.js';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const obj = body as Record<string, unknown>;
  const query = obj.query;
  if (typeof query !== 'string' || query.trim() === '') {
    return json({ error: 'Field "query" must be a non-empty string' }, 400);
  }
  const location = typeof obj.location === 'string' && obj.location.trim() !== '' ? obj.location.trim() : undefined;
  const limit = typeof obj.limit === 'number' ? Math.max(1, Math.min(50, obj.limit)) : 20;

  const { provider, status } = await getActiveAgent();
  if (!status.active) {
    return json({
      error: 'No hay un proveedor de IA configurado. Andá a Configuración y elegí un proveedor.',
      code: 'PROVIDER_NOT_CONFIGURED',
    }, 503);
  }

  try {
    const results = await searchJobs({ query: query.trim(), location, limit, useTargetRoles: true }, provider);
    return json({ jobs: results, query: query.trim(), location: location ?? null, count: results.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo completar la búsqueda.';
    if (message.includes('perfil')) {
      return json({ error: message, code: 'NO_PROFILE' }, 400);
    }
    return json({ error: message, code: 'SEARCH_FAILED' }, 500);
  }
};
