import type { APIRoute } from 'astro';
import { addFact, clearAllFacts, deleteFact, listFacts, type MemoryFact } from '../../../lib/agent-memory.js';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const GET: APIRoute = async () => {
  const facts = await listFacts();
  return json({ facts });
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const obj = body as Record<string, unknown>;
  const fact = obj.fact;
  if (typeof fact !== 'string' || fact.trim() === '') {
    return json({ error: 'Field "fact" must be a non-empty string' }, 400);
  }
  const category = typeof obj.category === 'string' ? (obj.category as MemoryFact['category']) : 'other';
  const importance = typeof obj.importance === 'number' ? Math.max(1, Math.min(10, Math.round(obj.importance))) : 5;
  const source = typeof obj.source === 'string' ? (obj.source as MemoryFact['source']) : 'manual';

  try {
    const created = await addFact({ fact: fact.trim(), category, importance, source });
    return json({ fact: created }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo guardar el hecho.';
    // Only show "no hay perfil" as a 400; everything else is a 500.
    if (message.includes('perfil')) return json({ error: message, code: 'NO_PROFILE' }, 400);
    return json({ error: message }, 500);
  }
};

export const DELETE: APIRoute = async ({ url }) => {
  const idParam = url.searchParams.get('id');
  if (idParam === 'all') {
    const removed = await clearAllFacts();
    return json({ removed });
  }
  if (!idParam) {
    return json({ error: 'Provide ?id=<number> or ?id=all' }, 400);
  }
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: 'id must be a positive integer' }, 400);
  }
  const ok = await deleteFact(id);
  if (!ok) return json({ error: 'Fact not found' }, 404);
  return json({ removed: id });
};
