import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');

describe('worker startup database lifecycle', () => {
  it('waits for migrations before starting database consumers', () => {
    expect(source).toContain('await runMigrations();');
    expect(source.indexOf('await runMigrations();')).toBeLessThan(source.indexOf('startHeartbeat();'));
    expect(source.indexOf('await runMigrations();')).toBeLessThan(source.indexOf('void startTaskRunner();'));
  });

  it('waits for database shutdown during graceful termination', () => {
    expect(source).toContain('await closeDb();');
  });
});
