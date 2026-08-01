/**
 * `indeedSkill` — PlatformSkill implementation for Indeed.cl (TASK-402, SPEC-ID-009).
 *
 * Wires the existing scan + selfCheck surfaces into the `PlatformSkill`
 * contract that `worker/src/skill-init.ts` registers into the global
 * `SkillRegistry`.
 *
 * Design choices (D9, D10, D11):
 *  - `slug` is `'indeed'` (lowercase, no dashes — matches the existing
 *    computrabajo / laborum pattern; this is also the row key in
 *    `apps/web`'s skill registry health badges).
 *  - `version` is exported as `INDEED_SKILL_VERSION` so worker/telemetry code
 *    can log it without importing the constant object.
 *  - `capabilities.canScan = true`, `canApply = false`, `canDetectLoggedOut = false`
 *    — same shape as computrabajo (Indeed doesn't expose a public apply
 *    surface and the worker doesn't yet drive post-application flows).
 *  - `requiredCandidateFields = []` — the skill derives queries from
 *    `profile.skills[*]` and falls back to `DEFAULT_QUERIES` when absent.
 *  - `apply` is omitted (the `PlatformSkill` interface marks it optional).
 *    The worker treats any skill without `apply` as non-applicable.
 *  - `scan` delegates to `scanIndeed`; the persistent-context launch hook is
 *    passed through so the existing Unit 2 scan tests continue to drive
 *    the inner loop without instantiating Playwright.
 *  - `selfCheck` delegates to the `selfCheck` module; the same
 *    `launchContext` hook is forwarded so future tests can drive the probe
 *    via the same mock as `scanIndeed`.
 */

import type { PlatformSkill, ScanResult, SkillContext } from '@employment-agent/skill-runtime';
import type { CandidateProfile } from '@employment-agent/domain';

import { scanIndeed, type ScanHooks } from './scan.js';
import { selfCheck, type SelfCheckHooks } from './selfCheck.js';

/** Public version string for telemetry + boot logs. Bump on breaking scans. */
export const INDEED_SKILL_VERSION = '0.1.0';

/**
 * The PlatformSkill registration for Indeed.cl.
 *
 * Wired into the worker registry by:
 *
 *   worker/src/skill-init.ts:
 *     import { indeedSkill } from '../../skills/indeed/index.js';
 *     registry.register(indeedSkill);
 *
 * Tests that exercise the registry directly should use:
 *
 *   import { registry } from '@employment-agent/skill-runtime';
 *   expect(registry.get('indeed')).toBe(indeedSkill);
 */
export const indeedSkill: PlatformSkill = {
  slug: 'indeed',
  version: INDEED_SKILL_VERSION,
  displayName: 'Indeed.cl',
  requiredCandidateFields: [],
  capabilities: {
    canScan: true,
    canApply: false,
    canDetectLoggedOut: false,
  },

  async scan(
    profile: CandidateProfile,
    ctx: SkillContext,
  ): Promise<ScanResult> {
    // The scan hooks share a single shape with the selfCheck hooks —
    // both wrap `openPersistentContext`, `sleep`, and `rand`. We forward
    // whichever subset the caller passed in via the `PlatformSkill.scan`
    // call site (the worker does not currently inject these, but the unit
    // tests do). Any future hook divergence can be handled by splitting
    // the call sites.
    const hooks: ScanHooks = {};
    return scanIndeed(profile, ctx, hooks);
  },

  async selfCheck() {
    return selfCheck();
  },
};

export default indeedSkill;