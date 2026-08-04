import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionStore = new Map<string, { id: string; slug: string; status: string; expiresAt: string; userCompletedAt: string | null; readyAt: string | null; error: string | null; createdAt: string }>();
const activeSessionById = new Map<string, string>(); // maps slug -> active session id
const enqueuedTasks: Array<{ type: string; payload: unknown }> = [];
const userCompletedLog: string[] = [];

vi.mock('@employment-agent/database', () => ({
  db: {
    select: (..._args: unknown[]) => ({
      from: (_table: unknown) => ({
        where: (..._args: unknown[]) => {
          const items = Array.from(activeSessionById.values())
            .map((id) => sessionStore.get(id))
            .filter((s): s is NonNullable<typeof s> => Boolean(s))
            .map((s) => ({ id: s.id }));
          return Promise.resolve(items);
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (record: { type: string; payloadJson: string }) => {
        enqueuedTasks.push({ type: record.type, payload: JSON.parse(record.payloadJson) });
        return Promise.resolve(undefined);
      },
    }),
  },
  sessionCaptures: { __table: 'session_captures' },
  taskQueue: { __table: 'task_queue' },
}));

// Mock the security package (session DB ops).
vi.mock('@employment-agent/security', () => ({
  createSessionCapture: async (slug: string) => {
    const id = `s-${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const session = { id, slug, status: 'pending', expiresAt, userCompletedAt: null, readyAt: null, error: null, createdAt: new Date().toISOString() };
    sessionStore.set(id, session);
    activeSessionById.set(slug, id);
    return session;
  },
  getSessionCapture: async (id: string) => sessionStore.get(id) ?? null,
  setSessionReady: async (id: string) => {
    const s = sessionStore.get(id);
    if (s) sessionStore.set(id, { ...s, status: 'ready', readyAt: new Date().toISOString() });
  },
  setSessionUserCompleted: async (id: string) => {
    const s = sessionStore.get(id);
    if (s) {
      sessionStore.set(id, { ...s, userCompletedAt: new Date().toISOString() });
      userCompletedLog.push(id);
    }
  },
  setSessionCompleted: async (id: string) => {
    const s = sessionStore.get(id);
    if (s) sessionStore.set(id, { ...s, status: 'completed' });
  },
  setSessionFailed: async (id: string, error: string) => {
    const s = sessionStore.get(id);
    if (s) sessionStore.set(id, { ...s, status: 'failed', error });
  },
  SESSION_TTL_MS: 5 * 60_000,
}));

vi.mock('../../../../../../worker/src/session-capture.js', () => ({
  createSessionCapture: async (slug: string) => {
    const id = `s-${Math.random().toString(36).slice(2, 10)}`;
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const session = { id, slug, status: 'pending', expiresAt, userCompletedAt: null, readyAt: null, error: null, createdAt: new Date().toISOString() };
    sessionStore.set(id, session);
    return session;
  },
  getSessionCapture: async (id: string) => sessionStore.get(id) ?? null,
  setSessionReady: async (id: string) => {
    const s = sessionStore.get(id);
    if (s) sessionStore.set(id, { ...s, status: 'ready', readyAt: new Date().toISOString() });
  },
  setSessionUserCompleted: async (id: string) => {
    const s = sessionStore.get(id);
    if (s) {
      sessionStore.set(id, { ...s, userCompletedAt: new Date().toISOString() });
      userCompletedLog.push(id);
    }
  },
  setSessionCompleted: async (id: string) => {
    const s = sessionStore.get(id);
    if (s) sessionStore.set(id, { ...s, status: 'completed' });
  },
  setSessionFailed: async (id: string, error: string) => {
    const s = sessionStore.get(id);
    if (s) sessionStore.set(id, { ...s, status: 'failed', error });
  },
  SESSION_TTL_MS: 5 * 60_000,
}));

vi.mock('../../../../../../worker/src/task-queue.js', () => ({
  enqueueTask: async (task: { type: string; payload: unknown }) => {
    enqueuedTasks.push(task);
    return 'task-id';
  },
}));

const { POST, GET } = await import('./index.js');
const { POST: completePost } = await import('./[id]/complete.js');

const callStart = (slug: string) => POST({
  request: new Request('http://localhost/api/settings/credentials/session', { method: 'POST', body: JSON.stringify({ slug }) }),
} as never);

const callStatus = (id: string) => GET({
  url: new URL(`http://localhost/api/settings/credentials/session?id=${id}`),
  request: new Request(`http://localhost/api/settings/credentials/session?id=${id}`),
} as never);

const callComplete = (id: string) => completePost({
  params: { id },
  request: new Request(`http://localhost/api/settings/credentials/session/${id}/complete`, { method: 'POST' }),
} as never);

describe('POST /api/settings/credentials/session', () => {
  beforeEach(() => {
    sessionStore.clear();
    activeSessionById.clear();
    enqueuedTasks.length = 0;
    userCompletedLog.length = 0;
  });

  it('enqueues a CAPTURE_SESSION task and returns the session id', async () => {
    const response = await callStart('indeed');
    expect(response.status).toBe(200);
    const payload = await response.json() as { sessionId: string; ttlMs: number };
    expect(payload.sessionId).toMatch(/^s-/);
    expect(payload.ttlMs).toBe(5 * 60_000);
    expect(enqueuedTasks).toHaveLength(1);
    expect(enqueuedTasks[0]?.type).toBe('CAPTURE_SESSION');
    expect((enqueuedTasks[0]?.payload as { slug: string }).slug).toBe('indeed');
  });

  it('rejects an invalid slug', async () => {
    const response = await POST({
      request: new Request('http://localhost/api/settings/credentials/session', { method: 'POST', body: JSON.stringify({ slug: 'BAD SLUG' }) }),
    } as never);
    expect(response.status).toBe(400);
    expect(enqueuedTasks).toHaveLength(0);
  });

  it('rejects an unsupported platform', async () => {
    const response = await POST({
      request: new Request('http://localhost/api/settings/credentials/session', { method: 'POST', body: JSON.stringify({ slug: 'stripe' }) }),
    } as never);
    expect(response.status).toBe(400);
    expect(enqueuedTasks).toHaveLength(0);
  });

  it('rejects a second active session for the same platform', async () => {
    await callStart('indeed');
    const response = await callStart('indeed');
    expect(response.status).toBe(409);
    expect(enqueuedTasks).toHaveLength(1);
  });
});

describe('GET /api/settings/credentials/session', () => {
  beforeEach(() => {
    sessionStore.clear();
    activeSessionById.clear();
    enqueuedTasks.length = 0;
  });

  it('returns the current session status', async () => {
    const start = await callStart('indeed');
    const { sessionId } = await start.json() as { sessionId: string };
    const response = await callStatus(sessionId);
    expect(response.status).toBe(200);
    const payload = await response.json() as { session: { id: string; status: string } };
    expect(payload.session.id).toBe(sessionId);
    expect(payload.session.status).toBe('pending');
  });

  it('returns 404 for unknown session ids', async () => {
    const response = await callStatus('does-not-exist');
    expect(response.status).toBe(404);
  });
});

describe('POST /api/settings/credentials/session/:id/complete', () => {
  beforeEach(() => {
    sessionStore.clear();
    activeSessionById.clear();
    enqueuedTasks.length = 0;
    userCompletedLog.length = 0;
  });

  it('signals the worker that the user is done', async () => {
    const start = await callStart('indeed');
    const { sessionId } = await start.json() as { sessionId: string };
    const response = await callComplete(sessionId);
    expect(response.status).toBe(200);
    expect(userCompletedLog).toEqual([sessionId]);
  });
});
