import type { APIRoute } from 'astro';
import { getActiveAgent } from '../../../lib/agent.js';

export const prerender = false;

export const GET: APIRoute = async () => {
  const { status } = await getActiveAgent();
  return new Response(JSON.stringify(status), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
