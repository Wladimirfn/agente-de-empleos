export interface ProviderEnvSpec {
  keyEnv?: string;
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
  defaultModel: string;
}

export const PROVIDER_ENV: Record<string, ProviderEnvSpec> = {
  openai: { keyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini' },
  groq: { keyEnv: 'GROQ_API_KEY', defaultBaseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  nvidia: { keyEnv: 'NVIDIA_API_KEY', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: 'meta/llama-3.1-70b-instruct' },
  minimax: { keyEnv: 'MINIMAX_API_KEY', defaultBaseUrl: 'https://api.minimax.io/v1', defaultModel: 'MiniMax-M2' },
  kimi: { keyEnv: 'KIMI_API_KEY', defaultBaseUrl: 'https://api.moonshot.ai/v1', defaultModel: 'kimi-k2' },
  anthropic: { keyEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-5' },
  gemini: { keyEnv: 'GEMINI_API_KEY', defaultModel: 'gemini-2.5-flash' },
  ollama: { baseUrlEnv: 'OLLAMA_BASE_URL', defaultBaseUrl: 'http://localhost:11434/v1', defaultModel: 'llama3.2' },
  llamacpp: { baseUrlEnv: 'LLAMACPP_BASE_URL', defaultBaseUrl: 'http://localhost:8080/v1', defaultModel: 'local-model' },
};

export const OPENAI_COMPATIBLE_PROVIDERS = ['openai', 'groq', 'nvidia', 'minimax', 'kimi', 'ollama', 'llamacpp'] as const;

export function hasProviderCredential(provider: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const spec = PROVIDER_ENV[provider];
  if (!spec) return false;
  if (spec.keyEnv) {
    const value = env[spec.keyEnv];
    return typeof value === 'string' && value.trim() !== '';
  }
  if (spec.baseUrlEnv) return true;
  return false;
}
