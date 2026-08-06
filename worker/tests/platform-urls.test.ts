import { describe, expect, it } from 'vitest';
import { platformUrlForSlug } from '../src/platform-urls.js';

describe('platformUrlForSlug', () => {
  it('returns the canonical URL for production platforms', () => {
    expect(platformUrlForSlug('indeed')).toBe('https://cl.indeed.com');
    expect(platformUrlForSlug('laborum')).toBe('https://www.laborum.cl');
    expect(platformUrlForSlug('computrabajo')).toBe('https://www.computrabajo.cl');
    expect(platformUrlForSlug('chiletrabajos')).toBe('https://www.chiletrabajos.cl');
    expect(platformUrlForSlug('trabajando')).toBe('https://www.trabajando.cl');
  });

  it('uses .cl for empleosaqua (the .com TLD does not resolve)', () => {
    // Earlier this returned www.empleosaqua.com based on an old assumption.
    // That hostname does not resolve (NXDOMAIN, 190.196.157.125 belongs to
    // www.empleosaqua.cl). Confirmed by the wait_human surfacing the
    // ERR_NAME_NOT_RESOLVED on the LLM agent.
    expect(platformUrlForSlug('empleosaqua')).toBe('https://www.empleosaqua.cl');
  });

  it('falls back to www.<slug>.cl for unknown slugs', () => {
    expect(platformUrlForSlug('mystery-platform')).toBe('https://www.mystery-platform.cl');
  });
});
