import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DeterministicStubProvider } from '../src/providers/stub.js';
import { createLLMProvider } from '../src/factory.js';
import type { CandidateProfile, Job } from '@employment-agent/domain';

describe('DeterministicStubProvider', () => {
  const stub = new DeterministicStubProvider();

  it('has name "stub"', () => {
    expect(stub.name).toBe('stub');
  });

  it('parseResume returns empty structure', async () => {
    const result = await stub.parseResume('John Doe\nemail@x.com\n+1234567890');
    expect(result.experiences).toEqual([]);
    expect(result.education).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.fullName).toBeUndefined();
  });

  it('scoreMatch returns 0', async () => {
    const profile: CandidateProfile = { fullName: 'X' };
    const job: Job = { platformId: 1, externalId: 'j1', title: 'T' };
    const score = await stub.scoreMatch(profile, job);
    expect(score.score).toBe(0);
    expect(score.breakdown.skillsMatch).toBe(0);
  });

  it('summarize returns "stub"', async () => {
    expect(await stub.summarize('any long text here')).toBe('stub');
  });
});

describe('createLLMProvider', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.LLM_PROVIDER;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = originalEnv;
    }
  });

  it('returns stub when env unset', () => {
    delete process.env.LLM_PROVIDER;
    const provider = createLLMProvider();
    expect(provider.name).toBe('stub');
  });

  it('returns stub when env=stub', () => {
    process.env.LLM_PROVIDER = 'stub';
    const provider = createLLMProvider();
    expect(provider.name).toBe('stub');
  });

  it('throws on unknown provider', () => {
    process.env.LLM_PROVIDER = 'unknown-provider';
    expect(() => createLLMProvider()).toThrow(/Unknown LLM_PROVIDER/);
  });
});
