import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { BrowserId } from './browser-detector.js';

const DEFAULT_CDP_PORT = 9222;
/**
 * Default location for browser profiles. Each platform gets its own
 * subdirectory so the agent's cookies for Indeed don't bleed into the
 * cookies for Laborum. The user-data-dir is what makes the session
 * truly persistent — the profile directory on disk holds cookies,
 * IndexedDB, local storage, and Chromium preferences.
 */
export const PROFILES_ROOT = 'storage/browser-profiles';

/**
 * Picks the next free local TCP port starting from the given port.
 * Used so two simultaneous capture tasks don't collide on 9222.
 */
async function pickFreePort(start: number): Promise<number> {
  // Try a small range. If all are taken, the user has bigger problems.
  for (let p = start; p < start + 20; p++) {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(200) });
      if (!res.ok) return p;
    } catch {
      // Connection refused → port is free.
      return p;
    }
  }
  return start;
}

export interface LaunchOptions {
  browserId: BrowserId;
  binaryPath: string;
  /** Profile directory for this platform. Created if it doesn't exist. */
  profileDir: string;
  /** First free port in the 9222-9241 range. Defaults to 9222. */
  cdpPort?: number;
}

/**
 * Spawns a real browser with --remote-debugging-port and a dedicated
 * user-data-dir. Returns the child process so the caller can kill it
 * on cancel. The browser is launched detached: it survives the agent
 * crashing so the user can keep using it after the agent restarts.
 */
export async function launchBrowser(opts: LaunchOptions): Promise<{ process: ChildProcess; cdpPort: number }> {
  await fs.mkdir(opts.profileDir, { recursive: true });
  const cdpPort = opts.cdpPort ?? await pickFreePort(DEFAULT_CDP_PORT);
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${opts.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    'about:blank',
  ];
  const process = spawn(opts.binaryPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  process.unref();
  // Wait for the CDP endpoint to be reachable before returning. Without
  // this, connectOverCDP races the browser startup and fails.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return { process, cdpPort };
    } catch {
      // Not ready yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Browser CDP endpoint did not come up on port ${cdpPort} within 10s`);
}

/**
 * Connects to a browser that's already running with --remote-debugging-port.
 * Used when the user opens Chrome manually or when a previous capture
 * left the browser running. Returns null if nothing is listening on
 * the given port.
 */
export async function connectToBrowser(cdpPort: number = DEFAULT_CDP_PORT): Promise<Browser | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(500) });
    if (!res.ok) return null;
  } catch {
    return null;
  }
  return chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
}

/**
 * Returns the first existing context on the connected browser. Real
 * Chrome with --user-data-dir exposes a single default context; we
 * reuse it so cookies persist across browser restarts.
 */
export async function getDefaultContext(browser: Browser): Promise<BrowserContext> {
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    // Shouldn't happen for a real Chrome, but safety net.
    return await browser.newContext();
  }
  return contexts[0]!;
}

/**
 * Derives the profile directory for a platform + browser combination.
 * Profile dirs are namespaced so the same browser can serve multiple
 * platforms without sharing cookies.
 */
export function profileDirFor(slug: string, browserId: BrowserId): string {
  return join(PROFILES_ROOT, `${slug}-${browserId}`);
}

/**
 * True if a profile directory exists at the given path. Used to
 * decide whether to show "First time?" or "Already logged in" UI.
 */
export function profileExists(profileDir: string): boolean {
  return existsSync(profileDir);
}
