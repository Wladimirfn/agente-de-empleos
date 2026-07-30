import type { LLMProvider } from './types.js';
import { DeterministicStubProvider } from './providers/stub.js';

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
