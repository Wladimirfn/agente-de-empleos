import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

const TEST_DB_DIR = mkdtempSync(join(tmpdir(), 'ea-migalign-'));
const TEST_DB = join(TEST_DB_DIR, 'alignment.db');

process.env.DATABASE_PATH = TEST_DB;

const { db, runMigrations, closeDb } = await import('@employment-agent/database');
const { sql } = await import('drizzle-orm');

beforeAll(async () => {
  // Seed the DB with the legacy state: __drizzle_migrations table with
  // 11 rows that have empty hashes (the pre-0013 state).
  const seed = await createClient({ url: `file:${TEST_DB}` });
  await seed.execute(`
    CREATE TABLE __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at INTEGER
    );
  `);
  for (let i = 0; i < 11; i++) {
    await seed.execute({ sql: 'INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)', args: ['', 0] });
  }
  await seed.close();
  await runMigrations();
});

afterAll(async () => { await closeDb(); });

describe('migration journal alignment', () => {
  it('aligns __drizzle_migrations so existing rows have proper hashes', async () => {
    const rows = await db.all(sql`SELECT hash FROM __drizzle_migrations` as never);
    const hashes = (rows as Array<{ hash: string }>).map((r) => r.hash);
    // The 11 hashes from 0000-0010 must be present alongside the legacy
    // empty rows. The legacy rows are harmless because they don't match
    // any current journal hash.
    expect(hashes).toContain('61a07e5240d603c22afcddc6a9d5a1a111acfb0a60848f443e3475e67a3fb364'); // 0000
    expect(hashes).toContain('ac83e9fdbfea5aec696181e7ffbab3107d68400205ea34f5f69e89b954e78ea6'); // 0010
    expect(hashes).toContain('2a43ff205ad9c553559d9e326156a2d358bb3a75d895d188f16e3cec4cbc9475'); // 0011
    expect(hashes).toContain('a9a1b3afb3c92365c77983f198a34b1f43821c53fb5ce8a8e2cba893ad84a46c'); // 0012
  });

  it('is idempotent — running migrations again is a no-op', async () => {
    const before = await db.all(sql`SELECT COUNT(*) as c FROM __drizzle_migrations` as never);
    await runMigrations();
    const after = await db.all(sql`SELECT COUNT(*) as c FROM __drizzle_migrations` as never);
    expect((after as Array<{ c: number }>)[0]?.c).toBe((before as Array<{ c: number }>)[0]?.c);
  });
});
