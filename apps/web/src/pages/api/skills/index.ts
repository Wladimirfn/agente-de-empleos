import type { APIRoute } from 'astro';
import { getBrowserEngineInfo, getProductionSkills } from '../../../lib/skills-catalog.js';

export const prerender = false;

/**
 * GET /api/skills
 *
 * Returns the deterministic production skills (mirrored from the worker
 * registry without importing the worker package, which would boot Playwright)
 * and the detected Playwright browser engine. The `example-platform` skill
 * is intentionally excluded: it is a stub and is not registered by the
 * worker boot path.
 */
export const GET: APIRoute = async () => {
  const body = {
    skills: getProductionSkills(),
    browser: getBrowserEngineInfo(),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
