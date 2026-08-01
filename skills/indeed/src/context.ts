/**
 * Persistent Chromium context launcher (SPEC-ID-001, design D1).
 *
 * The skill uses Playwright's `chromium.launchPersistentContext` instead of
 * `chromium.launch` + `newContext()` because the persistent profile is what
 * carries `cf_clearance` and other cookies between scans — without them,
 * Indeed slams us with a Cloudflare challenge every fresh context.
 *
 * Everything in this module is testable as a pure function:
 *   - `resolveProfileDir(cwd, override?)` — absolute path math
 *   - `resolveHeadless(env, override?)`    — env flag → boolean
 *   - `openPersistentContext(opts?)`       — wraps Playwright; tests substitute
 *     the module-level `chromium.launchPersistentContext` via `vi.mock`.
 *
 * Threat-matrix notes (from design §Threat Matrix):
 *   - The profile dir is never deleted by skill code.
 *   - `INDEED_HEADLESS` is read-only — it only flips the `headless` flag.
 *   - No shell execution, no env-driven URL navigation.
 */

import { resolve as resolvePath } from 'node:path';
import { chromium } from 'playwright';
import { FatalSkillError } from '@employment-agent/skill-runtime';
import { BASE_URL, DEFAULT_USER_AGENT, PROFILE_DIR } from './types.js';
import type { PersistentPage } from './types.js';

// ---------------------------------------------------------------------------
// Pure helpers (easily unit-tested without Playwright)
// ---------------------------------------------------------------------------

/**
 * Resolve the persistent-context profile directory.
 *
 *   resolveProfileDir()           === <cwd>/storage/indeed-profile
 *   resolveProfileDir(cwd)        === <cwd>/storage/indeed-profile
 *   resolveProfileDir(cwd, 'x/y') === <cwd>/x/y
 *   resolveProfileDir(cwd, '/abs')=== /abs
 *
 * Absolute overrides are returned as-is so callers can pin a profile outside
 * the repo (e.g. for tests or for a worker that wants its own state dir).
 */
export function resolveProfileDir(cwd: string = process.cwd(), override?: string): string {
  if (override !== undefined && override !== null && override !== '') {
    // `path.resolve` returns absolute paths unchanged, relative paths
    // resolved against `cwd`. This is the contract tests rely on.
    return resolvePath(cwd, override);
  }
  return resolvePath(cwd, PROFILE_DIR);
}

/**
 * Resolve the `headless` flag for `chromium.launchPersistentContext`.
 *
 *   INDEED_HEADLESS unset / 'true' / '1' / 'yes' → true   (default)
 *   INDEED_HEADLESS='false' / '0' / 'no'         → false  (visible browser)
 *   explicit `override` (boolean)                → wins over env
 *
 * Default is `true` because the worker runs unattended; flipping to `false`
 * is an opt-in for manual debugging / warm-up sessions.
 */
export function resolveHeadless(env: NodeJS.ProcessEnv = process.env, override?: boolean): boolean {
  if (typeof override === 'boolean') return override;
  const raw = env.INDEED_HEADLESS;
  if (typeof raw !== 'string') return true;
  const v = raw.trim().toLowerCase();
  if (v === '' || v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return true; // unknown values fall back to the safe default
}

// ---------------------------------------------------------------------------
// Browser-typed surface
// ---------------------------------------------------------------------------

/**
 * Minimal handle returned by `openPersistentContext`.
 *
 * It only exposes `close` — the scan loop needs `page` separately so it can
 * navigate, classify, parse, and emit. The `page` is created once and reused
 * for the entire scan (no per-query `newPage()` allocations).
 */
export interface PersistentContextHandle {
  context: { close(): Promise<void> };
  page: PersistentPage;
}

/** Options for `openPersistentContext`. */
export interface OpenContextOptions {
  /** Override profile dir (absolute or relative to cwd). Default: PROFILE_DIR. */
  profileDir?: string;
  /** Override the `headless` flag (otherwise resolved from INDEED_HEADLESS). */
  headless?: boolean;
  /** Override the browser User-Agent. Default: DEFAULT_USER_AGENT. */
  userAgent?: string;
  /** Override viewport size. Default: 1280x800 (Indeed default-ish). */
  viewport?: { width: number; height: number };
}

/**
 * Launch the persistent Chromium context.
 *
 * Wraps `chromium.launchPersistentContext(dir, opts)`:
 *   - `dir`     : resolved profile dir (left intact across runs).
 *   - `headless`: from opts/env (see `resolveHeadless`).
 *   - `userAgent`: opts or DEFAULT_USER_AGENT.
 *
 * Throws `FatalSkillError(INDEED_LAUNCH_FAILED)` if Playwright returns a null
 * context (broken install, missing browser, etc.). The dashboard / `selfCheck`
 * can detect this kind via `err instanceof FatalSkillError` and map it to
 * `status: 'broken'`.
 *
 * Tests substitute `chromium.launchPersistentContext` via `vi.mock('playwright')`
 * to assert launch arguments without spinning up a real browser.
 */
export async function openPersistentContext(
  opts: OpenContextOptions = {},
): Promise<PersistentContextHandle> {
  const userDataDir = resolveProfileDir(process.cwd(), opts.profileDir);
  const headless = resolveHeadless(process.env, opts.headless);
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const viewport = opts.viewport ?? { width: 1280, height: 800 };

  // Playwright's persistent-context API returns `BrowserContext` directly —
  // there is no separate `browser` handle to close. Documenting that here so
  // the threat-matrix stays accurate.
  const context = (await chromium.launchPersistentContext(userDataDir, {
    headless,
    userAgent,
    viewport,
    locale: 'es-CL',
  })) as unknown as PersistentContextHandle['context'] | null;

  if (!context) {
    // Classified failure: Playwright returned a null BrowserContext. We throw
    // a `FatalSkillError(INDEED_LAUNCH_FAILED)` so the dashboard / selfCheck
    // can map it to `status: 'broken'` with the right code. The message keeps
    // the operator-actionable detail (profile dir + headless flag + likely
    // cause) that the previous plain `Error` carried.
    throw new FatalSkillError(
      `openPersistentContext: chromium.launchPersistentContext returned a null context for ${userDataDir} (headless=${headless}). ` +
        `Likely cause: missing browser binary. ${BASE_URL}`,
      'INDEED_LAUNCH_FAILED',
    );
  }

  // One page for the entire scan — the classifier + parser are designed to be
  // navigated repeatedly. Per-query page creation would multiply the number
  // of Cloudflare challenge tokens.
  const page = (await (context as unknown as { newPage(): Promise<PersistentPage> }).newPage()) as PersistentPage;

  return { context, page };
}
