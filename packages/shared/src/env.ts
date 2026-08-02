import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

let loadedPath: string | null | undefined;

export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, '.env.example'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

export function loadRootEnv(startDir: string = process.cwd(), force = false): string | null {
  if (!force && loadedPath !== undefined) return loadedPath;
  const envPath = path.resolve(findRepoRoot(startDir), '.env');
  const found = fs.existsSync(envPath);
  if (found) loadDotenv({ path: envPath, quiet: true });
  if (!force) loadedPath = found ? envPath : null;
  return found ? envPath : null;
}
