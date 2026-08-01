import type { APIRoute } from 'astro';
import { listApplications, updateApplicationStatus } from '../../../lib/applications.js';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const GET: APIRoute = async () => {
  const applications = await listApplications();
  return json({ applications, count: applications.length });
};

export const PATCH: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const obj = body as Record<string, unknown>;
  const applicationId = obj.applicationId;
  const status = obj.status;
  if (typeof applicationId !== 'number' || !Number.isInteger(applicationId) || applicationId <= 0) {
    return json({ error: 'Field "applicationId" must be a positive integer' }, 400);
  }
  const valid = ['draft', 'ready', 'submitted', 'failed', 'rejected'] as const;
  if (typeof status !== 'string' || !valid.includes(status as typeof valid[number])) {
    return json({ error: `Field "status" must be one of ${valid.join(', ')}` }, 400);
  }
  try {
    const updated = await updateApplicationStatus({ applicationId, status: status as typeof valid[number] });
    if (!updated) return json({ error: 'Application not found' }, 404);
    return json({ application: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo actualizar la postulación.';
    if (message.includes('perfil')) return json({ error: message, code: 'NO_PROFILE' }, 400);
    return json({ error: message }, 500);
  }
};
