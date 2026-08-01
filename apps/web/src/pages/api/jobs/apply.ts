import type { APIRoute } from 'astro';
import { getActiveAgent } from '../../../lib/agent.js';
import { applyToJob } from '../../../lib/job-search.js';

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
  const jobId = (body as Record<string, unknown>)?.jobId;
  if (typeof jobId !== 'number' || !Number.isInteger(jobId) || jobId <= 0) {
    return json({ error: 'Field "jobId" must be a positive integer' }, 400);
  }

  const { provider, status } = await getActiveAgent();
  if (!status.active) {
    return json({
      error: 'No hay un proveedor de IA configurado.',
      code: 'PROVIDER_NOT_CONFIGURED',
    }, 503);
  }

  try {
    const { applicationId } = await applyToJob({ jobId, llm: provider });
    return json({ applicationId, jobId }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo postular.';
    if (message.includes('perfil')) return json({ error: message, code: 'NO_PROFILE' }, 400);
    if (message.includes('no encontrada')) return json({ error: message, code: 'JOB_NOT_FOUND' }, 404);
    return json({ error: message, code: 'APPLY_FAILED' }, 500);
  }
};
