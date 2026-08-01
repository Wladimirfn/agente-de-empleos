import type { APIRoute } from 'astro';
import { PROVIDER_ENV, OPENAI_COMPATIBLE_PROVIDERS } from '@employment-agent/llm';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

interface DiscoveredModel {
  id: string;
}

const cache = new Map<string, { at: number; models: DiscoveredModel[] }>();
const CACHE_TTL_MS = 60_000;

function resolveProviderBaseUrl(provider: string): string | null {
  const spec = PROVIDER_ENV[provider];
  if (!spec) return null;
  if (spec.baseUrlEnv && process.env[spec.baseUrlEnv]) {
    return process.env[spec.baseUrlEnv]!.trim();
  }
  return spec.defaultBaseUrl ?? null;
}

function resolveApiKey(provider: string): string | null {
  const spec = PROVIDER_ENV[provider];
  if (!spec?.keyEnv) return null;
  const value = process.env[spec.keyEnv];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

async function discoverOpenAICompatible(baseUrl: string, apiKey: string | null): Promise<DiscoveredModel[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  if (!Array.isArray(data.data)) return [];
  return data.data.map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * GET /api/settings/llm/models?provider=<name>
 * Returns available model IDs for a provider using live discovery for
 * OpenAI-compatible endpoints. Never leaks API keys.
 */
export const GET: APIRoute = async ({ url }) => {
  const provider = url.searchParams.get('provider');
  if (!provider) return json({ error: 'Missing provider' }, 400);

  const spec = PROVIDER_ENV[provider];
  if (!spec) return json({ error: 'Unsupported provider' }, 400);

  // Stub and providers without an endpoint return the default model only.
  if (provider === 'stub') {
    return json({ provider, models: [{ id: 'stub' }], source: 'static' });
  }

  const isOpenAICompatible = (OPENAI_COMPATIBLE_PROVIDERS as readonly string[]).includes(provider);
  if (!isOpenAICompatible) {
    // Anthropic and Gemini don't expose a public /models list cheaply.
    return json({ provider, models: [{ id: spec.defaultModel }], source: 'static-default' });
  }

  const baseUrl = resolveProviderBaseUrl(provider);
  if (!baseUrl) return json({ provider, models: [], source: 'error', error: 'No base URL' }, 200);

  const cached = cache.get(provider);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return json({ provider, models: cached.models, source: 'cached' });
  }

  const apiKey = resolveApiKey(provider);
  try {
    const models = await discoverOpenAICompatible(baseUrl, apiKey);
    cache.set(provider, { at: Date.now(), models });
    return json({ provider, models, source: 'live' });
  } catch (err) {
    return json({
      provider,
      models: [{ id: spec.defaultModel }],
      source: 'fallback-default',
      error: err instanceof Error ? err.message : String(err),
    }, 200);
  }
};
