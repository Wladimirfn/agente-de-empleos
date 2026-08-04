import { db, closeDb } from '@employment-agent/database';
import { taskQueue } from '@employment-agent/database/schema';
import { inArray, sql } from 'drizzle-orm';

/**
 * Mark any tasks stuck in 'running' / 'pending' / 'retrying' as 'failed'.
 * Use this when the worker has died (crash, restart, OOM) and left
 * zombie tasks behind — they block new enqueues because
 * enqueuePlatformScan refuses to add a new task if there's already
 * a pending/running/retrying one for the same skillSlug.
 *
 * Idempotent. Runable from the CLI: `npx tsx scripts/cleanup-zombie-tasks.ts`.
 */
async function main() {
  const result = await db.update(taskQueue)
    .set({
      status: 'failed',
      payloadJson: sql`json_set(${taskQueue.payloadJson}, '$.zombieCleanupAt', ${JSON.stringify(new Date().toISOString())})`,
    })
    .where(inArray(taskQueue.status, ['pending', 'running', 'retrying']))
    .returning({ id: taskQueue.id, type: taskQueue.type, status: taskQueue.status });
  console.log(`Marked ${result.length} zombie tasks as failed.`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
