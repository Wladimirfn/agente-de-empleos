import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { db } from '@employment-agent/database';
import { taskQueue } from '@employment-agent/database/schema';

/**
 * POST /api/settings/launch-browser
 * Body: { browserId?: 'brave' | 'chrome' | 'edge' | 'comet' }
 *
 * Enqueues a LAUNCH_BROWSER task. The worker spawns the browser with
 * --remote-debugging-port=9222 and the user's default profile directory
 * so the connection has access to their existing cookies and Brave
 * shield settings.
 *
 * The user MUST close their existing browser before calling this
 * (Chrome locks the profile). After this returns 200, the user can
 * keep the new browser open and the agent's CAPTURE_SESSION will
 * connect over CDP.
 */
export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const POST: APIRoute = async ({ request }) => {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine, browserId is optional
  }
  const data = body as Record<string, unknown>;
  const browserId = typeof data.browserId === 'string' ? data.browserId : undefined;

  const id = randomUUID();
  await db.insert(taskQueue).values({
    id,
    type: 'LAUNCH_BROWSER',
    payloadJson: JSON.stringify({ browserId }),
    status: 'pending',
    attempts: 0,
    maxAttempts: 1,
    scheduledAt: new Date().toISOString(),
  });
  return json({ ok: true, taskId: id });
};
