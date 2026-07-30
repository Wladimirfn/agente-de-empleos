import type { APIRoute } from 'astro';
import { parseLLMSettingsInput, unsupportedConnectionTest } from '../../../../lib/llm-settings.js';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = parseLLMSettingsInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  return Response.json(unsupportedConnectionTest(parsed.value.model), { status: 501 });
};
