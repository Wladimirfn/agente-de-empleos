import { describe, expect, it } from 'vitest';
import { createConfiguredProvider, createLLMProvider } from '../src/factory.js';
import { hasProviderCredential } from '../src/provider-env.js';

describe('pilot provider selection', () => {
  it('builds an OpenAI-compatible provider when the key exists', () => {
    const provider = createConfiguredProvider(
      { provider: 'openai', model: 'gpt-4o-mini', baseUrl: null },
      { OPENAI_API_KEY: 'test-key' } as NodeJS.ProcessEnv,
    );

    expect(provider.name).toBe('openai');
    expect(provider.model).toBe('gpt-4o-mini');
  });

  it('falls back to the stub when the key is missing', () => {
    const provider = createConfiguredProvider(
      { provider: 'openai', model: 'gpt-4o-mini', baseUrl: null },
      {} as NodeJS.ProcessEnv,
    );

    expect(provider.name).toBe('stub');
  });

  it('builds groq with its default base URL and model fallback', () => {
    const provider = createConfiguredProvider(
      { provider: 'groq', model: '', baseUrl: null },
      { GROQ_API_KEY: 'test-key' } as NodeJS.ProcessEnv,
    );

    expect(provider.name).toBe('groq');
    expect(provider.model).toBe('llama-3.3-70b-versatile');
  });

  it('builds ollama without an API key using the local base URL', () => {
    const provider = createConfiguredProvider(
      { provider: 'ollama', model: 'llama3.2', baseUrl: null },
      {} as NodeJS.ProcessEnv,
    );

    expect(provider.name).toBe('ollama');
  });

  it('builds gemini and anthropic only with their keys', () => {
    expect(createConfiguredProvider({ provider: 'gemini', model: 'gemini-2.5-flash', baseUrl: null },
      { GEMINI_API_KEY: 'k' } as NodeJS.ProcessEnv).name).toBe('gemini');
    expect(createConfiguredProvider({ provider: 'anthropic', model: 'claude-sonnet-4-5', baseUrl: null },
      { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv).name).toBe('anthropic');
    expect(createConfiguredProvider({ provider: 'gemini', model: 'm', baseUrl: null },
      {} as NodeJS.ProcessEnv).name).toBe('stub');
  });

  it('createLLMProvider falls back to stub when the env provider lacks credentials', () => {
    const provider = createLLMProvider({ LLM_PROVIDER: 'groq' } as NodeJS.ProcessEnv);

    expect(provider.name).toBe('stub');
  });

  it('createLLMProvider honors LLM_MODEL', () => {
    const provider = createLLMProvider({
      LLM_PROVIDER: 'kimi',
      KIMI_API_KEY: 'k',
      LLM_MODEL: 'kimi-for-coding',
    } as NodeJS.ProcessEnv);

    expect(provider.name).toBe('kimi');
    expect(provider.model).toBe('kimi-for-coding');
  });

  it('createLLMProvider still throws on unknown provider names', () => {
    expect(() => createLLMProvider({ LLM_PROVIDER: 'nope' } as NodeJS.ProcessEnv)).toThrow(/Unknown LLM_PROVIDER/);
  });
});

describe('hasProviderCredential', () => {
  it('is true only when the provider key env var is non-empty', () => {
    expect(hasProviderCredential('openai', { OPENAI_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(true);
    expect(hasProviderCredential('openai', { OPENAI_API_KEY: '  ' } as NodeJS.ProcessEnv)).toBe(false);
    expect(hasProviderCredential('openai', {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('treats local base-URL providers as credential-free', () => {
    expect(hasProviderCredential('ollama', {} as NodeJS.ProcessEnv)).toBe(true);
    expect(hasProviderCredential('llamacpp', {} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('is false for unknown providers and stub', () => {
    expect(hasProviderCredential('stub', {} as NodeJS.ProcessEnv)).toBe(false);
    expect(hasProviderCredential('nope', {} as NodeJS.ProcessEnv)).toBe(false);
  });
});
