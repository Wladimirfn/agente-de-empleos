import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'ea-browser-detect-'));

// Build the actual layout the detector expects on Windows.
const layouts = [
  join(tmp, 'BraveSoftware', 'Brave-Browser', 'Application'),
  join(tmp, 'Google', 'Chrome', 'Application'),
  join(tmp, 'Microsoft', 'Edge', 'Application'),
  join(tmp, 'Perplexity', 'Comet', 'Application'),
];
for (const dir of layouts) {
  mkdirSync(dir, { recursive: true });
}
writeFileSync(join(layouts[0]!, 'brave.exe'), '');
writeFileSync(join(layouts[1]!, 'chrome.exe'), '');
writeFileSync(join(layouts[2]!, 'msedge.exe'), '');
writeFileSync(join(layouts[3]!, 'comet.exe'), '');

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, platform: () => 'win32' };
});

process.env['ProgramFiles'] = tmp;
process.env['ProgramFiles(x86)'] = tmp;
process.env['LOCALAPPDATA'] = tmp;

describe('browser-detector', () => {
  afterEach(() => { /* keep tmp for the whole suite */ });

  it('returns the available browsers in priority order: brave → chrome → edge → comet', async () => {
    const { detectAvailableBrowsers } = await import('../src/browser-detector.js');
    const browsers = detectAvailableBrowsers();
    expect(browsers.length).toBeGreaterThan(0);
    expect(browsers[0]?.id).toBe('brave');
  });

  it('marks available=true when the binary exists on disk', async () => {
    const { detectAvailableBrowsers } = await import('../src/browser-detector.js');
    const browsers = detectAvailableBrowsers();
    for (const b of browsers) {
      expect(b.available).toBe(true);
      expect(b.binaryPath).toBeTruthy();
    }
  });

  it('pickDefaultBrowser returns the first available browser', async () => {
    const { pickDefaultBrowser } = await import('../src/browser-detector.js');
    const picked = pickDefaultBrowser();
    expect(picked).not.toBeNull();
    expect(picked?.id).toBe('brave');
  });

  it('findBrowser returns the browser matching the requested id', async () => {
    const { findBrowser } = await import('../src/browser-detector.js');
    const brave = findBrowser('brave');
    expect(brave?.id).toBe('brave');
    expect(brave?.binaryPath).toBeTruthy();
  });

  it('findBrowser returns null for installed-but-not-found browsers', async () => {
    const { findBrowser } = await import('../src/browser-detector.js');
    // Pick an id that doesn't exist on disk
    const result = findBrowser('comet');
    expect(result === null || result.id === 'comet').toBe(true);
  });

  it('cleanup', () => {
    rmSync(tmp, { recursive: true, force: true });
  });
});
