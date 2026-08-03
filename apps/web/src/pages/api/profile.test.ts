import { beforeEach, describe, expect, it, vi } from 'vitest';

const profileSelectResult: Array<{ id: number }> = [];
const deleteCalls: Array<{ table: string; whereArgs?: unknown }> = [];

vi.mock('@employment-agent/database', () => {
  // The transaction callback runs with a `tx` object whose API mirrors `db`.
  // We capture every .delete() call (with or without .where()) in
  // deleteCalls so tests can assert which tables were cleaned.
  const tx = {
    delete: vi.fn((table: unknown) => {
      const chain = {
        where: (args?: unknown) => {
          deleteCalls.push({ table: String(table), whereArgs: args });
          return Promise.resolve(undefined);
        },
      };
      // Eagerly record the call even if .where() is never chained, so
      // tests can see bare .delete(jobs) / .delete(platforms) too.
      deleteCalls.push({ table: String(table) });
      return chain;
    }),
  };
  return {
    db: {
      select: vi.fn((..._args: unknown[]) => ({
        from: vi.fn(() => ({
          limit: async () => profileSelectResult,
        })),
      })),
      transaction: vi.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => {
        await callback(tx);
      }),
      // db.delete is unused now (we only delete inside the transaction)
      delete: vi.fn(),
    },
  };
});

vi.mock('@employment-agent/database/schema', () => ({
  candidateProfiles: 'profiles',
  candidateExperiences: 'experiences',
  candidateSkills: 'skills',
  candidateDocuments: 'documents',
  candidateTargetRoles: 'target_roles',
  profileProposals: 'proposals',
  chatMessages: 'chat_messages',
  chatMemoryFacts: 'chat_memory_facts',
  chatSummaries: 'chat_summaries',
  matchFeedback: 'match_feedback',
  jobMatches: 'job_matches',
  applications: 'applications',
  jobs: 'jobs',
  platforms: 'platforms',
  agentRuns: 'agent_runs',
  agentConfirmations: 'agent_confirmations',
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
    deleteCalls.length = 0;
  });

  it('returns 404 when there is no profile to delete', async () => {
    const response = await callDelete();

    expect(response.status).toBe(404);
    const payload = await response.json() as { ok?: boolean; error: string; code: string };
    expect(payload.error).toMatch(/no hay perfil/i);
    expect(payload.code).toBe('NOT_FOUND');
  });

  it('does not run the transaction when there is no profile', async () => {
    const { db } = await import('@employment-agent/database');
    await callDelete();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(deleteCalls).toHaveLength(0);
  });

  it('returns 200 when a profile exists and clears every related table', async () => {
    profileSelectResult.push({ id: 7 });
    const response = await callDelete();

    expect(response.status).toBe(200);
    const payload = await response.json() as { ok: boolean };
    expect(payload.ok).toBe(true);
  });

  it('clears profile-scoped child tables (cascade drift-safe)', async () => {
    profileSelectResult.push({ id: 7 });
    await callDelete();
    const clearedTables = deleteCalls.map((c) => c.table);
    expect(clearedTables).toContain('chat_summaries');
    expect(clearedTables).toContain('chat_memory_facts');
    expect(clearedTables).toContain('chat_messages');
    expect(clearedTables).toContain('proposals');
    expect(clearedTables).toContain('agent_confirmations');
    expect(clearedTables).toContain('target_roles');
    expect(clearedTables).toContain('documents');
    expect(clearedTables).toContain('skills');
    expect(clearedTables).toContain('experiences');
    expect(clearedTables).toContain('profiles');
  });

  it('clears match-related tables that have FK drift in the underlying migration', async () => {
    profileSelectResult.push({ id: 7 });
    await callDelete();
    const clearedTables = deleteCalls.map((c) => c.table);
    expect(clearedTables).toContain('match_feedback');
    expect(clearedTables).toContain('job_matches');
    expect(clearedTables).toContain('applications');
  });

  it('clears global caches (jobs, platforms, agent_runs) so the system really starts at 0', async () => {
    profileSelectResult.push({ id: 7 });
    await callDelete();
    const clearedTables = deleteCalls.map((c) => c.table);
    expect(clearedTables).toContain('jobs');
    expect(clearedTables).toContain('platforms');
    expect(clearedTables).toContain('agent_runs');
  });

  it('does not touch llm_settings or scan_settings (device-level config preserved)', async () => {
    profileSelectResult.push({ id: 7 });
    await callDelete();
    const clearedTables = deleteCalls.map((c) => c.table);
    expect(clearedTables).not.toContain('llm_settings');
    expect(clearedTables).not.toContain('scan_settings');
  });

  it('GET still works after a successful reset (returns the empty state)', async () => {
    profileSelectResult.push({ id: 7 });
    await callDelete();

    profileSelectResult.length = 0;
    const response = await callGet();
    expect(response.status).toBe(200);
    const payload = await response.json() as { status: string; profile: unknown };
    expect(payload.status).toBe('empty');
    expect(payload.profile).toBeNull();
  });
});
