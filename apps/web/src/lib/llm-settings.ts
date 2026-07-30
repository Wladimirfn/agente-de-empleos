export const SUPPORTED_LLM_PROVIDERS = [
  'openai',
  'anthropic',
  'gemini',
  'ollama',
  'minimax',
  'kimi',
  'llamacpp',
  'stub',
] as const;

export type LLMProviderName = typeof SUPPORTED_LLM_PROVIDERS[number];

export interface LLMSettingsInput {
  provider: LLMProviderName;
  model: string;
  baseUrl: string | null;
}

interface StoredSettings {
  provider: string;
  model: string;
  baseUrl: string | null;
  updatedAt: string;
}

type ParseResult =
  | { ok: true; value: LLMSettingsInput }
  | { ok: false; error: string };

const allowedFields = new Set(['provider', 'model', 'baseUrl']);

export function unknownFieldError(field: string) {
  return { ok: false as const, error: `Unknown field: ${field}` };
}

export function parseLLMSettingsInput(input: unknown): ParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Expected a settings object' };
  }

  const record = input as Record<string, unknown>;
  const unknownField = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unknownField) return unknownFieldError(unknownField);
  if (!SUPPORTED_LLM_PROVIDERS.includes(record.provider as LLMProviderName)) {
    return { ok: false, error: 'Unsupported provider' };
  }
  if (typeof record.model !== 'string' || record.model.trim() === '') {
    return { ok: false, error: 'Model is required' };
  }
  if (record.baseUrl !== undefined && typeof record.baseUrl !== 'string') {
    return { ok: false, error: 'Base URL must be a string' };
  }

  return {
    ok: true,
    value: {
      provider: record.provider as LLMProviderName,
      model: record.model.trim(),
      baseUrl: typeof record.baseUrl === 'string' && record.baseUrl.trim() !== ''
        ? record.baseUrl.trim()
        : null,
    },
  };
}

export function toLLMSettingsDto(row: StoredSettings | null) {
  if (!row) return { status: 'not-configured' as const, settings: null };
  return {
    status: 'configured' as const,
    settings: {
      provider: row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      updatedAt: row.updatedAt,
    },
  };
}

export function unsupportedConnectionTest(model: string) {
  return {
    ok: false as const,
    error: 'Connection testing is unavailable until provider support is installed',
    code: 'CONNECTION_REFUSED' as const,
    model,
  };
}
