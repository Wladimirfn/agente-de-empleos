import path from 'node:path';
import fs from 'node:fs';

const PROJECT_ROOT = process.cwd();

export const PATHS = {
  DATA_DIR: path.resolve(PROJECT_ROOT, 'data'),
  STORAGE_DIR: path.resolve(PROJECT_ROOT, 'storage'),
  CURRICULUM_DIR: path.resolve(PROJECT_ROOT, 'storage/curriculum'),
  GENERATED_DIR: path.resolve(PROJECT_ROOT, 'storage/generated'),
  SCREENSHOTS_DIR: path.resolve(PROJECT_ROOT, 'storage/screenshots'),
  SESSIONS_DIR: path.resolve(PROJECT_ROOT, 'storage/browser-sessions'),
  LOGS_DIR: path.resolve(PROJECT_ROOT, 'storage/logs'),
  DB_PATH: process.env.DATABASE_PATH ?? path.resolve(PROJECT_ROOT, 'data/employment-agent.db'),
  WORKER_PID: path.resolve(PROJECT_ROOT, 'data/worker.pid'),
  MIGRATIONS: path.resolve(PROJECT_ROOT, 'drizzle/migrations'),
};

export function ensureDataDirs(): void {
  for (const key of Object.keys(PATHS) as (keyof typeof PATHS)[]) {
    const value = PATHS[key];
    if (value.endsWith('.db') || value.endsWith('.pid') || value.endsWith('migrations')) continue;
    fs.mkdirSync(value, { recursive: true });
  }
}
