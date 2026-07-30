import { claimNextTask, markCompleted, markFailed, markRetrying, TaskRow } from './task-queue.js';
import { isAppError, registry } from '@employment-agent/skill-runtime';
import { DatabaseEventEmitter } from './event-emitter.js';
import { createSkillContext } from '@employment-agent/skill-runtime';
import type { CandidateProfile } from '@employment-agent/domain';

const POLL_INTERVAL_MS = 5_000;

export type TaskHandler = (task: TaskRow) => Promise<void>;

const handlers = new Map<string, TaskHandler>();

export function registerHandler(type: string, handler: TaskHandler): void {
  handlers.set(type, handler);
}

let stopRequested = false;

export function stopTaskRunner(): void {
  stopRequested = true;
}

export async function startTaskRunner(): Promise<void> {
  stopRequested = false;
  while (!stopRequested) {
    try {
      const task = await claimNextTask();
      if (task) {
        await runTask(task);
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      console.error('[task-runner] poll error:', err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function runTask(task: TaskRow): Promise<void> {
  const handler = handlers.get(task.type);
  if (!handler) {
    await markFailed(task.id, `No handler for task type: ${task.type}`);
    return;
  }

  try {
    await handler(task);
    await markCompleted(task.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isAppError(err) && err.kind === 'transient') {
      if (task.attempts + 1 >= task.maxAttempts) {
        await markFailed(task.id, message);
      } else {
        await markRetrying(task.id, message, backoffMs(task.attempts));
      }
    } else if (isAppError(err) && err.kind === 'human_intervention') {
      await markFailed(task.id, message);
    } else {
      await markFailed(task.id, message);
    }
  }
}

function backoffMs(attempts: number): number {
  return Math.min(60_000 * Math.pow(2, attempts), 15 * 60_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerBuiltinHandlers(): void {
  const events = new DatabaseEventEmitter();
  const ctx = createSkillContext(events);

  registerHandler('SCAN_ACTIVE_PLATFORMS', async (task) => {
    const payload = JSON.parse(task.payloadJson) as { triggeredBy?: string };
    const skills = registry.list();
    for (const skill of skills) {
      if (!skill.capabilities.canScan) continue;
      const { enqueueTask } = await import('./task-queue.js');
      await enqueueTask({
        type: 'SCAN_PLATFORM',
        payload: { skillSlug: skill.slug, triggeredBy: payload.triggeredBy ?? 'unknown' },
      });
    }
  });

  registerHandler('SCAN_PLATFORM', async (task) => {
    const payload = JSON.parse(task.payloadJson) as { skillSlug: string };
    const skill = registry.get(payload.skillSlug);
    if (!skill) {
      throw new Error(`Skill not found: ${payload.skillSlug}`);
    }
    const profile: CandidateProfile = {}; // placeholder until profile service is built
    const scanCtx = { ...ctx, profile };
    const result = await skill.scan(profile, scanCtx);
    await events.emit({
      kind: 'scan_summary',
      message: `Skill ${skill.slug} scan: found=${result.jobsFound} new=${result.jobsNew}`,
      payload: result,
    });
  });
}
