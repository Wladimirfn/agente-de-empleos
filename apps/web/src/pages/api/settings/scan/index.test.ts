import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectLimit = vi.fn(async () => [] as unknown[]);
const insertValues = vi.fn();

vi.mock('@employment-agent/database', () => ({
  db: {
    select: () => ({ from: () => ({ limit: selectLimit }) }),
    insert: () => ({ values: insertValues }),
  },
}));
vi.mock('@employment-agent/database/schema', () => ({ scanSettings: { id: 'id' } }));

import { GET, PUT } from './index.js';

const callGet = (query = '') => {
  const url = new URL(`http://localhost/api/settings/scan${query}`);
  return GET({ request: new Request(url.toString()), url } as never);
};

const callPut = (body: unknown) => {
  const url = new URL('http://localhost/api/settings/scan');
  return PUT({
    request: new Request(url.toString(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never);
};

describe('GET /api/settings/scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([]);
  });

  it('returns defaults when no row is stored', async () => {
    const response = await callGet();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      intervalMinutes: 30,
      autoScanEnabled: true,
      updatedAt: null,
    });
  });

  it('rejects unknown query fields', async () => {
    const response = await callGet('?cronExpr=*');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unknown field: cronExpr' });
  });
});

describe('PUT /api/settings/scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValues.mockReturnValue({ onConflictDoUpdate: vi.fn(async () => undefined) });
  });

  it('persists a valid interval and returns the stored dto', async () => {
    const response = await callPut({ intervalMinutes: 120, autoScanEnabled: false });

    expect(response.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      id: 1,
      scanIntervalMinutes: 120,
      autoScanEnabled: 0,
    }));
    const body = await response.json();
    expect(body).toMatchObject({ intervalMinutes: 120, autoScanEnabled: false });
  });

  it('rejects an out-of-range interval', async () => {
    const response = await callPut({ intervalMinutes: 1 });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Interval must be an integer between 5 and 10080 minutes',
    });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('rejects unknown fields instead of ignoring them', async () => {
    const response = await callPut({ intervalMinutes: 30, scanCron: '*/5 * * * *' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unknown field: scanCron' });
    expect(insertValues).not.toHaveBeenCalled();
  });
});
