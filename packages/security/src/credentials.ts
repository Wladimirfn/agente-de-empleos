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
  browserId: string | null;
  profilePath: string | null;
}

export interface CredentialPlaintext {
  slug: string;
  email: string;
  password: string;
  storageState: string | null;
  browserId: string | null;
  browserPath: string | null;
  profilePath: string | null;
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
    browserId: row.browserId,
    profilePath: row.profilePath,
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
    browserId: row.browserId,
    browserPath: row.browserPath,
    profilePath: row.profilePath,
  };
}

export async function recordLoginStatus(slug: string, status: LoginStatus): Promise<void> {
  const now = new Date().toISOString();
  await db.update(platformCredentials)
    .set({ lastLoginStatus: status, lastLoginAt: now, updatedAt: now })
    .where(eq(platformCredentials.slug, slug));
}

/**
 * The capture flow has no email/password (the user logged in via
 * OAuth or 2FA). We need placeholder values so the row can be inserted
 * with the existing schema (emailCipher and passwordCipher are NOT NULL).
 * The placeholder email encodes the slug so the user can tell which row
 * corresponds to which platform; the placeholder password is opaque.
 * The actual credential is the storage state — the agent never uses
 * the placeholder email/password.
 */
function capturePlaceholders(slug: string, key: Buffer): { emailCipher: string; passwordCipher: string } {
  return {
    emailCipher: encrypt(`capture+${slug}@placeholder.local`, key),
    passwordCipher: encrypt(`capture-placeholder-${slug}`, key),
  };
}

export async function persistStorageState(slug: string, storageState: string): Promise<void> {
  const key = await getOrCreateMasterKey();
  const storageStateCipher = encrypt(storageState, key);
  const ph = capturePlaceholders(slug, key);
  const now = new Date().toISOString();
  // Upsert: the capture flow usually creates a row that didn't exist
  // before (no email/password was ever saved). INSERT OR REPLACE so the
  // row is created if missing, updated if it exists.
  await db.insert(platformCredentials)
    .values({
      slug,
      storageStateCipher,
      emailCipher: ph.emailCipher,
      passwordCipher: ph.passwordCipher,
      consentAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: platformCredentials.slug,
      set: { storageStateCipher, updatedAt: now },
    });
}

/**
 * Save the browser profile (typically the user-data-dir path) for a
 * platform. Used by the session capture flow after the user logs in.
 * The proxy for "is the user logged in on this platform" is the
 * existence of the profile dir; we don't need to encrypt the path
 * itself since it's not a secret.
 */
export async function persistBrowserProfile(
  slug: string,
  browserId: string,
  browserPath: string,
  profilePath: string,
): Promise<void> {
  const key = await getOrCreateMasterKey();
  const ph = capturePlaceholders(slug, key);
  const now = new Date().toISOString();
  await db.insert(platformCredentials)
    .values({
      slug,
      browserId,
      browserPath,
      profilePath,
      emailCipher: ph.emailCipher,
      passwordCipher: ph.passwordCipher,
      consentAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: platformCredentials.slug,
      set: { browserId, browserPath, profilePath, updatedAt: now },
    });
}
