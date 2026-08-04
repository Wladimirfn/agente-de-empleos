import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';

/**
 * Browsers we know how to drive via CDP. Order matters: this is the
 * priority we use when the user hasn't configured a specific browser.
 * Brave is first because it has the cleanest fingerprint for sites that
 * detect Chromium-based browsers.
 */
export type BrowserId = 'brave' | 'chrome' | 'edge' | 'comet';

export interface BrowserInfo {
  id: BrowserId;
  /** Absolute path to the browser executable. */
  binaryPath: string;
  /** True if the binary exists on disk. */
  available: boolean;
}

/**
 * Candidate install locations by OS. We probe the filesystem instead of
 * relying on the user to configure a path: in practice users have one
 * of these installed and we want zero-config.
 *
 * On Linux we fall back to `which` via the PATH check below.
 */
function candidatePaths(): Array<{ id: BrowserId; path: string }> {
  const os = platform();
  if (os === 'win32') {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    return [
      { id: 'brave', path: join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
      { id: 'chrome', path: join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { id: 'chrome', path: join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { id: 'edge', path: join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { id: 'edge', path: join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { id: 'comet', path: join(localAppData, 'Perplexity', 'Comet', 'Application', 'comet.exe') },
    ];
  }
  if (os === 'darwin') {
    return [
      { id: 'brave', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
      { id: 'chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { id: 'edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { id: 'comet', path: '/Applications/Comet.app/Contents/MacOS/Comet' },
    ];
  }
  // Linux: rely on PATH lookups. We do the existence check separately.
  return [
    { id: 'brave', path: '/usr/bin/brave-browser' },
    { id: 'brave', path: '/usr/bin/brave' },
    { id: 'chrome', path: '/usr/bin/google-chrome' },
    { id: 'chrome', path: '/usr/bin/chromium' },
    { id: 'edge', path: '/usr/bin/microsoft-edge' },
  ];
}

/**
 * Returns the list of installed browsers found on this machine, in the
 * priority order: Brave → Chrome → Edge → Comet. The first available
 * is the default; the rest are fallback options.
 */
export function detectAvailableBrowsers(): BrowserInfo[] {
  const candidates = candidatePaths();
  const seen = new Set<BrowserId>();
  const result: BrowserInfo[] = [];
  for (const { id, path } of candidates) {
    if (seen.has(id)) continue; // First match per browser wins
    const available = existsSync(path);
    if (available) {
      result.push({ id, binaryPath: path, available: true });
      seen.add(id);
    }
  }
  return result;
}

/**
 * Returns the first available browser, or null if none are installed.
 * Used as the default browser when the user hasn't pinned one.
 */
export function pickDefaultBrowser(): BrowserInfo | null {
  const browsers = detectAvailableBrowsers();
  return browsers[0] ?? null;
}

/**
 * Resolves a specific browser by id. Returns null if that browser is
 * not installed on this machine. Used to honor the user's pinned
 * browser per platform.
 */
export function findBrowser(id: BrowserId): BrowserInfo | null {
  const browsers = detectAvailableBrowsers();
  return browsers.find((b) => b.id === id) ?? null;
}
