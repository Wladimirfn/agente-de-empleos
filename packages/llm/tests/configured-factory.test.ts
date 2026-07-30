import { describe, expect, it } from 'vitest';
import { createConfiguredProvider } from '../src/factory.js';

describe('createConfiguredProvider', () => {
  it('returns the deterministic stub when no metadata is configured', () => {
    expect(createConfiguredProvider(null).name).toBe('stub');
  });

  it('falls back deterministically until a configured provider implementation exists', () => {
    const provider = createConfiguredProvider({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: null,
    });

    expect(provider.name).toBe('stub');
  });
});
