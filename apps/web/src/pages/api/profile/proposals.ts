import type { APIRoute } from 'astro';
import { applyProposal } from '../../../lib/profile-apply.js';
import { listProposals, resolveProposal } from '../../../lib/profile-targets.js';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const GET: APIRoute = async ({ url }) => {
  const status = url.searchParams.get('status') as 'pending' | 'accepted' | 'rejected' | null;
  const proposals = await listProposals(status ?? undefined);
  return json({ proposals });
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
  const action = obj.action;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return json({ error: 'Field "id" must be a positive integer' }, 400);
  }
  if (action !== 'accepted' && action !== 'rejected') {
    return json({ error: 'Field "action" must be "accepted" or "rejected"' }, 400);
  }

  if (action === 'rejected') {
    const resolved = await resolveProposal({ id, action: 'rejected' });
    if (!resolved) return json({ error: 'Proposal not found or already resolved' }, 404);
    return json({ proposal: resolved });
  }

  // action === 'accepted' → apply the changes to the profile.
  try {
    const applied = await applyProposal(id);
    if (!applied) return json({ error: 'Proposal not found or already resolved' }, 404);
    return json({ proposal: applied });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo aplicar la propuesta.';
    if (message.includes('perfil')) return json({ error: message, code: 'NO_PROFILE' }, 400);
    return json({ error: message, code: 'APPLY_FAILED' }, 500);
  }
};
