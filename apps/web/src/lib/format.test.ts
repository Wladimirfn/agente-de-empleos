import { describe, expect, it } from 'vitest';
import { formatRelative } from './format';

const NOW = Date.parse('2026-07-30T12:00:00Z');

describe('formatRelative', () => {
  it('returns em-dash for null, undefined, and invalid input', () => {
    expect(formatRelative(null, NOW)).toBe('—');
    expect(formatRelative(undefined, NOW)).toBe('—');
    expect(formatRelative('not-a-date', NOW)).toBe('—');
  });

  it('returns "hace Ns" for < 60 seconds', () => {
    expect(formatRelative('2026-07-30T11:59:30Z', NOW)).toBe('hace 30s');
  });

  it('returns "hace N min" for < 60 minutes', () => {
    expect(formatRelative('2026-07-30T11:55:00Z', NOW)).toBe('hace 5 min');
  });

  it('returns "hace N h" for < 24 hours', () => {
    expect(formatRelative('2026-07-30T09:00:00Z', NOW)).toBe('hace 3 h');
  });

  it('returns "hace N d" for < 30 days', () => {
    expect(formatRelative('2026-07-27T12:00:00Z', NOW)).toBe('hace 3 d');
  });

  it('returns ISO date for >= 30 days', () => {
    expect(formatRelative('2026-06-01T12:00:00Z', NOW)).toBe('2026-06-01');
  });

  it('returns "recién" for future timestamps', () => {
    expect(formatRelative('2026-07-30T13:00:00Z', NOW)).toBe('recién');
  });
});