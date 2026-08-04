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

  it('uses .com for empleosaqua (not .cl)', () => {
    // The actual Empleos Aqua site is at empleosaqua.com. Using .cl would 404.
    expect(platformUrlForSlug('empleosaqua')).toBe('https://www.empleosaqua.com');
  });

  it('falls back to www.<slug>.cl for unknown slugs', () => {
    expect(platformUrlForSlug('mystery-platform')).toBe('https://www.mystery-platform.cl');
  });
});
