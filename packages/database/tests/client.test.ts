import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('database client', () => {
  let tmpDir: string;
  let originalDbPath: string | undefined;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'ea-db-test-'));
    originalDbPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = path.join(tmpDir, 'test.db');
  });

  afterAll(() => {
    if (originalDbPath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalDbPath;
    }
    // On Windows, SQLite WAL/SHM files can be locked briefly after the
    // test process closes the connection. rmSync with force: true can
    // still EPERM in that window; the temp dir is best-effort cleanup
    // and the OS will reclaim it. Swallow EPERM/EACCES to keep CI
    // noise out of the result.
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw err;
    }
  });

  it('imports the client module without errors', async () => {
    const mod = await import('../src/client.js');
    expect(mod.db).toBeDefined();
    expect(typeof mod.runMigrations).toBe('function');
    expect(typeof mod.closeDb).toBe('function');
    mod.closeDb();
  });

  it('locates root migrations from a workspace working directory', async () => {
    const mod = await import('../src/client.js');
    const workspaceCwd = path.join(process.cwd(), 'apps', 'web');

    expect(mod.resolveMigrationsFolder(workspaceCwd)).toBe(
      path.join(process.cwd(), 'drizzle', 'migrations'),
    );
  });

  it('leaves an absolute database path unchanged', async () => {
    const { resolveDbPath } = await import('../src/client.js');
    const absolutePath = path.join(tmpDir, 'absolute.db');

    expect(resolveDbPath(absolutePath, path.join(repoRoot, 'apps', 'web'))).toBe(absolutePath);
  });

  it.each([
    ['repository root', repoRoot],
    ['web workspace', path.join(repoRoot, 'apps', 'web')],
    ['worker workspace', path.join(repoRoot, 'worker')],
  ])('resolves a relative database path from the %s', async (_label, cwd) => {
    const { resolveDbPath } = await import('../src/client.js');

    expect(resolveDbPath('data/employment-agent.db', cwd)).toBe(
      path.join(repoRoot, 'data', 'employment-agent.db'),
    );
  });

  it('falls back to cwd when no project root exists', async () => {
    const { resolveDbPath } = await import('../src/client.js');

    expect(resolveDbPath('data/fallback.db', tmpDir)).toBe(
      path.join(tmpDir, 'data', 'fallback.db'),
    );
  });

  it('creates a sqlite file in the configured location', async () => {
    process.env.DATABASE_PATH = path.join(tmpDir, 'second.db');
    vi.resetModules();
    const mod = await import('../src/client.js');
    expect(mod.db).toBeDefined();
    mod.closeDb();
  });

  it('retries runMigrations on transient SQLITE_BUSY and eventually succeeds', async () => {
    vi.resetModules();
    const tmp = path.join(tmpDir, 'retry.db');
    process.env.DATABASE_PATH = tmp;

    // First call to migrate throws a transient lock; second call passes.
    let calls = 0;
    vi.doMock('drizzle-orm/libsql/migrator', () => ({
      migrate: async () => {
        calls += 1;
        if (calls === 1) {
          const err = new Error('database is locked') as Error & { code?: string };
          err.code = 'SQLITE_BUSY';
          throw err;
        }
      },
    }));

    const mod = await import('../src/client.js');
    await expect(mod.runMigrations()).resolves.toBeUndefined();
    expect(calls).toBe(2);
    mod.closeDb();
    vi.doUnmock('drizzle-orm/libsql/migrator');
  });

  it('throws after the runMigrations retry budget is exhausted', async () => {
    vi.resetModules();
    process.env.DATABASE_PATH = path.join(tmpDir, 'exhaust.db');

    let calls = 0;
    vi.doMock('drizzle-orm/libsql/migrator', () => ({
      migrate: async () => {
        calls += 1;
        const err = new Error('database is locked') as Error & { code?: string };
        err.code = 'SQLITE_BUSY';
        throw err;
      },
    }));

    const mod = await import('../src/client.js');
    await expect(mod.runMigrations()).rejects.toThrow(/database is locked/);
    // runMigrations budget is 5 attempts.
    expect(calls).toBe(5);
    mod.closeDb();
    vi.doUnmock('drizzle-orm/libsql/migrator');
  });

  it('does not retry on non-transient migration errors', async () => {
    vi.resetModules();
    process.env.DATABASE_PATH = path.join(tmpDir, 'nontransient.db');

    let calls = 0;
    vi.doMock('drizzle-orm/libsql/migrator', () => ({
      migrate: async () => {
        calls += 1;
        throw new Error('schema corruption: cannot parse column type');
      },
    }));

    const mod = await import('../src/client.js');
    await expect(mod.runMigrations()).rejects.toThrow(/schema corruption/);
    // Non-transient: single attempt.
    expect(calls).toBe(1);
    mod.closeDb();
    vi.doUnmock('drizzle-orm/libsql/migrator');
  });
});
