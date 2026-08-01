import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { llmSettings } from '@employment-agent/database/schema';
import { parseLLMSettingsInput, toLLMSettingsDto, unknownFieldError } from '../../../../lib/llm-settings.js';
import { hasProviderCredential, PROVIDER_ENV } from '@employment-agent/llm';

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const CLOUD_PROVIDERS = new Set(['openai', 'anthropic', 'gemini', 'groq', 'nvidia', 'minimax', 'kimi']);

function resolveProviderBaseUrl(provider: string): string | null {
  const spec = PROVIDER_ENV[provider];
  if (!spec) return null;
  if (spec.baseUrlEnv && process.env[spec.baseUrlEnv]) {
    return process.env[spec.baseUrlEnv]!.trim();
  }
  return spec.defaultBaseUrl ?? null;
}

export const GET: APIRoute = async ({ url }) => {
  const unknownQueryField = Array.from(url.searchParams.keys())
    .find((key) => !['provider', 'model', 'baseUrl'].includes(key));
  if (unknownQueryField) return json({ error: unknownFieldError(unknownQueryField).error }, 400);

  const rows = await db.select().from(llmSettings).limit(1);
  return json(toLLMSettingsDto(rows[0] ?? null, rows[0] ? hasProviderCredential(rows[0].provider) : false));
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

  // For cloud providers, normalize baseUrl to the provider default and reject
  // any user-supplied localhost/mismatched URL to prevent cross-provider calls.
  let finalBaseUrl: string | null = parsed.value.baseUrl;
  if (CLOUD_PROVIDERS.has(parsed.value.provider)) {
    finalBaseUrl = resolveProviderBaseUrl(parsed.value.provider);
    if (parsed.value.baseUrl && parsed.value.baseUrl !== finalBaseUrl) {
      return json({ error: `Base URL for ${parsed.value.provider} must be the provider endpoint (${finalBaseUrl}), not a custom value.` }, 400);
    }
  }

  const updatedAt = new Date().toISOString();
  await db.insert(llmSettings).values({
    id: 1,
    provider: parsed.value.provider,
    model: parsed.value.model,
    baseUrl: finalBaseUrl,
    updatedAt,
  }).onConflictDoUpdate({
    target: llmSettings.id,
    set: { provider: parsed.value.provider, model: parsed.value.model, baseUrl: finalBaseUrl, updatedAt },
  });

  return json(toLLMSettingsDto({ provider: parsed.value.provider, model: parsed.value.model, baseUrl: finalBaseUrl, updatedAt }, hasProviderCredential(parsed.value.provider)));
};
