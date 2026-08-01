/**
 * Model context windows + compaction thresholds.
 *
 * Numbers come from each provider's published specs. The `compactAt` field
 * is the input-token count at which we should trigger a compaction pass — we
 * leave headroom for the prompt overhead (system prompt, facts, current
 * turn) plus the response.
 *
 * When the registry does not have a model, `resolveModelContext()` returns
 * a conservative default. Callers should treat unknown models as
 * "small-context, compact early" so we never blow past a real limit.
 */

export interface ModelContextSpec {
  /** Total context window in tokens. */
  context: number;
  /** Input token count at which to trigger compaction (leaves room for response). */
  compactAt: number;
  /** Provider key this spec belongs to. */
  provider: string;
}

const MODEL_SPECS: Record<string, ModelContextSpec> = {
  // MiniMax — 1M context with internal compaction at 500K.
  'MiniMax-M3': { provider: 'minimax', context: 1_000_000, compactAt: 500_000 },
  'MiniMax-M2.7': { provider: 'minimax', context: 200_000, compactAt: 150_000 },

  // OpenAI.
  'gpt-4o': { provider: 'openai', context: 128_000, compactAt: 100_000 },
  'gpt-4o-mini': { provider: 'openai', context: 128_000, compactAt: 100_000 },
  'gpt-4-turbo': { provider: 'openai', context: 128_000, compactAt: 100_000 },
  'gpt-3.5-turbo': { provider: 'openai', context: 16_000, compactAt: 12_000 },

  // Anthropic.
  'claude-3-5-sonnet-latest': { provider: 'anthropic', context: 200_000, compactAt: 160_000 },
  'claude-3-5-haiku-latest': { provider: 'anthropic', context: 200_000, compactAt: 160_000 },
  'claude-3-opus-latest': { provider: 'anthropic', context: 200_000, compactAt: 160_000 },

  // Google.
  'gemini-1.5-pro': { provider: 'gemini', context: 2_000_000, compactAt: 1_500_000 },
  'gemini-1.5-flash': { provider: 'gemini', context: 1_000_000, compactAt: 750_000 },
  'gemini-2.0-flash-exp': { provider: 'gemini', context: 1_000_000, compactAt: 750_000 },
};

/** Conservative default for unknown models. */
const FALLBACK_SPEC: ModelContextSpec = { provider: 'unknown', context: 32_000, compactAt: 24_000 };

export function resolveModelContext(provider: string, model: string | null | undefined): ModelContextSpec {
  if (model && MODEL_SPECS[model]) return MODEL_SPECS[model];
  // Match by provider prefix when exact model isn't registered.
  const providerMatch = Object.values(MODEL_SPECS).find((s) => s.provider === provider);
  return providerMatch ?? FALLBACK_SPEC;
}

/**
 * Estimate token count for a piece of text. Spanish and English both hover
 * around 4 chars per token for chat models. This is intentionally rough —
 * we use it to decide when to compact, not for billing.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  // ~4 tokens of overhead per message for role markers.
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}
