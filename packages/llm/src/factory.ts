import type { LLMProvider } from './types.js';
import { DeterministicStubProvider } from './providers/stub.js';
import { OpenAICompatibleProvider } from './providers/openai-compatible.js';
import { GeminiProvider } from './providers/gemini.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OPENAI_COMPATIBLE_PROVIDERS, PROVIDER_ENV } from './provider-env.js';

export interface ConfiguredProviderMetadata {
  provider: string;
  model: string;
  baseUrl: string | null;
}

function buildProvider(
  which: string,
  model: string,
  baseUrl: string | null,
  env: NodeJS.ProcessEnv,
): LLMProvider | null {
  const spec = PROVIDER_ENV[which];
  if (!spec) return null;
  const resolvedModel = model || spec.defaultModel;

  if ((OPENAI_COMPATIBLE_PROVIDERS as readonly string[]).includes(which)) {
    const apiKey = spec.keyEnv ? env[spec.keyEnv]?.trim() : 'not-needed';
    if (!apiKey) return null;
    const resolvedBaseUrl = baseUrl ?? (spec.baseUrlEnv ? env[spec.baseUrlEnv]?.trim() : undefined) ?? spec.defaultBaseUrl;
    return new OpenAICompatibleProvider({
      name: which,
      model: resolvedModel,
      apiKey,
      baseURL: resolvedBaseUrl || undefined,
    });
  }
  if (which === 'gemini') {
    const apiKey = env.GEMINI_API_KEY?.trim();
    return apiKey ? new GeminiProvider(apiKey, resolvedModel) : null;
  }
  if (which === 'anthropic') {
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    return apiKey ? new AnthropicProvider(apiKey, resolvedModel) : null;
  }
  return null;
}

/**
 * Build from persisted metadata. Falls back to the deterministic stub when the
 * provider is unknown or its credentials/config are missing, and never claims
 * a provider is active without successful configuration.
 */
export function createConfiguredProvider(
  config: ConfiguredProviderMetadata | null,
  env: NodeJS.ProcessEnv = process.env,
): LLMProvider {
  if (!config || config.provider === 'stub') return new DeterministicStubProvider();
  return buildProvider(config.provider, config.model, config.baseUrl, env) ?? new DeterministicStubProvider();
}

/**
 * Create an LLM provider from LLM_PROVIDER / LLM_MODEL env vars.
 * Falls back to the deterministic stub when the selected provider cannot be
 * configured; throws only on an unknown provider name.
 */
export function createLLMProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const which = env.LLM_PROVIDER ?? 'stub';
  if (which === 'stub') return new DeterministicStubProvider();
  if (!PROVIDER_ENV[which]) {
    throw new Error(`Unknown LLM_PROVIDER: ${which}. Supported: stub, ${Object.keys(PROVIDER_ENV).join(', ')}.`);
  }
  return buildProvider(which, env.LLM_MODEL?.trim() ?? '', null, env) ?? new DeterministicStubProvider();
}
