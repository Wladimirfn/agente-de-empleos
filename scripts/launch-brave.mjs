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

async function launchWindows(browserPath, profileDir, port) {
  const script = `
$ErrorActionPreference = 'Stop'
$proc = Start-Process -FilePath "${browserPath}" -ArgumentList "--remote-debugging-port=${port}", "--user-data-dir=\`"${profileDir}\`"" -WindowStyle Normal -PassThru
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

async function launchUnix(browserPath, profileDir, port) {
  const child = spawn(browserPath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
  ], { detached: true, stdio: 'ignore' });
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
    process.exit(1);
  }

  if (await isCDPAvailable(port)) {
    console.log(`Browser already running with CDP on port ${port}. Nothing to do.`);
    process.exit(0);
  }

  console.log(`Launching ${browserId}...`);
  let pid;
  try {
    pid = os === 'win32'
      ? await launchWindows(browserPath, profileDir, port)
      : await launchUnix(browserPath, profileDir, port);
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
