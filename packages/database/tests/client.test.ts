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
    rmSync(tmpDir, { recursive: true, force: true });
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
});
