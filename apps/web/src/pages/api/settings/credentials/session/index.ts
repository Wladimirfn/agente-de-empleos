import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { sessionCaptures } from '@employment-agent/database/schema';
import { and, eq, gt } from 'drizzle-orm';
import { createSessionCapture, getSessionCapture, SESSION_TTL_MS } from '@employment-agent/security';

// The web doesn't talk to the worker process directly. We enqueue a task
// via the shared task_queue table; the worker polls and picks it up.
async function enqueueCaptureTask(payload: { sessionId: string; slug: string; platformUrl: string }) {
  const { randomUUID } = await import('node:crypto');
  const { taskQueue } = await import('@employment-agent/database/schema');
  await db.insert(taskQueue).values({
    id: randomUUID(),
    type: 'CAPTURE_SESSION',
    payloadJson: JSON.stringify(payload),
    status: 'pending',
    attempts: 0,
    maxAttempts: 1,
    scheduledAt: new Date().toISOString(),
  });
}

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const SLUG_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const PLATFORM_URLS: Record<string, string> = {
  indeed: 'https://cl.indeed.com',
  laborum: 'https://www.laborum.cl',
  computrabajo: 'https://www.computrabajo.cl',
  chiletrabajos: 'https://www.chiletrabajos.cl',
  empleosaqua: 'https://www.empleosaqua.com',
  trabajando: 'https://www.trabajando.cl',
};

/**
 * POST /api/settings/credentials/session
 * Body: { slug: string }
 *
 * Opens a headed Playwright browser on the platform's origin so the user
 * can log in manually (typically via OAuth). The session row stays in
 * "pending" until the worker confirms it has opened the browser, then
 * flips to "ready". The user clicks "Listo" in the UI to fire the
 * complete endpoint, which signals the worker to capture the storage state.
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
  if (!SLUG_PATTERN.test(slug)) return json({ error: 'Invalid slug.' }, 400);
  const platformUrl = PLATFORM_URLS[slug];
  if (!platformUrl) return json({ error: 'Unsupported platform for session capture.' }, 400);

  // Reject if there's already an active session for this slug.
  const now = new Date().toISOString();
  const active = await db.select({ id: sessionCaptures.id })
    .from(sessionCaptures)
    .where(and(
      eq(sessionCaptures.slug, slug),
      gt(sessionCaptures.expiresAt, now),
    ));
  if (active.length > 0) {
    return json({ error: 'There is already an active session for this platform. Cancel it before starting a new one.', sessionId: active[0]?.id }, 409);
  }

  const session = await createSessionCapture(slug);
  await enqueueCaptureTask({ sessionId: session.id, slug, platformUrl });
  return json({ sessionId: session.id, expiresAt: session.expiresAt, ttlMs: SESSION_TTL_MS });
};

export const GET: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get('id')?.trim() ?? '';
  if (!sessionId) return json({ error: 'Missing sessionId.' }, 400);
  const session = await getSessionCapture(sessionId);
  if (!session) return json({ error: 'Session not found.' }, 404);
  return json({ session });
};
