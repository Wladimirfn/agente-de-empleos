import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'ea-credentials-')), 'credentials.db');

const { db, runMigrations, closeDb } = await import('@employment-agent/database');
const { platformCredentials, systemSecrets } = await import('@employment-agent/database/schema');
const {
  saveCredential,
  loadCredentialPlaintext,
  listCredentials,
  deleteCredential,
} = await import('@employment-agent/security');

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await db.delete(platformCredentials);
  await db.delete(systemSecrets);
});
afterAll(async () => { await closeDb(); });

describe('credentials DB ops', () => {
  it('round-trips email and password through encryption', async () => {
    await saveCredential({ slug: 'indeed', email: 'me@example.com', password: 'hunter2' });
    const pt = await loadCredentialPlaintext('indeed');
    expect(pt).not.toBeNull();
    expect(pt?.email).toBe('me@example.com');
    expect(pt?.password).toBe('hunter2');
    const summaries = await listCredentials();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.slug).toBe('indeed');
    expect(summaries[0]?.hasEmail).toBe(true);
    // Summaries MUST NOT expose email or password
    expect(JSON.stringify(summaries)).not.toContain('me@example.com');
    expect(JSON.stringify(summaries)).not.toContain('hunter2');
  });

  it('updates an existing credential on second save', async () => {
    await saveCredential({ slug: 'laborum', email: 'a@b.com', password: 'first' });
    await saveCredential({ slug: 'laborum', email: 'a@b.com', password: 'second' });
    const pt = await loadCredentialPlaintext('laborum');
    expect(pt?.password).toBe('second');
  });

  it('encrypts the storage state when provided', async () => {
    const state = JSON.stringify({ cookies: [{ name: 'session', value: 'abc-secret' }] });
    await saveCredential({ slug: 'computrabajo', email: 'x@y.com', password: 'p', storageState: state });
    const pt = await loadCredentialPlaintext('computrabajo');
    expect(pt?.storageState).toBe(state);
  });

  it('fails to decrypt after the master key is deleted', async () => {
    await saveCredential({ slug: 'chiletrabajos', email: 'x@y.com', password: 'p' });
    await db.delete(systemSecrets);
    // A fresh master key is created on next read, but it cannot decrypt
    // old ciphertext — must surface as a failure.
    await expect(loadCredentialPlaintext('chiletrabajos')).rejects.toThrow();
  });

  it('deleteCredential removes the row', async () => {
    await saveCredential({ slug: 'trabajando', email: 'x@y.com', password: 'p' });
    await deleteCredential('trabajando');
    expect(await loadCredentialPlaintext('trabajando')).toBeNull();
  });
});
