import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { llmSettings } from '@employment-agent/database/schema';
import { parseLLMSettingsInput, toLLMSettingsDto, unknownFieldError } from '../../../../lib/llm-settings.js';

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const GET: APIRoute = async ({ url }) => {
  const unknownQueryField = Array.from(url.searchParams.keys())
    .find((key) => !['provider', 'model', 'baseUrl'].includes(key));
  if (unknownQueryField) return json({ error: unknownFieldError(unknownQueryField).error }, 400);

  const rows = await db.select().from(llmSettings).limit(1);
  return json(toLLMSettingsDto(rows[0] ?? null));
};


export const PUT: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = parseLLMSettingsInput(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const updatedAt = new Date().toISOString();
  await db.insert(llmSettings).values({
    id: 1,
    ...parsed.value,
    updatedAt,
  }).onConflictDoUpdate({
    target: llmSettings.id,
    set: { ...parsed.value, updatedAt },
  });

  return json(toLLMSettingsDto({ ...parsed.value, updatedAt }));
};
