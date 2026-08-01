import type { APIRoute } from 'astro';
import { getRecentMessages, DEFAULT_CONVERSATION_ID } from '../../../lib/agent-memory.js';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const GET: APIRoute = async ({ url }) => {
  const conversationId = url.searchParams.get('conversationId') ?? DEFAULT_CONVERSATION_ID;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(200, Number(limitParam) || 50)) : 50;

  const messages = await getRecentMessages(conversationId, limit);
  return json({ messages, conversationId });
};
