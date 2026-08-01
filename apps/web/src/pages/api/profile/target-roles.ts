import type { APIRoute } from 'astro';
import {
  addTargetRole,
  deleteTargetRole,
  listTargetRoles,
  updateTargetRole,
} from '../../../lib/profile-targets.js';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const GET: APIRoute = async () => {
  const roles = await listTargetRoles();
  return json({ roles });
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const obj = body as Record<string, unknown>;
  const roleTitle = obj.roleTitle;
  if (typeof roleTitle !== 'string' || roleTitle.trim() === '') {
    return json({ error: 'Field "roleTitle" must be a non-empty string' }, 400);
  }
  try {
    const created = await addTargetRole({
      roleTitle: roleTitle.trim(),
      priority: typeof obj.priority === 'number' ? obj.priority : 1,
      isActive: obj.isActive !== false,
    });
    return json({ role: created }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo crear.';
    if (message.includes('perfil')) return json({ error: message, code: 'NO_PROFILE' }, 400);
    return json({ error: message }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const obj = body as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return json({ error: 'Field "id" must be a positive integer' }, 400);
  }
  const updated = await updateTargetRole({
    id,
    roleTitle: typeof obj.roleTitle === 'string' ? obj.roleTitle : undefined,
    priority: typeof obj.priority === 'number' ? obj.priority : undefined,
    isActive: typeof obj.isActive === 'boolean' ? obj.isActive : undefined,
  });
  if (!updated) return json({ error: 'Target role not found' }, 404);
  return json({ role: updated });
};

export const DELETE: APIRoute = async ({ url }) => {
  const idParam = url.searchParams.get('id');
  if (!idParam) return json({ error: 'Provide ?id=<number>' }, 400);
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id must be a positive integer' }, 400);
  const ok = await deleteTargetRole(id);
  if (!ok) return json({ error: 'Target role not found' }, 404);
  return json({ removed: id });
};
