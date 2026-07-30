import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { applicationEvents } from '@employment-agent/database/schema';
import { gt } from 'drizzle-orm';

export const prerender = false;

const POLL_MS = Number(process.env.SSE_POLL_MS ?? 1000);
const HEARTBEAT_MS = 15_000;

export const GET: APIRoute = async ({ request }) => {
  let lastSeen = 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // connection closed
        }
      };

      const heartbeat = setInterval(() => send(':heartbeat\n\n'), HEARTBEAT_MS);

      const poll = setInterval(async () => {
        try {
          const rows = await db
            .select()
            .from(applicationEvents)
            .where(gt(applicationEvents.id, lastSeen))
            .limit(50);
          for (const row of rows) {
            send(`data: ${JSON.stringify(row)}\n\n`);
            lastSeen = row.id;
          }
        } catch (err) {
          send(`event: error\ndata: ${err instanceof Error ? err.message : String(err)}\n\n`);
        }
      }, POLL_MS);

      request.signal.addEventListener('abort', () => {
        clearInterval(poll);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
