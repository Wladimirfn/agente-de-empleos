import { afterEach, describe, expect, it, vi } from 'vitest';

const selectMock = vi.fn();

vi.mock('@employment-agent/database', () => ({
  db: { select: () => ({ from: () => ({ limit: selectMock }) }) },
}));
vi.mock('@employment-agent/database/schema', () => ({ llmSettings: {} }));

import { getActiveAgent } from './agent.js';

describe('agent status derivation', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  it('reports none/inactive when nothing is configured', async () => {
    selectMock.mockResolvedValue([]);

    const { status } = await getActiveAgent();

    expect(status).toEqual({ provider: 'stub', model: null, source: 'none', hasKey: false, active: false });
  });

  it('activates the stored provider only when its key exists', async () => {
    selectMock.mockResolvedValue([{ provider: 'openai', model: 'gpt-4o-mini', baseUrl: null }]);
    process.env.OPENAI_API_KEY = 'test-key';

    const { status, provider } = await getActiveAgent();

    expect(status.active).toBe(true);
    expect(status.hasKey).toBe(true);
    expect(status.source).toBe('settings');
    expect(provider.name).toBe('openai');
  });

  it('never claims active when the stored provider lacks credentials', async () => {
    selectMock.mockResolvedValue([{ provider: 'openai', model: 'gpt-4o-mini', baseUrl: null }]);

    const { status, provider } = await getActiveAgent();

    expect(status.active).toBe(false);
    expect(status.hasKey).toBe(false);
    expect(provider.name).toBe('stub');
  });

  it('falls back to env configuration when no settings row exists', async () => {
    selectMock.mockResolvedValue([]);
    process.env.LLM_PROVIDER = 'ollama';

    const { status, provider } = await getActiveAgent();

    expect(status.source).toBe('env');
    expect(status.active).toBe(true);
    expect(provider.name).toBe('ollama');
  });
});
