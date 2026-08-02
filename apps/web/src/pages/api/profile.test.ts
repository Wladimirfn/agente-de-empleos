import { beforeEach, describe, expect, it, vi } from 'vitest';

const profileSelectResult: Array<{ id: number }> = [];
const deleteSpy = vi.fn(async () => undefined);

vi.mock('@employment-agent/database', () => ({
  db: {
    select: vi.fn((..._args: unknown[]) => ({
      from: vi.fn(() => ({
        limit: async () => profileSelectResult,
      })),
    })),
    delete: vi.fn(() => ({
      where: deleteSpy,
    })),
  },
}));

vi.mock('@employment-agent/database/schema', () => ({
  candidateProfiles: 'profiles',
  candidateExperiences: 'experiences',
  candidateSkills: 'skills',
}));

const { DELETE, GET } = await import('./profile.js');

const callDelete = () => {
  const request = new Request('http://localhost/api/profile', { method: 'DELETE' });
  return DELETE({ request } as never);
};

const callGet = () => {
  const request = new Request('http://localhost/api/profile');
  return GET({ request } as never);
};

describe('DELETE /api/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileSelectResult.length = 0;
    deleteSpy.mockResolvedValue(undefined);
  });

  it('returns 404 when there is no profile to delete', async () => {
    // profileSelectResult is already empty after beforeEach; no setup needed.
    const response = await callDelete();

    expect(response.status).toBe(404);
    const payload = await response.json() as { ok?: boolean; error: string; code: string };
    expect(payload.error).toMatch(/no hay perfil/i);
    expect(payload.code).toBe('NOT_FOUND');
  });

  it('does not call db.delete when there is no profile', async () => {
    await callDelete();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('returns 200 and deletes the profile when one exists', async () => {
    profileSelectResult.push({ id: 7 });
    const response = await callDelete();

    expect(response.status).toBe(200);
    const payload = await response.json() as { ok: boolean };
    expect(payload.ok).toBe(true);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('GET still works after a successful reset (returns empty state)', async () => {
    profileSelectResult.push({ id: 7 });
    await callDelete();

    profileSelectResult.length = 0; // post-reset: no profile
    const response = await callGet();
    expect(response.status).toBe(200);
    const payload = await response.json() as { status: string; profile: unknown };
    expect(payload.status).toBe('empty');
    expect(payload.profile).toBeNull();
  });
});