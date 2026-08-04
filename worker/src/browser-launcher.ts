import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { BrowserId } from './browser-detector.js';

const DEFAULT_CDP_PORT = 9222;
const PROBE_TIMEOUT_MS = 500;
const LAUNCH_TIMEOUT_MS = 20_000;
/**
 * Default location for browser profiles. Each platform gets its own
 * subdirectory so the agent's cookies for Indeed don't bleed into the
 * cookies for Laborum. The user-data-dir is what makes the session
 * truly persistent — the profile directory on disk holds cookies,
 * IndexedDB, local storage, and Chromium preferences.
 */
export const PROFILES_ROOT = 'storage/browser-profiles';

/**
 * Probe the CDP endpoint on a port. Tries both 127.0.0.1 (IPv4) and
 * localhost (which on Windows resolves to IPv6 ::1 first). Chrome's
 * CDP endpoint can bind to either, so we accept either.
 */
async function probeCDP(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', 'localhost']) {
    try {
      const res = await fetch(`http://${host}:${port}/json/version`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (res.ok) return true;
    } catch {
      // Try next host
    }
  }
  return false;
}

/**
 * Picks the next free local TCP port starting from the given port.
 * Used so two simultaneous capture tasks don't collide on 9222.
 * Returns the lowest port that does NOT have a working CDP endpoint.
 */
async function pickFreePort(start: number): Promise<number> {
  for (let p = start; p < start + 20; p++) {
    const inUse = await probeCDP(p);
    if (!inUse) return p;
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
 * Browser-specific flags. Brave's shield blocks secure.indeed.com by
 * default; we disable it on launch so the agent can reach the login
 * page. Chrome and Edge don't need this — their shield is off by
 * default for sites the user has visited.
 */
export function browserSpecificFlags(browserId: BrowserId): string[] {
  if (browserId === 'brave') {
    return [
      '--disable-brave-shields',
      '--disable-features=BraveShields,BraveShieldsEnabled,BraveAdBlock',
    ];
  }
  return [];
}

/**
 * Spawns a real browser with --remote-debugging-port and a dedicated
 * user-data-dir. Returns the child process so the caller can kill it
 * on cancel. The browser is launched detached: it survives the agent
 * crashing so the user can keep using it after the agent restarts.
 */
export async function launchBrowser(opts: LaunchOptions): Promise<{ process: ChildProcess; cdpPort: number }> {
  const profileDir = resolve(opts.profileDir);
  await fs.mkdir(profileDir, { recursive: true });
  const cdpPort = opts.cdpPort ?? await pickFreePort(DEFAULT_CDP_PORT);
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    ...browserSpecificFlags(opts.browserId),
  ];
  const process = spawn(opts.binaryPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  process.unref();
  // Wait for the CDP endpoint to be reachable. We try both 127.0.0.1
  // and localhost (Chrome on Windows may bind to IPv6 first).
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeCDP(cdpPort)) return { process, cdpPort };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Browser CDP endpoint did not come up on port ${cdpPort} within ${LAUNCH_TIMEOUT_MS / 1000}s`);
}

/**
 * Connects to a browser that's already running with --remote-debugging-port.
 * Used when the user opens Chrome manually or when a previous capture
 * left the browser running. Returns null if nothing is listening on
 * the given port.
 */
export async function connectToBrowser(cdpPort: number = DEFAULT_CDP_PORT): Promise<Browser | null> {
  if (!(await probeCDP(cdpPort))) return null;
  // Try 127.0.0.1 first, then localhost, since connectOverCDP needs a
  // working endpoint. The browser is reachable on either, so we just
  // pick the one that works.
  for (const host of ['127.0.0.1', 'localhost']) {
    try {
      const browser = await chromium.connectOverCDP(`http://${host}:${cdpPort}`);
      return browser;
    } catch {
      // Try next host
    }
  }
  return null;
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
