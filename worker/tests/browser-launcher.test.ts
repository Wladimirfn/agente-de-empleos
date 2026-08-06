import { describe, expect, it } from 'vitest';

describe('browser-launcher helpers', () => {
  it('derives a profile dir per platform/browser combination', async () => {
    const { profileDirFor } = await import('../src/browser-launcher.js');
    // Use the platform's path separator so the test is portable.
    const sep = await import('node:path').then((m) => m.sep);
    const root = ['storage', 'browser-profiles'].join(sep);
    expect(profileDirFor('indeed', 'brave').endsWith(`${root}${sep}indeed-brave`)).toBe(true);
    expect(profileDirFor('laborum', 'chrome').endsWith(`${root}${sep}laborum-chrome`)).toBe(true);
    expect(profileDirFor('computrabajo', 'edge').endsWith(`${root}${sep}computrabajo-edge`)).toBe(true);
  });

  it('keeps profile dirs separated by platform so cookies do not bleed', async () => {
    const { profileDirFor } = await import('../src/browser-launcher.js');
    const a = profileDirFor('indeed', 'brave');
    const b = profileDirFor('laborum', 'brave');
    expect(a).not.toBe(b);
  });

  it('keeps profile dirs separated by browser so switching browsers is isolated', async () => {
    const { profileDirFor } = await import('../src/browser-launcher.js');
    const a = profileDirFor('indeed', 'brave');
    const b = profileDirFor('indeed', 'chrome');
    expect(a).not.toBe(b);
  });

  it('exposes the PROFILES_ROOT constant', async () => {
    const { PROFILES_ROOT } = await import('../src/browser-launcher.js');
    expect(PROFILES_ROOT).toBe('storage/browser-profiles');
  });
});
