import { describe, expect, it } from 'vitest';
import { createConfiguredProvider } from '../src/factory.js';

describe('createConfiguredProvider', () => {
  it('returns the deterministic stub when no metadata is configured', () => {
    expect(createConfiguredProvider(null).name).toBe('stub');
  });

  it('falls back deterministically when the configured provider has no credentials', () => {
    const provider = createConfiguredProvider({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: null,
    }, {} as NodeJS.ProcessEnv);

    expect(provider.name).toBe('stub');
  });
});
