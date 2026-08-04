import type { APIRoute } from 'astro';
import { setSessionUserCompleted } from '@employment-agent/security';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/**
 * POST /api/settings/credentials/session/:id/complete
 *
 * The user clicked "Listo" in the UI. The worker is polling this row
 * for `user_completed_at`; setting it to "now" is the signal that
 * triggers the storage-state capture.
 */
export const POST: APIRoute = async ({ params }) => {
  const id = params.id?.trim() ?? '';
  if (!id) return json({ error: 'Missing session id.' }, 400);
  await setSessionUserCompleted(id);
  return json({ ok: true });
};
