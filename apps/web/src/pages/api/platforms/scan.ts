import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { platforms, platformSkills } from '@employment-agent/database/schema';
import { eq } from 'drizzle-orm';
import { API_SOURCES, scanApiSource } from '../../../lib/scan-api-source.js';
import { enqueuePlatformScan, platformScanTaskType } from '../../../lib/platform-onboarding.js';

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

  const mode = typeof obj.mode === 'string' ? obj.mode : 'auto';
  const installed = await db.select({ id: platformSkills.id }).from(platformSkills)
    .where(eq(platformSkills.platformId, platform[0]!.id)).limit(1);
  const useAgent = platformScanTaskType(installed.length > 0, mode === 'agent') === 'BROWSER_AGENT_SCAN';
  if (useAgent) {
    if (!platform[0]!.baseUrl) return json({ error: 'Platform has no URL for browser scanning' }, 400);
    const agentTaskId = await enqueuePlatformScan({ slug, url: platform[0]!.baseUrl }, 'web-ui');
    return json({
      scanned: false,
      source: 'browser-agent',
      slug,
      taskId: agentTaskId,
      message: agentTaskId ? 'Agente LLM encolado. Se conecta a tu Brave (CDP) y busca automáticamente; si aparece un CAPTCHA resolvélalo en la ventana que se abre.' : 'Ya existe un escaneo activo para esta plataforma.',
    });
  }

  const taskId = await enqueuePlatformScan({ slug }, 'web-ui', 'SCAN_PLATFORM');

  return json({
    scanned: false,
    source: 'worker',
    slug,
    taskId,
    message: taskId ? 'Tarea encolada. El worker la procesará en los próximos segundos.' : 'Ya existe un escaneo activo para esta plataforma.',
  });
};
