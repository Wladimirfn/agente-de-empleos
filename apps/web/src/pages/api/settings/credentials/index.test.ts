import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeSummaries = [
  { slug: 'indeed', hasEmail: true, hasStorageState: false, lastLoginAt: null, lastLoginStatus: 'unknown', consentAt: '2026-01-01', updatedAt: '2026-01-01' },
];

const savedPayloads: Array<{ slug: string; email: string; password: string; consent: boolean }> = [];
const deletedSlugs: string[] = [];

vi.mock('@employment-agent/security', () => ({
  listCredentials: async () => fakeSummaries,
  saveCredential: async (input: { slug: string; email: string; password: string }) => {
    savedPayloads.push({ slug: input.slug, email: input.email, password: input.password, consent: true });
  },
  deleteCredential: async (slug: string) => { deletedSlugs.push(slug); },
}));

const { GET, POST, DELETE } = await import('./index.js');

const callGet = () => GET({ request: new Request('http://localhost/api/settings/credentials'), url: new URL('http://localhost/api/settings/credentials') } as never);
const callPost = (body: unknown) => POST({ request: new Request('http://localhost/api/settings/credentials', { method: 'POST', body: JSON.stringify(body) }) } as never);
const callDelete = (slug: string) => DELETE({ url: new URL(`http://localhost/api/settings/credentials?slug=${slug}`) } as never);

describe('GET /api/settings/credentials', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the credentials list (summaries only, no plaintext)', async () => {
    const response = await callGet();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const payload = await response.json() as { credentials: Array<{ slug: string }> };
    expect(payload.credentials).toHaveLength(1);
    expect(payload.credentials[0]?.slug).toBe('indeed');
  });
});

describe('POST /api/settings/credentials', () => {
  beforeEach(() => { savedPayloads.length = 0; });

  it('saves a credential with explicit consent', async () => {
    const response = await callPost({ slug: 'indeed', email: 'me@example.com', password: 'p', consent: true });
    expect(response.status).toBe(200);
    const payload = await response.json() as { ok: boolean; slug: string };
    expect(payload.ok).toBe(true);
    expect(payload.slug).toBe('indeed');
    expect(savedPayloads).toHaveLength(1);
    expect(savedPayloads[0]?.email).toBe('me@example.com');
  });

  it('rejects without consent: true', async () => {
    const response = await callPost({ slug: 'indeed', email: 'me@example.com', password: 'p', consent: false });
    expect(response.status).toBe(400);
    const payload = await response.json() as { error: string };
    expect(payload.error).toMatch(/consent/i);
    expect(savedPayloads).toHaveLength(0);
  });

  it('rejects when consent is missing', async () => {
    const response = await callPost({ slug: 'indeed', email: 'me@example.com', password: 'p' });
    expect(response.status).toBe(400);
    expect(savedPayloads).toHaveLength(0);
  });

  it('rejects an invalid slug', async () => {
    const response = await callPost({ slug: 'BAD SLUG', email: 'me@example.com', password: 'p', consent: true });
    expect(response.status).toBe(400);
    expect(savedPayloads).toHaveLength(0);
  });

  it('rejects an email without @', async () => {
    const response = await callPost({ slug: 'indeed', email: 'no-at-sign', password: 'p', consent: true });
    expect(response.status).toBe(400);
    expect(savedPayloads).toHaveLength(0);
  });

  it('rejects an empty password', async () => {
    const response = await callPost({ slug: 'indeed', email: 'me@example.com', password: '', consent: true });
    expect(response.status).toBe(400);
    expect(savedPayloads).toHaveLength(0);
  });

  it('rejects malformed JSON', async () => {
    const response = await POST({ request: new Request('http://localhost/api/settings/credentials', { method: 'POST', body: 'not json' }) } as never);
    expect(response.status).toBe(400);
    expect(savedPayloads).toHaveLength(0);
  });
});

describe('DELETE /api/settings/credentials', () => {
  beforeEach(() => { deletedSlugs.length = 0; });

  it('removes a credential by slug', async () => {
    const response = await callDelete('indeed');
    expect(response.status).toBe(200);
    expect(deletedSlugs).toEqual(['indeed']);
  });

  it('rejects an invalid slug', async () => {
    const response = await callDelete('BAD SLUG');
    expect(response.status).toBe(400);
    expect(deletedSlugs).toHaveLength(0);
  });
});
