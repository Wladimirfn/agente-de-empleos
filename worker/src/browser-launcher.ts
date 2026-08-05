import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { BrowserId } from './browser-detector.js';

const execAsync = promisify(exec);

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
 * Browser-specific flags. MUST stay in sync with `FLAGS_BY_BROWSER` in
 * scripts/launch-brave.mjs — the worker-launched browser and the
 * manually-launched one need the same shield/fingerprint state so the
 * agent's behavior is identical regardless of how the browser was started.
 *
 * Brave's shields in default mode:
 *   - Block some localhost resources (ERR_BLOCKED_BY_CLIENT on the Astro UI).
 *   - Strip fingerprinting headers Indeed uses for a clean session.
 *   - Block cosmetic elements that the LLM needs to identify job cards.
 *
 * Chrome/Edge/Comet don't ship shields by default; the automation flag
 * matters for all of them so the browser doesn't reveal itself as a bot.
 */
export function browserSpecificFlags(browserId: BrowserId): string[] {
  if (browserId === 'brave') {
    return [
      '--disable-brave-shields',
      '--disable-features=BraveShields,BraveShieldsEnabled,BraveAdBlock,BraveAdblockCosmeticFiltering,BraveAdBlockCookieConsent',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ];
  }
  return [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

/**
 * Launches Brave via PowerShell's Start-Process instead of Node's
 * `spawn`. On Windows, `spawn` with `--remote-debugging-port` and
 * `detached: true` has subtle issues — the browser process sometimes
 * exits silently or the CDP endpoint never binds, even when the same
 * arguments work via `Start-Process` directly. We use PowerShell here
 * because that's what reliably works on Windows; on Mac/Linux we keep
 * the `spawn` fallback.
 *
 * Returns the PID so the caller can check if the process is alive.
 */
async function launchBrowserViaPowerShell(
  binaryPath: string,
  profileDir: string,
  cdpPort: number,
  extraFlags: string[],
): Promise<number> {
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=\`"${profileDir}\`"`,
    ...extraFlags,
  ];
  const argList = args.map((a) => `"${a}"`).join(', ');
  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `$proc = Start-Process -FilePath "${binaryPath}" -ArgumentList ${argList} -WindowStyle Normal -PassThru`,
    `Write-Output $proc.Id`,
  ].join('\n');
  const scriptPath = join(tmpdir(), `launch-brave-${process.pid}-${Date.now()}.ps1`);
  await fs.writeFile(scriptPath, script, 'utf8');
  try {
    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
    );
    const pid = parseInt(stdout.trim(), 10);
    if (isNaN(pid)) {
      throw new Error(`PowerShell did not return a PID. stdout=${stdout.trim()} stderr=${stderr.trim()}`);
    }
    return pid;
  } finally {
    await fs.unlink(scriptPath).catch(() => undefined);
  }
}

/**
 * Spawns a real browser with --remote-debugging-port and a dedicated
 * user-data-dir. Returns the PID so the caller can check liveness.
 *
 * On Windows we use PowerShell's Start-Process (the same approach a
 * user would take manually). On Mac/Linux we use Node's spawn.
 */
export async function launchBrowser(opts: LaunchOptions): Promise<{ pid: number; cdpPort: number }> {
  const profileDir = resolve(opts.profileDir);
  await fs.mkdir(profileDir, { recursive: true });
  const cdpPort = opts.cdpPort ?? await pickFreePort(DEFAULT_CDP_PORT);
  const extraFlags = [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    ...browserSpecificFlags(opts.browserId),
  ];

  const isWindows = process.platform === 'win32';
  let pid: number;
  try {
    if (isWindows) {
      pid = await launchBrowserViaPowerShell(opts.binaryPath, profileDir, cdpPort, extraFlags);
    } else {
      // Mac / Linux: use Node's spawn. Same arg list, no PowerShell.
      const { spawn } = await import('node:child_process');
      const args = [
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        ...extraFlags,
      ];
      const child = spawn(opts.binaryPath, args, { detached: true, stdio: 'ignore' });
      child.unref();
      pid = child.pid ?? -1;
    }
  } catch (err) {
    throw new Error(
      `Failed to launch ${opts.browserId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Wait for the CDP endpoint to be reachable. We try both 127.0.0.1
  // and localhost (Chrome on Windows may bind to IPv6 first). If the
  // browser exits before CDP comes up, fail fast with a useful
  // diagnostic so the user knows what went wrong.
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (pid > 0) {
      try {
        process.kill(pid, 0);
      } catch {
        // Process no longer alive. Common cause: profile locked.
        throw new Error(
          `Browser process (PID ${pid}) exited before CDP came up. ` +
          `Most likely your existing Brave has the profile locked — close it first and try again.`
        );
      }
    }
    if (await probeCDP(cdpPort)) return { pid, cdpPort };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Browser CDP endpoint did not come up on port ${cdpPort} within ${LAUNCH_TIMEOUT_MS / 1000}s. ` +
    `If your existing Brave is open, close it first.`
  );
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
