import type { LLMProvider } from './types.js';
import { DeterministicStubProvider } from './providers/stub.js';

export interface ConfiguredProviderMetadata {
  provider: string;
  model: string;
  baseUrl: string | null;
}

/**
 * Build from persisted metadata. Provider SDKs and credentials are added in later
 * slices, so every metadata choice currently degrades to the deterministic stub.
 */
export function createConfiguredProvider(
  _config: ConfiguredProviderMetadata | null,
): LLMProvider {
  return new DeterministicStubProvider();
}

/**
 * Create an LLM provider based on the LLM_PROVIDER env var.
 * Only 'stub' is supported in this slice; others throw.
 */
export function createLLMProvider(): LLMProvider {
  const which = process.env.LLM_PROVIDER ?? 'stub';

  switch (which) {
    case 'stub':
      return new DeterministicStubProvider();
    // case 'ollama': return new OllamaProvider();
    // case 'openai': return new OpenAIProvider();
    // case 'anthropic': return new AnthropicProvider();
    default:
      throw new Error(
        `Unknown LLM_PROVIDER: ${which}. Supported in this slice: 'stub'.`
      );
  }
}
