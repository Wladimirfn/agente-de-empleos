import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRepoRoot, loadRootEnv } from '../src/env.js';

function makeRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

describe('root dotenv loading', () => {
  afterEach(() => {
    delete process.env.ENV_TEST_MARKER;
  });

  it('finds the repo root by walking up from a nested directory', () => {
    const root = makeRepo({ 'package.json': '{}', 'env.example': 'A=\n' });
    const nested = path.join(root, 'apps', 'web');
    fs.mkdirSync(nested, { recursive: true });

    expect(findRepoRoot(nested)).toBe(root);
  });

  it('loads variables from the root .env into process.env', () => {
    const root = makeRepo({
      'package.json': '{}',
      'env.example': 'ENV_TEST_MARKER=\n',
      '.env': 'ENV_TEST_MARKER=loaded-from-root',
    });
    const nested = path.join(root, 'worker');
    fs.mkdirSync(nested, { recursive: true });

    const loaded = loadRootEnv(nested, true);

    expect(loaded).toBe(path.join(root, '.env'));
    expect(process.env.ENV_TEST_MARKER).toBe('loaded-from-root');
  });

  it('returns null when no .env exists at the root', () => {
    const root = makeRepo({ 'package.json': '{}', 'env.example': 'A=\n' });

    expect(loadRootEnv(root, true)).toBeNull();
  });
});
