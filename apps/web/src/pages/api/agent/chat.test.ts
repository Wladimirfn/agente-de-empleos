import { describe, expect, it, vi } from 'vitest';

// The chat route persists messages and reads profile/memory tables. Mock every
// DB-touching module so running the test suite NEVER writes into the real
// conversation history (it previously polluted chat_messages with the literal
// 'respuesta real' string, which the live model then parroted back to users).
vi.mock('../../../lib/agent.js', () => ({
  getActiveAgent: vi.fn(),
}));
vi.mock('../../../lib/agent-memory.js', () => ({
  appendMessage: vi.fn(async () => ({})),
  applyCompaction: vi.fn(async () => undefined),
  buildContextForLLM: vi.fn(async () => ({ messages: [] })),
  formatFactsForPrompt: vi.fn(() => ''),
  getRecentMessages: vi.fn(async () => []),
  listFacts: vi.fn(async () => []),
  toLLMMessages: vi.fn(() => []),
  DEFAULT_CONVERSATION_ID: 'default',
  MAX_HISTORY_TURNS: 40,
}));
vi.mock('../../../lib/profile-targets.js', () => ({
  createProposal: vi.fn(async () => ({ id: 1 })),
}));
vi.mock('@employment-agent/database', () => ({
  db: {
    select: () => ({
      from: () => ({
        limit: async () => [],
        where: () => ({ orderBy: async () => [] }),
      }),
    }),
  },
}));
vi.mock('@employment-agent/database/schema', () => ({
  candidateProfiles: {},
  candidateExperiences: {},
  candidateSkills: {},
  chatMessages: {},
}));

import { getActiveAgent } from '../../../lib/agent.js';
import { POST } from './chat.js';

const mockedGetActiveAgent = vi.mocked(getActiveAgent);

function callPost(body: unknown) {
  return POST({
    request: new Request('http://localhost/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as never);
}

const inactiveAgent = {
  provider: { name: 'stub', chat: vi.fn() },
  status: { provider: 'stub', model: null, source: 'none' as const, hasKey: false, active: false },
};

describe('POST /api/agent/chat', () => {
  it('rejects invalid JSON with 400', async () => {
    const response = await callPost('not-json{');
    expect(response.status).toBe(400);
  });

  it('rejects a missing message with 400', async () => {
    const response = await callPost({ message: '  ' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringContaining('message') });
  });

  it('returns a structured 503 when no provider is configured', async () => {
    mockedGetActiveAgent.mockResolvedValue(inactiveAgent as never);

    const response = await callPost({ message: 'hola' });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(inactiveAgent.provider.chat).not.toHaveBeenCalled();
  });

  it('returns the provider reply on success', async () => {
    mockedGetActiveAgent.mockResolvedValue({
      provider: { name: 'openai', model: 'gpt-4o-mini', chat: vi.fn().mockResolvedValue('respuesta real') },
      status: { provider: 'openai', model: 'gpt-4o-mini', source: 'settings', hasKey: true, active: true },
    } as never);

    const response = await callPost({ message: 'buscame ofertas' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reply).toBe('respuesta real');
    expect(body.provider).toBe('openai');
    expect(body.model).toBe('gpt-4o-mini');
    // Usage block is always present on success.
    expect(body.usage).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    expect(typeof body.usage.tokens).toBe('number');
    expect(typeof body.usage.contextWindow).toBe('number');
  });

  it('returns a structured 503 without leaking internals when the provider fails', async () => {
    mockedGetActiveAgent.mockResolvedValue({
      provider: { name: 'openai', model: 'm', chat: vi.fn().mockRejectedValue(new Error('sk-secret boom')) },
      status: { provider: 'openai', model: 'm', source: 'env', hasKey: true, active: true },
    } as never);

    const response = await callPost({ message: 'hola' });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe('PROVIDER_REQUEST_FAILED');
    expect(JSON.stringify(body)).not.toContain('sk-secret');
  });
});
