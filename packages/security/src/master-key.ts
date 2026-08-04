import { db } from '@employment-agent/database';
import { systemSecrets } from '@employment-agent/database/schema';
import { eq } from 'drizzle-orm';
import { generateMasterKey } from './aes-gcm.js';

const MASTER_KEY_ID = 'master_key';

/**
 * Resolves the current master encryption key, creating one on first use.
 *
 * The key is stored in the `system_secrets` table. Anyone with DB read
 * access can read the key, so the security model relies on the OS-level
 * encryption of the DB file (BitLocker / FileVault / LUKS). Document this
 * in the README so operators know to enable disk encryption.
 */
export async function getOrCreateMasterKey(): Promise<Buffer> {
  const rows = await db.select().from(systemSecrets).where(eq(systemSecrets.id, MASTER_KEY_ID));
  const row = rows[0];
  if (row) return Buffer.from(row.value, 'base64');
  const key = generateMasterKey();
  await db.insert(systemSecrets).values({ id: MASTER_KEY_ID, value: key.toString('base64') });
  return key;
}

/**
 * Admin helper: rotate the master key. WARNING: existing encrypted
 * credentials become unreadable after rotation. Call this only after
 * wiping `platform_credentials`, which the reset endpoint does.
 */
export async function rotateMasterKey(): Promise<Buffer> {
  const rows = await db.select().from(systemSecrets).where(eq(systemSecrets.id, MASTER_KEY_ID));
  const newKey = generateMasterKey();
  if (rows.length === 0) {
    await db.insert(systemSecrets).values({ id: MASTER_KEY_ID, value: newKey.toString('base64') });
  } else {
    await db.update(systemSecrets)
      .set({ value: newKey.toString('base64') })
      .where(eq(systemSecrets.id, MASTER_KEY_ID));
  }
  return newKey;
}
