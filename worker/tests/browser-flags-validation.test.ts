import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execMock } = vi.hoisted(() => {
  // `promisify.custom` is the symbol Node sets on functions that have
  // a custom promisified implementation (e.g. child_process.exec).
  // Reuse the same symbol so `promisify(execMock)` resolves to
  // { stdout, stderr } the same way the real exec does. Inlined here
  // because vi.hoisted() runs before module-level imports.
  const PROMISE_CUSTOM = Symbol.for('nodejs.util.promisify.custom');
  const execMock = vi.fn();
  const promisifyCustom = (cmd: string, options?: unknown) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execMock(cmd, options, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  (execMock as unknown as Record<symbol, unknown>)[PROMISE_CUSTOM] = promisifyCustom;
  return { execMock };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, exec: execMock };
});

describe('validateBrowserFlags (non-Windows short-circuit)', () => {
  const originalPlatform = process.platform;
  beforeEach(() => {
    execMock.mockReset();
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns valid on non-Windows without invoking exec', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags();
    expect(result).toEqual({ valid: true, commandLine: '', reason: 'platform-unsupported' });
    expect(execMock).not.toHaveBeenCalled();
  });

  it('returns valid on darwin without invoking exec', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags();
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('platform-unsupported');
    expect(execMock).not.toHaveBeenCalled();
  });
});

describe('validateBrowserFlags (Windows parsing — exec mocked)', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    execMock.mockReset();
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  /**
   * Mock exec so the Nth call (1-indexed) returns the given stdout.
   * Subsequent calls default to "no match" (exit 1) so any unexpected
   * exec invocation surfaces as a test failure rather than silently
   * resolving to undefined and producing confusing downstream errors.
   */
  function stubCalls(map: Record<number, { ok: true; stdout: string } | { ok: false; message: string }>) {
    let n = 0;
    execMock.mockImplementation((_cmd: unknown, _opts: unknown, cb?: (err: Error | null, stdout: string, stderr: string) => void) => {
      n++;
      const spec = map[n] ?? { ok: false, message: `unmocked exec call #${n}` };
      // exec(cmd, callback) — no options. exec(cmd, options, callback) — with options.
      const callback = (typeof _opts === 'function' ? _opts : cb) as (err: Error | null, stdout: string, stderr: string) => void;
      if (spec.ok) callback(null, spec.stdout, '');
      else callback(new Error(spec.message), '', '');
    });
  }

  it('rejects when netstat finds no LISTENING row (exit 1)', async () => {
    stubCalls({ 1: { ok: false, message: 'no match' } });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags(9222);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no-process-listening');
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it('rejects when LISTENING row has no PID column', async () => {
    stubCalls({ 1: { ok: true, stdout: '  TCP    0.0.0.0:9222    0.0.0.0:0    LISTENING\n' } });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags(9222);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no-process-listening');
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it('rejects when wmic fails to read the command line', async () => {
    stubCalls({
      1: { ok: true, stdout: '  TCP    0.0.0.0:9222    0.0.0.0:0    LISTENING    12345\n' },
      2: { ok: false, message: 'access denied' },
    });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags(9222);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no-commandline');
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('rejects when wmic returns empty CommandLine (system process)', async () => {
    stubCalls({
      1: { ok: true, stdout: '  TCP    0.0.0.0:9222    0.0.0.0:0    LISTENING    12345\n' },
      2: { ok: true, stdout: 'CommandLine=\n\n' },
    });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags(9222);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no-commandline');
  });

  it('rejects when command line is missing --disable-brave-shields', async () => {
    const cmdline = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe --remote-debugging-port=9222 --disable-features=BraveShields,BraveShieldsEnabled,BraveAdBlock';
    stubCalls({
      1: { ok: true, stdout: '  TCP    0.0.0.0:9222    0.0.0.0:0    LISTENING    12345\n' },
      2: { ok: true, stdout: `CommandLine="${cmdline}"\n\n` },
    });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags(9222);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing-shield-flag');
    expect(result.commandLine).toBe(cmdline);
  });

  it('rejects when command line is missing --disable-features=BraveShields', async () => {
    const cmdline = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe --remote-debugging-port=9222 --disable-brave-shields --no-first-run';
    stubCalls({
      1: { ok: true, stdout: '  TCP    0.0.0.0:9222    0.0.0.0:0    LISTENING    12345\n' },
      2: { ok: true, stdout: `CommandLine="${cmdline}"\n\n` },
    });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags(9222);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing-shield-flag');
  });

  it('accepts a properly launched Brave with both shield-disable flags', async () => {
    const cmdline = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe --remote-debugging-port=9222 --disable-brave-shields --disable-features=BraveShields,BraveShieldsEnabled,BraveAdBlock,BraveAdblockCosmeticFiltering,BraveAdBlockCookieConsent --no-first-run --no-default-browser-check';
    stubCalls({
      1: { ok: true, stdout: '  TCP    0.0.0.0:9222    0.0.0.0:0    LISTENING    12345\n' },
      2: { ok: true, stdout: `CommandLine="${cmdline}"\n\n` },
    });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags(9222);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.commandLine).toBe(cmdline);
  });

  it('picks the first LISTENING row when netstat lists IPv4 + IPv6', async () => {
    const cmdline = 'C:\\...\\brave.exe --disable-brave-shields --disable-features=BraveShields';
    stubCalls({
      1: { ok: true, stdout: '  TCP    0.0.0.0:9222    0.0.0.0:0    LISTENING    12345\n  TCP    [::]:9222    [::]:0    LISTENING    12345\n' },
      2: { ok: true, stdout: `CommandLine="${cmdline}"\n\n` },
    });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags(9222);
    expect(result.valid).toBe(true);
    expect(execMock.mock.calls[1]?.[0]).toContain('ProcessId=12345');
  });

  it('skips non-LISTENING rows (e.g. ESTABLISHED connections to 9222)', async () => {
    const cmdline = 'C:\\...\\brave.exe --disable-brave-shields --disable-features=BraveShields';
    stubCalls({
      1: { ok: true, stdout: '  TCP    192.168.1.10:5000    192.168.1.1:9222    ESTABLISHED    99999\n  TCP    0.0.0.0:9222    0.0.0.0:0    LISTENING    12345\n' },
      2: { ok: true, stdout: `CommandLine="${cmdline}"\n\n` },
    });
    const { validateBrowserFlags } = await import('../src/browser-launcher.js');
    const result = await validateBrowserFlags(9222);
    expect(result.valid).toBe(true);
    expect(execMock.mock.calls[1]?.[0]).toContain('ProcessId=12345');
  });
});
