import { describe, it, expect, beforeEach } from 'vitest';
import { registry } from '../src/registry.js';
import { HumanInterventionRequired, TransientSkillError, FatalSkillError, isAppError, ValidationError, NotFoundError } from '../src/errors.js';
import type { PlatformSkill } from '../src/types.js';
import type { CandidateProfile, Job } from '@employment-agent/domain';

const fakeSkill: PlatformSkill = {
  slug: 'fake-skill',
  version: '0.1.0',
  displayName: 'Fake',
  requiredCandidateFields: [],
  capabilities: { canScan: true, canApply: false, canDetectLoggedOut: false },
  async scan() {
    return { jobsFound: 0, jobsNew: 0, jobsDuplicate: 0, errors: 0 };
  },
  async selfCheck() {
    return { status: 'healthy', schemaVersion: '0.1.0', detectedAt: new Date().toISOString() };
  },
};

describe('SkillRegistry', () => {
  beforeEach(() => {
    registry.clear();
  });

  it('registers and retrieves a skill', () => {
    registry.register(fakeSkill);
    expect(registry.has('fake-skill')).toBe(true);
    expect(registry.get('fake-skill')).toBe(fakeSkill);
  });

  it('rejects duplicate registration', () => {
    registry.register(fakeSkill);
    expect(() => registry.register(fakeSkill)).toThrow();
  });

  it('unregisters', () => {
    registry.register(fakeSkill);
    expect(registry.unregister('fake-skill')).toBe(true);
    expect(registry.has('fake-skill')).toBe(false);
  });

  it('lists all registered skills', () => {
    registry.register(fakeSkill);
    const another: PlatformSkill = { ...fakeSkill, slug: 'another' };
    registry.register(another);
    expect(registry.list()).toHaveLength(2);
  });

  it('returns undefined for unknown slug', () => {
    expect(registry.get('unknown')).toBeUndefined();
  });
});

describe('Error hierarchy', () => {
  it('HumanInterventionRequired is an AppError', () => {
    const e = new HumanInterventionRequired('need human');
    expect(isAppError(e)).toBe(true);
    expect(e.kind).toBe('human_intervention');
  });

  it('TransientSkillError can carry cause', () => {
    const cause = new Error('network');
    const e = new TransientSkillError('retry me', 'NETWORK', cause);
    expect(e.cause).toBe(cause);
  });

  it('FatalSkillError is fatal', () => {
    const e = new FatalSkillError('broken');
    expect(e.kind).toBe('fatal_skill');
  });

  it('ValidationError and NotFoundError are AppErrors', () => {
    expect(isAppError(new ValidationError('bad'))).toBe(true);
    expect(isAppError(new NotFoundError('user', 1))).toBe(true);
  });
});
