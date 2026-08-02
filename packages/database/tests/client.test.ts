import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

  it('creates a sqlite file in the configured location', async () => {
    process.env.DATABASE_PATH = path.join(tmpDir, 'second.db');
    vi.resetModules();
    const mod = await import('../src/client.js');
    expect(mod.db).toBeDefined();
    mod.closeDb();
  });
});
