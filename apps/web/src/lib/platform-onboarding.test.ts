import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'ea-platform-')), 'platform.db');
const { db, runMigrations, closeDb } = await import('@employment-agent/database');
const { platforms, taskQueue } = await import('@employment-agent/database/schema');
const {
  approvedOriginsFromMessage,
  isPublicAddress,
  onboardPlatform,
  pinnedRequest,
  platformScanTaskType,
  validateAndProbePlatform,
} = await import('./platform-onboarding.js');
const deps = {
  resolve: async (host: string) => [{ address: /^\d/.test(host) || host.includes(':') ? host : '93.184.216.34', family: host.includes(':') ? 6 : 4 }],
  request: async () => ({ status: 200 }),
};
it.each([
  ['192.88.99.1', false], ['100::1', false], ['64:ff9b:1::1', false], ['2001::1', false],
  ['0.0.0.0', false], ['100.64.0.1', false], ['198.18.0.1', false], ['224.0.0.1', false],
  ['::1', false], ['::ffff:127.0.0.1', false], ['64:ff9b::c000:201', false], ['2002:c000:0201::', false],
  ['2001:db8::1', false], ['fc00::1', false], ['fe80::1', false], ['ff02::1', false],
  ['3ffe::1', false], ['4000::1', false], ['not-an-ip', false],
  ['93.184.216.34', true], ['8.8.8.8', true],
  ['2606:2800:220:1:248:1893:25c8:1946', true], ['2001:4860:4860::8888', true],
])('classifies public routability for %s', (address, expected) => {
  expect(isPublicAddress(address)).toBe(expected);
});
beforeAll(() => runMigrations());
beforeEach(async () => {
  await db.delete(taskQueue);
  await db.delete(platforms);
});
afterAll(() => closeDb());
describe('platform approval and safety', () => {
  it.each([
    ['Chiletrabajos', 'chiletrabajos.cl'],
    ['Trabajando.cl', 'trabajando.cl'],
    ['Empleos Aqua', 'empleosaqua.cl'],
  ])('approves the built-in portal %s by name', async (name, host) => {
    expect((await validateAndProbePlatform({ name }, new Set(), deps)).host).toContain(host);
  });

  it('accepts only an exact URL origin from the current message', async () => {
    const approvals = approvedOriginsFromMessage('Agregá https://jobs.example.com/path, por favor');
    await expect(validateAndProbePlatform({ name: 'Jobs', url: 'https://jobs.example.com/other' }, approvals, deps)).resolves.toMatchObject({ origin: 'https://jobs.example.com' });
    await expect(validateAndProbePlatform({ name: 'Invented', url: 'https://invented.example' }, approvals, deps)).rejects.toMatchObject({ code: 'unapproved' });
  });

  it('supports all:true at the actual pinned request boundary', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    expect(typeof address).toBe('object');
    await expect(pinnedRequest(new URL(`http://pinned.test:${typeof address === 'object' ? address!.port : 0}`), { address: '127.0.0.1', family: 4 })).resolves.toMatchObject({ status: 200 });
    server.close();
    await once(server, 'close');
  });

  it('times out a resolver that never settles', async () => {
    await expect(validateAndProbePlatform({ name: 'Jobs', url: 'https://jobs.example.com' }, new Set(['https://jobs.example.com']), {
      ...deps, dnsTimeoutMs: 5, resolve: () => new Promise(() => {}),
    })).rejects.toMatchObject({ code: 'unreachable' });
  });

  it.each([
    'file:///etc/passwd', 'https://user:pass@example.com', 'http://localhost',
    'http://127.0.0.1', 'http://169.254.1.2', 'http://10.0.0.1', 'http://0.0.0.0',
    'http://192.0.2.1', 'http://[::1]', 'http://[fe80::1]',
  ])('rejects unsafe URL %s', async (url) => {
    const approvals = new Set<string>();
    try { approvals.add(new URL(url).origin); } catch { /* invalid protocol is still rejected */ }
    await expect(validateAndProbePlatform({ name: 'Unsafe', url }, approvals, deps)).rejects.toMatchObject({ code: 'unsafe' });
  });
  it('rejects unsafe DNS answers, cross-origin redirects, and failed probes', async () => {
    const approval = new Set(['https://jobs.example.com']);
    await expect(validateAndProbePlatform({ name: 'Jobs', url: 'https://jobs.example.com' }, approval, { ...deps, resolve: async () => [{ address: '10.1.2.3', family: 4 }] })).rejects.toMatchObject({ code: 'unsafe' });
    await expect(validateAndProbePlatform({ name: 'Jobs', url: 'https://jobs.example.com' }, approval, { ...deps, request: async () => ({ status: 302, location: 'https://evil.example' }) })).rejects.toMatchObject({ code: 'unsafe' });
    await expect(validateAndProbePlatform({ name: 'Jobs', url: 'https://jobs.example.com' }, approval, { ...deps, request: async () => { throw new Error('offline'); } })).rejects.toMatchObject({ code: 'unreachable' });
    await expect(validateAndProbePlatform({ name: 'Jobs', url: 'https://jobs.example.com' }, approval, { ...deps, request: async () => ({ status: 404 }) })).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('follows a bounded same-origin redirect and revalidates DNS', async () => {
    let resolves = 0;
    let requests = 0;
    await validateAndProbePlatform({ name: 'Jobs', url: 'https://jobs.example.com' }, new Set(['https://jobs.example.com']), {
      ...deps,
      resolve: async () => { resolves++; return [{ address: '93.184.216.34', family: 4 }]; },
      request: async () => ++requests === 1 ? { status: 302, location: '/jobs' } : { status: 200 },
    });
    expect([resolves, requests]).toEqual([2, 2]);
  });
});
describe('platform persistence', () => {
  it('routes skill-less platforms to the browser and installed skills to deterministic scans', () => {
    expect(platformScanTaskType(false)).toBe('BROWSER_AGENT_SCAN');
    expect(platformScanTaskType(true)).toBe('SCAN_PLATFORM');
    expect(platformScanTaskType(true, true)).toBe('BROWSER_AGENT_SCAN');
  });
  it('creates once, enqueues one browser scan, and treats duplicates idempotently', async () => {
    const approval = new Set(['https://jobs.example.com']);
    const [first, duplicate] = await Promise.all([
      onboardPlatform({ name: 'Jobs', url: 'https://jobs.example.com/path?token=secret#person' }, approval, deps),
      onboardPlatform({ name: 'Jobs Again', url: 'https://jobs.example.com' }, approval, deps),
    ]);
    expect([first.created, duplicate.created].sort()).toEqual([false, true]);
    expect(await db.select().from(platforms)).toHaveLength(1);
    const tasks = await db.select().from(taskQueue);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.type).toBe('BROWSER_AGENT_SCAN');
    expect(JSON.stringify([first.platform, tasks[0]])).not.toContain('secret');
    await db.delete(taskQueue);
    const requested = await onboardPlatform({ name: 'Jobs', url: 'https://jobs.example.com', scanExisting: true }, approval, deps);
    expect(requested.taskId).toBeTruthy();
  });
  it('atomically deduplicates concurrent browser and deterministic scan tasks', async () => {
    const { enqueuePlatformScan } = await import('./platform-onboarding.js');
    const browser = await Promise.all(Array.from({ length: 5 }, () => enqueuePlatformScan({ slug: 'jobs', url: 'https://jobs.example.com' }, 'test')));
    const deterministic = await Promise.all(Array.from({ length: 5 }, () => enqueuePlatformScan({ slug: 'jobs', url: 'https://jobs.example.com' }, 'test', 'SCAN_PLATFORM')));
    expect(browser.filter(Boolean)).toHaveLength(1);
    expect(deterministic.filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(taskQueue)).toHaveLength(2);
  });
});
