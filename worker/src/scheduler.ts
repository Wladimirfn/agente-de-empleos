import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { db } from '@employment-agent/database';
import { scanSettings } from '@employment-agent/database/schema';
import { enqueueTask } from './task-queue.js';

const DEFAULT_INTERVAL_MINUTES = 30;
const TICK_CRON = '* * * * *'; // check once per minute

let scheduled: ScheduledTask | null = null;
let lastRunAt = 0;

interface ScanConfig {
  intervalMinutes: number;
  enabled: boolean;
}

async function loadScanConfig(): Promise<ScanConfig> {
  try {
    const rows = await db.select().from(scanSettings).limit(1);
    const row = rows[0];
    if (!row) return { intervalMinutes: DEFAULT_INTERVAL_MINUTES, enabled: true };
    return {
      intervalMinutes: Math.max(1, row.scanIntervalMinutes),
      enabled: row.autoScanEnabled === 1,
    };
  } catch {
    return { intervalMinutes: DEFAULT_INTERVAL_MINUTES, enabled: true };
  }
}

export function startScheduler(): void {
  if (scheduled) return;
  // First automatic scan happens one interval after boot, same as before.
  lastRunAt = Date.now();
  scheduled = cron.schedule(TICK_CRON, async () => {
    try {
      const config = await loadScanConfig();
      if (!config.enabled) return;
      if (Date.now() - lastRunAt < config.intervalMinutes * 60_000) return;
      lastRunAt = Date.now();
      await enqueueTask({
        type: 'SCAN_ACTIVE_PLATFORMS',
        payload: { triggeredBy: 'cron' },
      });
      console.log(`[scheduler] scan enqueued (interval=${config.intervalMinutes}m)`);
    } catch (err) {
      console.error('[scheduler] failed to enqueue scan:', err);
    }
  });
  console.log(`[scheduler] registered dynamic scan scheduler (default ${DEFAULT_INTERVAL_MINUTES}m, configurable in /ofertas)`);
}

export function stopScheduler(): void {
  if (scheduled) {
    scheduled.stop();
    scheduled = null;
  }
}
