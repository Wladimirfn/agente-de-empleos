import { db } from '@employment-agent/database';
import { platformCredentials } from '@employment-agent/database/schema';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from './aes-gcm.js';
import { getOrCreateMasterKey } from './master-key.js';

export type LoginStatus = 'success' | '2fa_required' | 'login_failed' | 'no_login_form' | 'unknown';

export interface CredentialSummary {
  slug: string;
  hasEmail: boolean;
  hasStorageState: boolean;
  lastLoginAt: string | null;
  lastLoginStatus: LoginStatus;
  consentAt: string;
  updatedAt: string;
}

export interface CredentialPlaintext {
  slug: string;
  email: string;
  password: string;
  storageState: string | null;
}

/**
 * Plaintext is never returned from the API. The web UI only sees
 * CredentialSummary (no email, no password, no storage state).
 */
export async function listCredentials(): Promise<CredentialSummary[]> {
  const rows = await db.select().from(platformCredentials);
  return rows.map((row) => ({
    slug: row.slug,
    hasEmail: Boolean(row.emailCipher),
    hasStorageState: Boolean(row.storageStateCipher),
    lastLoginAt: row.lastLoginAt,
    lastLoginStatus: row.lastLoginStatus,
    consentAt: row.consentAt,
    updatedAt: row.updatedAt,
  }));
}

export async function saveCredential(input: {
  slug: string;
  email: string;
  password: string;
  storageState?: string | null;
}): Promise<void> {
  const key = await getOrCreateMasterKey();
  const consentAt = new Date().toISOString();
  const updatedAt = consentAt;
  const emailCipher = encrypt(input.email, key);
  const passwordCipher = encrypt(input.password, key);
  const storageStateCipher = input.storageState ? encrypt(input.storageState, key) : null;
  const existing = await db.select({ id: platformCredentials.id })
    .from(platformCredentials)
    .where(eq(platformCredentials.slug, input.slug));
  if (existing.length > 0) {
    await db.update(platformCredentials)
      .set({
        emailCipher,
        passwordCipher,
        storageStateCipher,
        consentAt,
        updatedAt,
        lastLoginStatus: 'unknown',
      })
      .where(eq(platformCredentials.id, existing[0]!.id));
  } else {
    await db.insert(platformCredentials).values({
      slug: input.slug,
      emailCipher,
      passwordCipher,
      storageStateCipher,
      consentAt,
      updatedAt,
    });
  }
}

export async function deleteCredential(slug: string): Promise<void> {
  await db.delete(platformCredentials).where(eq(platformCredentials.slug, slug));
}

/**
 * Worker-side: read the plaintext for a single platform.
 * Returns null if no credential is stored. Never logs the plaintext.
 */
export async function loadCredentialPlaintext(slug: string): Promise<CredentialPlaintext | null> {
  const rows = await db.select().from(platformCredentials).where(eq(platformCredentials.slug, slug));
  const row = rows[0];
  if (!row) return null;
  const key = await getOrCreateMasterKey();
  return {
    slug: row.slug,
    email: decrypt(row.emailCipher, key),
    password: decrypt(row.passwordCipher, key),
    storageState: row.storageStateCipher ? decrypt(row.storageStateCipher, key) : null,
  };
}

export async function recordLoginStatus(slug: string, status: LoginStatus): Promise<void> {
  const now = new Date().toISOString();
  await db.update(platformCredentials)
    .set({ lastLoginStatus: status, lastLoginAt: now, updatedAt: now })
    .where(eq(platformCredentials.slug, slug));
}

export async function persistStorageState(slug: string, storageState: string): Promise<void> {
  const key = await getOrCreateMasterKey();
  const storageStateCipher = encrypt(storageState, key);
  const now = new Date().toISOString();
  await db.update(platformCredentials)
    .set({ storageStateCipher, updatedAt: now })
    .where(eq(platformCredentials.slug, slug));
}
