import type { APIRoute } from 'astro';
import { listCredentials, saveCredential, deleteCredential } from '@employment-agent/security';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export const GET: APIRoute = async () => {
  return json({ credentials: await listCredentials() });
};

/**
 * POST /api/settings/credentials
 * Body: { slug: string, email: string, password: string, consent: true }
 * The `consent` field MUST be true; the API rejects silently if it's missing
 * or false. This is the explicit-consent gate the user requested.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const data = body as Record<string, unknown>;
  const slug = typeof data.slug === 'string' ? data.slug.trim() : '';
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const password = typeof data.password === 'string' ? data.password : '';
  const consent = data.consent === true;
  if (!SLUG_PATTERN.test(slug)) return json({ error: 'Invalid slug (must match /^[a-z][a-z0-9_-]{0,63}$/).' }, 400);
  if (!email || !email.includes('@')) return json({ error: 'Invalid email.' }, 400);
  if (!password || password.length < 1) return json({ error: 'Password is required.' }, 400);
  if (!consent) return json({ error: 'Explicit consent is required to save credentials.' }, 400);
  try {
    await saveCredential({ slug, email, password });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
  return json({ ok: true, slug });
};

export const DELETE: APIRoute = async ({ url }) => {
  const slug = url.searchParams.get('slug')?.trim() ?? '';
  if (!SLUG_PATTERN.test(slug)) return json({ error: 'Invalid slug.' }, 400);
  await deleteCredential(slug);
  return json({ ok: true, slug });
};
