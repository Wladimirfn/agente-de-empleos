import { describe, expect, it } from 'vitest';
import {
  parseLLMSettingsInput,
  toLLMSettingsDto,
  unsupportedConnectionTest,
} from './llm-settings.js';

describe('LLM settings DTOs', () => {
  it('accepts supported metadata and normalizes an empty base URL', () => {
    expect(parseLLMSettingsInput({ provider: 'openai', model: 'gpt-4o-mini', baseUrl: '' })).toEqual({
      ok: true,
      value: { provider: 'openai', model: 'gpt-4o-mini', baseUrl: null },
    });
  });

  it('rejects unsupported providers without producing a value', () => {
    expect(parseLLMSettingsInput({ provider: 'other', model: 'x' })).toEqual({
      ok: false,
      error: 'Unsupported provider',
    });
  });

  it('rejects raw credential fields instead of ignoring them', () => {
    const secret = ['raw', 'secret', 'value'].join('-');
    const result = parseLLMSettingsInput({ provider: 'openai', model: 'gpt-4o-mini', apiKey: secret });

    expect(result).toEqual({ ok: false, error: 'Unknown field: apiKey' });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('reports missing configuration honestly', () => {
    expect(toLLMSettingsDto(null)).toEqual({ status: 'not-configured', settings: null });
  });

  it('maps stored metadata without exposing internal credential targets', () => {
    expect(toLLMSettingsDto({
      provider: 'ollama',
      model: 'llama3.2',
      baseUrl: 'http://localhost:11434/v1',
      updatedAt: '2026-07-30 12:00:00',
    })).toEqual({
      status: 'configured',
      settings: {
        provider: 'ollama',
        model: 'llama3.2',
        baseUrl: 'http://localhost:11434/v1',
        updatedAt: '2026-07-30 12:00:00',
        hasKey: false,
      },
    });
  });

  it('reports credential detection as a boolean without exposing the key', () => {
    const dto = toLLMSettingsDto({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: null,
      updatedAt: '2026-07-30 12:00:00',
    }, true);

    expect(dto.settings?.hasKey).toBe(true);
    expect(JSON.stringify(dto)).not.toContain('sk-');
  });

  it('returns a structured, secret-free unsupported connection result', () => {
    const result = unsupportedConnectionTest('gpt-4o-mini');

    expect(result).toEqual({
      ok: false,
      error: 'Connection testing is unavailable until provider support is installed',
      code: 'CONNECTION_REFUSED',
      model: 'gpt-4o-mini',
    });
    expect(JSON.stringify(result)).not.toContain('apiKey');
  });
});
