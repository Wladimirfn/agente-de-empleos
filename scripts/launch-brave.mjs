#!/usr/bin/env node
/**
 * Launches the user's installed browser with --remote-debugging-port
 * so the agent can connect via CDP. Cross-platform.
 *
 * Usage: node scripts/launch-brave.mjs [browser-id]
 *   browser-id: 'brave' (default), 'chrome', 'edge', 'comet'
 *
 * Idempotent: if the browser is already running with CDP on 9222,
 * it does nothing. If the browser is running WITHOUT the debug port,
 * this script will fail with a clear message — close the browser
 * first, then re-run.
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir, platform } from 'node:os';
import { join } from 'node:path';

const PORT = 9222;

/**
 * Browser flags applied at launch. These MUST match the flags the worker
 * uses in `worker/src/browser-launcher.ts` so the manually-launched browser
 * and the worker-launched one behave identically — otherwise the user sees
 * localhost blocked (ERR_BLOCKED_BY_CLIENT) and the agent's Indeed navigation
 * returns a half-rendered page that the LLM can't parse.
 *
 * Brave Shields in default mode:
 *   - Treats some localhost resources as trackers (blocks the Astro dev UI).
 *   - Blocks Indeed's anti-bot CSS/JS, leaving the page half-rendered.
 *   - Strips fingerprinting headers that Indeed needs for a clean session.
 */
const FLAGS_BY_BROWSER = {
  brave: [
    '--disable-brave-shields',
    '--disable-features=BraveShields,BraveShieldsEnabled,BraveAdBlock,BraveAdblockCosmeticFiltering,BraveAdBlockCookieConsent',
    '--no-first-run',
    '--no-default-browser-check',
    // NOTE: do NOT pass --disable-blink-features=AutomationControlled.
    // Chrome/Brave flag it as "affects stability and security" and show a
    // warning every launch. With a real user profile + real cookies, the
    // session already passes Indeed/Google bot checks; lying about
    // navigator.webdriver buys nothing and triggers the warning.
  ],
  chrome: [
    '--no-first-run',
    '--no-default-browser-check',
  ],
  edge: [
    '--no-first-run',
    '--no-default-browser-check',
  ],
  comet: [
    '--no-first-run',
    '--no-default-browser-check',
  ],
};

const BROWSER_PATHS = {
  win32: {
    brave: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    comet: 'C:\\Program Files\\Perplexity\\Comet\\Application\\comet.exe',
  },
  darwin: {
    brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  },
  linux: {
    brave: '/usr/bin/brave-browser',
    chrome: '/usr/bin/google-chrome',
    edge: '/usr/bin/microsoft-edge',
  },
};

const PROFILE_DIRS = {
  win32: {
    brave: join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data'),
    chrome: join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data'),
    edge: join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data'),
    comet: join(process.env.LOCALAPPDATA || '', 'Perplexity', 'Comet', 'User Data'),
  },
  darwin: {
    brave: join(homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
    chrome: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
    edge: join(homedir(), 'Library', 'Application Support', 'Microsoft Edge'),
  },
  linux: {
    brave: join(homedir(), '.config', 'BraveSoftware', 'Brave-Browser'),
    chrome: join(homedir(), '.config', 'google-chrome'),
    edge: join(homedir(), '.config', 'microsoft-edge'),
  },
};

async function isCDPAvailable(port) {
  for (const host of ['127.0.0.1', 'localhost']) {
    try {
      const res = await fetch(`http://${host}:${port}/json/version`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return true;
    } catch {
      // Try next host
    }
  }
  return false;
}

/**
 * Detect if a browser is ALREADY running on the system (with or without
 * CDP). If it is, launching a second instance causes two browsers to
 * coexist — the new one with the shield-disable flags we want, and the
 * old one without them, which is exactly the "ERR_BLOCKED_BY_CLIENT on
 * localhost" + "agent doesn't work" failure mode the user reported.
 *
 * We refuse to launch a second instance and tell the user to close
 * the existing one first.
 */
async function isBrowserProcessRunning(browserId) {
  const os = platform();
  const exeNames = {
    win32: { brave: 'brave.exe', chrome: 'chrome.exe', edge: 'msedge.exe', comet: 'comet.exe' },
    darwin: { brave: 'Brave Browser', chrome: 'Google Chrome', edge: 'Microsoft Edge', comet: 'Comet' },
    linux: { brave: 'brave-browser', chrome: 'chrome', edge: 'msedge', comet: 'comet' },
  };
  const exe = exeNames[os]?.[browserId];
  if (!exe) return false;
  try {
    if (os === 'win32') {
      const out = execSync(`tasklist /FI "IMAGENAME eq ${exe}" /NH`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      // tasklist prints "INFO: No tasks are running..." when nothing matches;
      // otherwise it prints lines like "brave.exe       12345 Console    1   123,456 K".
      return out.toLowerCase().includes(exe.toLowerCase());
    }
    // Mac/Linux: pgrep returns 0 if any process matches.
    execSync(`pgrep -f "${exe}"`, { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Use Chrome DevTools Protocol over HTTP to open a new tab pointing at
 * the dev server. Avoids needing Playwright as a dep here and avoids
 * opening a SECOND browser (which is what `start http://localhost:3000`
 * from a .bat would do via the system default browser — that's why
 * start-employment-agent.bat used to launch two Braves).
 *
 * The /json/new endpoint accepts ?url=... and returns the new target's
 * metadata. We don't care about the body, just that it succeeded.
 */
async function openInitialTab(port, url) {
  for (const host of ['127.0.0.1', 'localhost']) {
    try {
      const res = await fetch(`http://${host}:${port}/json/new?${encodeURIComponent(url)}`, {
        method: 'PUT',
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // Try next host
    }
  }
  return false;
}

async function launchWindows(browserPath, profileDir, port, flags) {
  // PowerShell's Start-Process passes -ArgumentList as a single string; we
  // wrap each flag in double quotes. Flags with values (--foo=bar) are
  // emitted as one arg; boolean flags (--disable-shields) are emitted as one.
  const argList = [
    `"--remote-debugging-port=${port}"`,
    `"--user-data-dir=${profileDir}"`,
    ...flags.map((f) => `"${f}"`),
  ].join(', ');
  const script = `
$ErrorActionPreference = 'Stop'
$proc = Start-Process -FilePath "${browserPath}" -ArgumentList ${argList} -WindowStyle Normal -PassThru
Write-Output $proc.Id
`.trim();
  const scriptPath = join(tmpdir(), `launch-brave-${Date.now()}-${process.pid}.ps1`);
  writeFileSync(scriptPath, script, 'utf8');
  try {
    const stdout = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { encoding: 'utf8' },
    );
    const pid = parseInt(stdout.trim(), 10);
    if (isNaN(pid)) throw new Error(`PowerShell did not return a PID: ${stdout}`);
    return pid;
  } finally {
    try { unlinkSync(scriptPath); } catch {}
  }
}

async function launchUnix(browserPath, profileDir, port, flags) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    ...flags,
  ];
  const child = spawn(browserPath, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid ?? -1;
}

async function main() {
  const os = platform();
  const browserId = process.argv[2] || 'brave';
  const port = PORT;

  const browserPath = BROWSER_PATHS[os]?.[browserId];
  const profileDir = PROFILE_DIRS[os]?.[browserId];

  if (!browserPath || !existsSync(browserPath)) {
    console.error(`Browser ${browserId} not found at ${browserPath}`);
    console.error(`On ${os}, supported browsers: ${Object.keys(BROWSER_PATHS[os] || {}).join(', ')}`);
    process.exit(1);
  }

  if (!profileDir || !existsSync(profileDir)) {
    console.error(`Profile dir not found for ${browserId} at ${profileDir}`);
    console.error(`On Windows, brave.exe / chrome.exe store the profile under %LOCALAPPDATA%.`);
    console.error(`If you installed Brave in a non-standard location, set the path in BROWSER_PATHS.`);
    process.exit(1);
  }

  if (await isCDPAvailable(port)) {
    console.log(`Browser already running with CDP on port ${port}. Nothing to do.`);
    process.exit(0);
  }

  // The browser may be running WITHOUT --remote-debugging-port (the user
  // opened it manually). Launching a second instance leads to two
  // coexisting browsers: the new one with our shield-disable flags, and
  // the old one with default shields ON — exactly the "localhost
  // blocked" + "agent doesn't work" failure mode. Refuse and tell the
  // user what to do.
  const exeNames = {
    win32: { brave: 'brave.exe', chrome: 'chrome.exe', edge: 'msedge.exe', comet: 'comet.exe' },
    darwin: { brave: 'Brave Browser', chrome: 'Google Chrome', edge: 'Microsoft Edge', comet: 'Comet' },
    linux: { brave: 'brave-browser', chrome: 'chrome', edge: 'msedge', comet: 'comet' },
  };
  const exe = exeNames[os]?.[browserId] ?? browserId;
  if (await isBrowserProcessRunning(browserId)) {
    console.error(`\nERROR: ${browserId} is already running without remote debugging enabled.`);
    console.error(`Launching a second instance would cause two browsers to coexist (one with`);
    console.error(`shields ON, one with shields OFF) and break localhost + the agent.`);
    console.error('');
    if (os === 'win32') {
      console.error(`Fix: close every ${exe} window, then re-run this script.`);
      console.error(`     (Task Manager → search "${exe}" → End task if any orphan stays.)`);
    } else {
      console.error(`Fix: kill every "${exe}" process, then re-run this script.`);
      console.error(`     pkill -f "${exe}"   (or close all windows manually)`);
    }
    process.exit(1);
  }

  console.log(`Launching ${browserId}...`);
  const flags = FLAGS_BY_BROWSER[browserId] ?? [];
  if (flags.length > 0) console.log(`Flags: ${flags.join(' ')}`);
  let pid;
  try {
    pid = os === 'win32'
      ? await launchWindows(browserPath, profileDir, port, flags)
      : await launchUnix(browserPath, profileDir, port, flags);
    console.log(`Launched! PID: ${pid}`);
  } catch (err) {
    console.error(`Failed to launch: ${err.message}`);
    process.exit(1);
  }

  // Wait for CDP to come up
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isCDPAvailable(port)) {
      console.log(`CDP ready on port ${port}`);
      // Open the dev server in a new tab so the user does not need to
      // type the URL. Uses the CDP HTTP API so we don't need Playwright
      // as a runtime dep here. Idempotent — if the user already has a
      // localhost tab, this just adds another one (harmless).
      const devUrl = process.env.WEB_PORT ? `http://localhost:${process.env.WEB_PORT}` : 'http://localhost:3000';
      if (await openInitialTab(port, devUrl)) {
        console.log(`Opened ${devUrl} in a new tab`);
      } else {
        console.log(`CDP is up but could not auto-open a tab. Visit ${devUrl} manually.`);
      }
      process.exit(0);
    }
  }
  console.error('CDP did not come up within 15s');
  process.exit(1);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
