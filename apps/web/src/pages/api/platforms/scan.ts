import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { platforms, taskQueue } from '@employment-agent/database/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { API_SOURCES, scanApiSource } from '../../../lib/scan-api-source.js';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const obj = body as Record<string, unknown>;
  const slug = obj.slug;
  if (typeof slug !== 'string' || slug.trim() === '') {
    return json({ error: 'Field "slug" is required' }, 400);
  }

  // Verify the platform exists
  const platform = await db.select().from(platforms).where(eq(platforms.slug, slug)).limit(1);
  if (platform.length === 0) return json({ error: `Platform "${slug}" not found` }, 404);

  if (API_SOURCES.has(slug)) {
    // API-based source: scan directly from the web server.
    try {
      const { jobsFound, jobsNew } = await scanApiSource(slug);
      return json({
        scanned: true,
        source: 'api',
        slug,
        jobsFound,
        jobsNew,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `Scan failed: ${message}`, slug }, 500);
    }
  }

  // Browser-based source: enqueue a task for the worker.
  // mode=agent uses the LLM browser agent directly; default uses the deterministic skill.
  const mode = typeof obj.mode === 'string' ? obj.mode : 'skill';
  const taskId = randomUUID();

  if (mode === 'agent') {
    await db.insert(taskQueue).values({
      id: taskId,
      type: 'BROWSER_AGENT_SCAN',
      payloadJson: JSON.stringify({
        skillSlug: slug,
        platformUrl: platform[0]!.baseUrl ?? `https://www.${slug}.cl`,
        triggeredBy: 'web-ui-agent',
      }),
      status: 'pending',
      attempts: 0,
      maxAttempts: 1,
      scheduledAt: new Date().toISOString(),
    });
    return json({
      scanned: false,
      source: 'browser-agent',
      slug,
      taskId,
      message: 'Agente LLM encolado. Abrirá un navegador para buscar manualmente.',
    });
  }

  await db.insert(taskQueue).values({
    id: taskId,
    type: 'SCAN_PLATFORM',
    payloadJson: JSON.stringify({ skillSlug: slug, triggeredBy: 'web-ui' }),
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    scheduledAt: new Date().toISOString(),
  });

  return json({
    scanned: false,
    source: 'worker',
    slug,
    taskId,
    message: 'Tarea encolada. El worker la procesará en los próximos segundos.',
  });
};
