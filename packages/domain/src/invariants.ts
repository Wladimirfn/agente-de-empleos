import type { CandidateProfile } from './types.js';

/**
 * Invariant: never fabricate candidate data.
 *
 * This function checks that a profile contains only real, user-supplied data
 * and never placeholders, fake numbers, or hallucinated values.
 */
export function assertNoFabrication(profile: CandidateProfile): void {
  // No phone means no phone — never a placeholder
  if (profile.phone !== undefined) {
    if (!isValidPhone(profile.phone)) {
      throw new FabricationError(`Invalid phone format: ${profile.phone}`);
    }
    if (isPlaceholder(profile.phone)) {
      throw new FabricationError(`Phone looks like a placeholder: ${profile.phone}`);
    }
  }

  if (profile.email !== undefined && profile.email.length > 0) {
    if (!isValidEmail(profile.email)) {
      throw new FabricationError(`Invalid email format: ${profile.email}`);
    }
  }

  if (profile.summary !== undefined) {
    if (isPlaceholder(profile.summary)) {
      throw new FabricationError('Summary looks like a placeholder');
    }
    if (profile.summary.length > 5000) {
      throw new FabricationError('Summary exceeds reasonable length (5000 chars)');
    }
  }
}

export function isPlaceholder(text: string): boolean {
  const placeholders = [
    'lorem ipsum',
    'placeholder',
    '[your',
    '[insert',
    'tbd',
    'todo',
    'xxx',
    'foo bar',
    'test test',
    'asdf',
  ];
  const lower = text.toLowerCase().trim();
  return placeholders.some((p) => lower.includes(p));
}

export function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export class FabricationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FabricationError';
  }
}

/**
 * Returns the profile with only the keys the resume engine should include.
 * Use this to avoid leaking database-only fields.
 */
export function safeProfileForResume(profile: CandidateProfile): CandidateProfile {
  return {
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    summary: profile.summary,
    experiences: profile.experiences?.filter((e) => e.company && e.role),
    skills: profile.skills?.filter((s) => s.name),
    education: profile.education?.filter((e) => e.institution),
  };
}
