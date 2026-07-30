import { describe, it, expect } from 'vitest';
import { assertNoFabrication, isPlaceholder, isValidPhone, isValidEmail, FabricationError, safeProfileForResume } from '../src/invariants.js';
import type { CandidateProfile } from '../src/types.js';

describe('isPlaceholder', () => {
  it('detects common placeholders', () => {
    expect(isPlaceholder('Lorem ipsum dolor sit amet')).toBe(true);
    expect(isPlaceholder('TODO: write summary')).toBe(true);
    expect(isPlaceholder('[your phone here]')).toBe(true);
    expect(isPlaceholder('TBD')).toBe(true);
  });

  it('does not flag real text', () => {
    expect(isPlaceholder('Experienced software engineer with focus on distributed systems')).toBe(false);
    expect(isPlaceholder('+56 9 1234 5678')).toBe(false);
  });
});

describe('isValidPhone', () => {
  it('accepts reasonable phone numbers', () => {
    expect(isValidPhone('+56 9 1234 5678')).toBe(true);
    expect(isValidPhone('1234567')).toBe(true);
    expect(isValidPhone('+1 (555) 123-4567')).toBe(true);
  });

  it('rejects too short', () => {
    expect(isValidPhone('123')).toBe(false);
  });

  it('rejects too long', () => {
    expect(isValidPhone('12345678901234567')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('name.surname+tag@subdomain.example.org')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
  });
});

describe('assertNoFabrication', () => {
  it('passes for clean profile', () => {
    const profile: CandidateProfile = {
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+56 9 1234 5678',
      summary: 'Senior engineer with 10 years experience',
    };
    expect(() => assertNoFabrication(profile)).not.toThrow();
  });

  it('throws when phone is placeholder', () => {
    const profile: CandidateProfile = { phone: 'XXX-XXXX' };
    expect(() => assertNoFabrication(profile)).toThrow(FabricationError);
  });

  it('throws when summary is placeholder', () => {
    const profile: CandidateProfile = { summary: 'Lorem ipsum dolor sit amet' };
    expect(() => assertNoFabrication(profile)).toThrow(FabricationError);
  });

  it('throws when email is invalid', () => {
    const profile: CandidateProfile = { email: 'not-an-email' };
    expect(() => assertNoFabrication(profile)).toThrow(FabricationError);
  });

  it('passes for empty profile', () => {
    expect(() => assertNoFabrication({})).not.toThrow();
  });
});

describe('safeProfileForResume', () => {
  it('omits database-only fields', () => {
    const profile: CandidateProfile = {
      id: 1,
      fullName: 'Jane',
      createdAt: '2025-01-01',
      experiences: [{ company: 'Acme', role: 'Engineer', source: 'form' }],
    };
    const safe = safeProfileForResume(profile);
    expect(safe.id).toBeUndefined();
    expect(safe.createdAt).toBeUndefined();
    expect(safe.fullName).toBe('Jane');
    expect(safe.experiences).toHaveLength(1);
  });

  it('filters out incomplete experiences', () => {
    const profile: CandidateProfile = {
      experiences: [
        { company: 'Acme', role: 'Engineer' },
        { company: '', role: '' },
        { role: 'Designer' } as never,
      ],
    };
    const safe = safeProfileForResume(profile);
    expect(safe.experiences).toHaveLength(1);
  });
});
