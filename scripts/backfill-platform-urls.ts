import { db, closeDb } from '@employment-agent/database';
import { platforms } from '@employment-agent/database/schema';
import { isNull, eq } from 'drizzle-orm';
import { platformUrlForSlug } from '../worker/src/platform-urls.js';

/**
 * Backfill: any platform row with baseUrl=NULL gets the canonical URL
 * via platformUrlForSlug. Idempotent on every run.
 */
async function main() {
  const rows = await db.select().from(platforms).where(isNull(platforms.baseUrl));
  console.log(`Found ${rows.length} platforms with null baseUrl`);
  for (const row of rows) {
    const url = platformUrlForSlug(row.slug);
    await db.update(platforms).set({ baseUrl: url }).where(eq(platforms.id, row.id));
    console.log(`  ${row.slug} -> ${url}`);
  }
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
