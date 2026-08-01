import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { candidateProfiles } from '@employment-agent/database/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const VALID_SCOPES = new Set(['local', 'national', 'international', 'remote']);

export const GET: APIRoute = async () => {
  const rows = await db.select().from(candidateProfiles).limit(1);
  if (rows.length === 0) return json({ searchScopes: ['local'], location: null });
  const p = rows[0];
  const raw = p.searchScope ?? 'local';
  const scopes = raw.split(',').map((s) => s.trim()).filter((s) => VALID_SCOPES.has(s));
  return json({ searchScopes: scopes.length > 0 ? scopes : ['local'], location: p.location ?? null });
};

export const PUT: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const obj = body as Record<string, unknown>;
  const scopes = obj.searchScopes;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return json({ error: 'searchScopes must be a non-empty array' }, 400);
  }
  for (const s of scopes) {
    if (typeof s !== 'string' || !VALID_SCOPES.has(s)) {
      return json({ error: `Invalid scope: ${s}. Must be one of: local, national, international, remote` }, 400);
    }
  }
  const rows = await db.select().from(candidateProfiles).limit(1);
  if (rows.length === 0) return json({ error: 'No profile found' }, 404);
  const value = scopes.join(',');
  await db
    .update(candidateProfiles)
    .set({ searchScope: value, updatedAt: new Date().toISOString() })
    .where(eq(candidateProfiles.id, rows[0].id));
  return json({ searchScopes: scopes });
};
