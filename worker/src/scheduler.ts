import cron from 'node-cron';
import { enqueueTask } from './task-queue.js';

const SCAN_CRON = '*/30 * * * *'; // every 30 minutes

let scheduled: cron.ScheduledTask | null = null;

export function startScheduler(): void {
  if (scheduled) return;
  scheduled = cron.schedule(SCAN_CRON, async () => {
    try {
      await enqueueTask({
        type: 'SCAN_ACTIVE_PLATFORMS',
        payload: { triggeredBy: 'cron' },
      });
    } catch (err) {
      console.error('[scheduler] failed to enqueue scan:', err);
    }
  });
  console.log(`[scheduler] registered cron '${SCAN_CRON}'`);
}

export function stopScheduler(): void {
  if (scheduled) {
    scheduled.stop();
    scheduled = null;
  }
}
