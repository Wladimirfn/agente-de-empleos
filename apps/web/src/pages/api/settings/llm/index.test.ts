import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@employment-agent/database', () => ({
  db: {
    select: () => ({
      from: () => ({ limit: async () => [] }),
    }),
  },
}));
vi.mock('@employment-agent/database/schema', () => ({ llmSettings: {} }));

import { GET } from './index.js';

const callGet = (query = '') => {
  const url = new URL(`http://localhost/api/settings/llm${query}`);
  return GET({ request: new Request(url.toString()), url } as never);
};

describe('GET /api/settings/llm query validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 for a query-free GET', async () => {
    const response = await callGet();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'not-configured', settings: null });
  });

  it.each(['?apiKey=secret', '?unexpected=value'])('rejects unknown query fields: %s', async (query) => {
    const response = await callGet(query);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/^Unknown field: /) });
  });
});
