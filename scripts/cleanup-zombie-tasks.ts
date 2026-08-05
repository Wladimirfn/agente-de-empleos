import { db, closeDb } from '@employment-agent/database';
import { sweepStaleRunningTasks } from '../worker/src/task-queue.js';

/**
 * One-shot CLI wrapper for the same sweep the worker does at boot and
 * that enqueuePlatformScan does on each new scan. Use this when the
 * user has zombie tasks and the worker is healthy but the UI is stuck.
 *
 * Idempotent. Safe to run while the worker is up.
 *
 *   npx tsx scripts/cleanup-zombie-tasks.ts [thresholdMinutes]
 *
 * Default threshold is 10 minutes (matches enqueuePlatformScan).
 */
async function main() {
  const arg = Number(process.argv[2]);
  const thresholdMs = Number.isFinite(arg) && arg > 0 ? Math.round(arg * 60_000) : undefined;
  const swept = await sweepStaleRunningTasks(thresholdMs ? { thresholdMs } : {});
  console.log(`Swept ${swept} stale running task(s)${thresholdMs ? ` (threshold ${arg}m)` : ''}.`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});