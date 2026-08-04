import type { APIRoute } from 'astro';
import { getSessionCapture, setSessionCancelled } from '@employment-agent/security';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/**
 * POST /api/settings/credentials/session/:id/cancel
 *
 * The user clicked "Cancelar" in the UI. The worker is polling this row
 * for `user_completed_at`; flipping status to 'cancelled' is the signal
 * that makes the worker exit its loop cleanly. The cancel is a no-op on
 * sessions that are already terminal (completed, expired, or cancelled)
 * so the endpoint is idempotent — clients can retry without side effects.
 */
export const POST: APIRoute = async ({ params }) => {
  const id = params.id?.trim() ?? '';
  if (!id) return json({ error: 'Missing session id.' }, 400);
  const session = await getSessionCapture(id);
  if (!session) return json({ error: 'Session not found.' }, 404);
  if (session.status === 'completed' || session.status === 'cancelled' || session.status === 'expired') {
    return json({ ok: true, status: session.status });
  }
  await setSessionCancelled(id);
  return json({ ok: true, status: 'cancelled' });
};
