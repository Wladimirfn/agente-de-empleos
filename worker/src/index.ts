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

async function main(): Promise<void> {
  console.log('[worker] starting...');
  runMigrations();
  console.log('[worker] migrations applied');

  initializeSkills();
  registerBuiltinHandlers();
  writePidFile();
  startHeartbeat();
  startScheduler();
  console.log('[worker] running. Press Ctrl+C to stop.');

  // Run task runner as a non-blocking loop in the same process.
  // In a more mature setup this would be a separate worker thread.
  void startTaskRunner();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down...`);
    stopTaskRunner();
    stopScheduler();
    stopHeartbeat();
    removePidFile();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  removePidFile();
  process.exit(1);
});
