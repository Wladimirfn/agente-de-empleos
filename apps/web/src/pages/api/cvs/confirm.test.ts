import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stub fs so the file-read step doesn't crash when we hit the happy path.
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(async () => Buffer.from('fake cv bytes')),
  },
}));

const existingDocsSelect = vi.fn(async () => []); // no duplicates
const profilesSelect = vi.fn(async () => [{ id: 1 }]); // existing profile
const insertProfileSpy = vi.fn(async () => [{ id: 1 }]);
const insertDocSpy = vi.fn(async () => [{ id: 99 }]);

// Generic insert builder so callers can chain .values().returning().
const makeInsertBuilder = (returningSpy: () => Promise<unknown[]>) => ({
  values: () => ({
    onConflictDoUpdate: () => undefined,
    returning: returningSpy,
  }),
});

vi.mock('@employment-agent/database', () => {
  const dbMock = {
    select: vi.fn((..._args: unknown[]) => ({
      from: vi.fn((..._args: unknown[]) => ({
        where: vi.fn((..._args: unknown[]) => ({
          limit: async () => existingDocsSelect(),
        })),
        limit: async () => profilesSelect(),
      })),
    })),
    insert: vi.fn((table: unknown) => {
      if (table === 'documents') return makeInsertBuilder(insertDocSpy);
      if (table === 'profiles') return makeInsertBuilder(insertProfileSpy);
      // experiences/skills: code calls .values(...) without awaiting the result.
      return { values: () => undefined };
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
  };
  return { db: dbMock };
});

vi.mock('@employment-agent/database/schema', () => ({
  candidateDocuments: 'documents',
  candidateProfiles: 'profiles',
  candidateExperiences: 'experiences',
  candidateSkills: 'skills',
}));

vi.mock('../../../lib/storage.js', () => ({
  storagePath: () => '/tmp/storage',
}));

const { POST } = await import('./confirm.js');

const callPost = async (body: Record<string, unknown>) => {
  const request = new Request('http://localhost/api/cvs/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST({ request } as never);
};

const validBody = {
  storedFilename: 'abc-123.pdf',
  fullName: 'Eric Flores',
  email: 'eric@example.com',
  phone: '+56 9 1111 2222',
  location: 'Puerto Montt',
  summary: 'Some summary text here.',
};

describe('POST /api/cvs/confirm fullName validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-prime the spies after clearAllMocks wipes them.
    existingDocsSelect.mockResolvedValue([]);
    profilesSelect.mockResolvedValue([{ id: 1 }]);
    insertProfileSpy.mockResolvedValue([{ id: 1 }]);
    insertDocSpy.mockResolvedValue([{ id: 99 }]);
  });

  it('rejects an empty fullName with 400', async () => {
    const response = await callPost({ ...validBody, fullName: '' });

    expect(response.status).toBe(400);
    const payload = await response.json() as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/fullName.*requerido/i);
  });

  it('rejects a whitespace-only fullName with 400', async () => {
    const response = await callPost({ ...validBody, fullName: '   ' });

    expect(response.status).toBe(400);
    const payload = await response.json() as { ok: boolean; error: string };
    expect(payload.error).toMatch(/fullName.*requerido/i);
  });

  it('rejects a non-string fullName with 400', async () => {
    const response = await callPost({ ...validBody, fullName: 42 });

    expect(response.status).toBe(400);
    const payload = await response.json() as { ok: boolean; error: string };
    expect(payload.error).toMatch(/fullName.*requerido/i);
  });

  it('accepts a valid fullName and overwrites the stored one (no mashup)', async () => {
    // The existing profile already has full_name = 'Eric Flores' (stale).
    // When the user uploads a CV for Estefanía and types her name, the
    // server must overwrite, not preserve.
    profilesSelect.mockResolvedValue([{ id: 1 }]);
    const response = await callPost({ ...validBody, fullName: 'Estefanía Montecinos' });

    expect(response.status).toBe(201);
    const { db } = await import('@employment-agent/database');
    const updateCalls = (db.update as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(updateCalls.length).toBeGreaterThan(0);
  });
});