import './env.js';
import fs from 'node:fs';
import path from 'node:path';
import { runMigrations, closeDb } from '@employment-agent/database';
import { initializeSkills } from './skill-init.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { registerBuiltinHandlers, startTaskRunner, stopTaskRunner } from './task-runner.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PID_FILE = path.join(DATA_DIR, 'worker.pid');

function writePidFile(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  console.log(`[worker] PID ${process.pid} written to ${PID_FILE}`);
}

function removePidFile(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

// Global process safety net. Before this PR, an unhandled rejection or
// uncaught exception anywhere in the worker (a bad platform, a bad
// LLM provider, a thrown-but-unawaited promise) would crash the
// process — and `concurrently` would take down the web too, which is
// what users saw as "se me cae localhost". Now the process keeps
// running and the error is logged with full context.
process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException:', err);
});

async function main(): Promise<void> {
  console.log('[worker] starting...');
  await runMigrations();
  console.log('[worker] migrations applied');

  initializeSkills();
  registerBuiltinHandlers();
  writePidFile();  startHeartbeat();
  startScheduler();
  console.log('[worker] running. Press Ctrl+C to stop.');

  // Run task runner as a non-blocking loop in the same process.
  // In a more mature setup this would be a separate worker thread.
  void startTaskRunner();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down...`);
    try {
      stopTaskRunner();
      stopScheduler();
      stopHeartbeat();
      removePidFile();
      await closeDb();
      process.exit(0);
    } catch (err) {
      console.error('[worker] shutdown error:', err);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // Differentiate fatal (process can't run) from transient (we'd loop
  // forever). The retry logic inside runMigrations() already absorbs
  // SQLITE_BUSY; if it still throws here, the database is genuinely
  // broken — exit so the supervisor (`concurrently`) can restart.
  const message = err instanceof Error ? err.message : String(err);
  const isTransient = /SQLITE_BUSY|database is locked/i.test(message);
  console.error('[worker] boot failed:', err);
  if (isTransient) {
    console.error('[worker] transient boot error; exiting so supervisor can restart');
  } else {
    console.error('[worker] fatal boot error; exiting');
  }
  removePidFile();
  process.exit(isTransient ? 2 : 1);
});
