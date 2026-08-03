import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { applicationEvents } from '@employment-agent/database/schema';
import { asc, desc, gt } from 'drizzle-orm';
import { chronologicalSnapshot, encodeSse, HISTORY_LIMIT, readEventCursor } from '../../lib/activity-stream.js';

export const prerender = false;

const POLL_MS = Number(process.env.SSE_POLL_MS ?? 1000);
const HEARTBEAT_MS = 15_000;

export const GET: APIRoute = async ({ request, url }) => {
  let lastSeen = readEventCursor(request, url) ?? 0;
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

      if (lastSeen === 0) {
        const rows = await db.select().from(applicationEvents)
          .orderBy(desc(applicationEvents.id)).limit(HISTORY_LIMIT);
        const snapshot = chronologicalSnapshot(rows);
        if (snapshot.length > 0) {
          lastSeen = snapshot.at(-1)!.id;
          send(`event: snapshot\nid: ${lastSeen}\ndata: ${JSON.stringify(snapshot)}\n\n`);
        }
      }

      const poll = setInterval(async () => {
        try {
          const rows = await db
            .select()
            .from(applicationEvents)
            .where(gt(applicationEvents.id, lastSeen))
            .orderBy(asc(applicationEvents.id))
            .limit(50);
          for (const row of rows) {
            send(encodeSse(row));
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
