import { db } from '@employment-agent/database';
import { agentRuns } from '@employment-agent/database/schema';

const HEARTBEAT_INTERVAL_MS = Number(process.env.WORKER_HEARTBEAT_SECONDS ?? 60) * 1000;

let timer: NodeJS.Timeout | null = null;

export function startHeartbeat(): void {
  if (timer) return;
  // Insert immediately
  void heartbeat();
  timer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
  console.log(`[heartbeat] started, interval=${HEARTBEAT_INTERVAL_MS}ms`);
}

export function stopHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function heartbeat(): Promise<void> {
  try {
    await db.insert(agentRuns).values({
      kind: 'heartbeat',
      status: 'running',
      summary: null,
    });
  } catch (err) {
    console.error('[heartbeat] insert failed:', err);
  }
}
