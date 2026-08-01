/**
 * URL builders, query derivation, and `jk` extraction for Indeed.cl
 * (SPEC-ID-005, SPEC-ID-006).
 */

import type { CandidateProfile } from '@employment-agent/domain';
import { FatalSkillError } from '@employment-agent/skill-runtime';
import { BASE_URL, DEFAULT_QUERIES, MAX_QUERIES } from './types.js';

/**
 * Build the list of search queries for a scan.
 *
 * - Reads target roles from the summary first (short job titles).
 * - Then short skill names (≤30 chars) that work as search keywords.
 * - Falls back to `DEFAULT_QUERIES` when the profile has no usable input.
 * - Caps the result at `MAX_QUERIES`.
 */
export function buildQueries(profile: CandidateProfile): string[] {
  // 1. Extract target roles from the summary (short job titles).
  const summary = profile.summary ?? '';
  const rolesMatch = summary.match(/Roles objetivo activos:\s*(.+)/);
  const targetRoles = rolesMatch
    ? rolesMatch[1].split(',').map((r) => r.replace(/\s*\(prioridad\s*\d+\)/, '').trim()).filter(Boolean)
    : [];

  // 2. Short skill names work as search queries; long descriptions don't.
  const MAX_QUERY_LENGTH = 30;
  const shortSkills = (profile.skills ?? [])
    .map((s) => s.name?.trim())
    .filter((name): name is string => Boolean(name && name.length > 1 && name.length <= MAX_QUERY_LENGTH));

  // 3. Combine: target roles first, then short skills, then defaults.
  const combined = [...new Set([...targetRoles, ...shortSkills])];
  return (combined.length > 0 ? combined : [...DEFAULT_QUERIES]).slice(0, MAX_QUERIES);
}

/**
 * Build the canonical search results URL for a given query + offset.
 *
 * Indeed uses `&start=` (NOT `&page=`). Per SPEC-ID-006 the offset is the
 * 0-based index of the first result: `start=0`, `start=10`, `start=20`...
 *
 * Throws on empty / whitespace-only queries — the caller is responsible for
 * asking "is there anything to search?" before iterating.
 */
export function buildSearchUrl(query: string, offset: number): string {
  const trimmed = query.trim();
  if (!trimmed) {
    // Classified failure: bad caller input. Throwing a `FatalSkillError`
    // with code `INDEED_CONFIG_INVALID` lets the dashboard / scan loop detect
    // the kind via `err instanceof FatalSkillError` and render the right
    // remediation surface (operator-actionable code rather than a plain JS
    // `Error` that downstream code has to re-classify).
    throw new FatalSkillError(
      'buildSearchUrl: query must be a non-empty string',
      'INDEED_CONFIG_INVALID',
    );
  }
  if (!Number.isFinite(offset) || offset < 0) {
    throw new FatalSkillError(
      'buildSearchUrl: offset must be a non-negative number',
      'INDEED_CONFIG_INVALID',
    );
  }
  const params = new URLSearchParams({ q: trimmed, start: String(Math.floor(offset)) });
  return `${BASE_URL}/jobs?${params.toString()}`;
}

/**
 * Build the canonical job URL for a given `jk` (Indeed's internal 16-char key).
 *
 *   buildCanonicalUrl('abc123')
 *     === 'https://cl.indeed.com/viewjob?jk=abc123'
 *
 * Per SPEC-ID-005: the canonical URL is the `viewjob?jk=…` form; the original
 * `/rc/clk?jk=…&from=…` redirect URL is discarded.
 */
export function buildCanonicalUrl(jk: string): string {
  const trimmed = jk.trim();
  if (!trimmed) {
    // Same classification contract as `buildSearchUrl`: bad caller input →
    // `FatalSkillError(INDEED_CONFIG_INVALID)` so the error surfaces with a
    // typed code instead of a raw `Error`.
    throw new FatalSkillError(
      'buildCanonicalUrl: jk must be a non-empty string',
      'INDEED_CONFIG_INVALID',
    );
  }
  return `${BASE_URL}/viewjob?jk=${encodeURIComponent(trimmed)}`;
}

/**
 * Extract the `jk` query parameter from an Indeed URL.
 *
 * Accepts both absolute URLs (`https://cl.indeed.com/rc/clk?jk=abc123&from=serp`)
 * and relative paths (`/rc/clk?jk=abc123&from=serp`) — relative paths are
 * resolved against `BASE_URL`.
 *
 * Returns `null` when no usable `jk` is found or the input is malformed.
 *
 * Test anchor (SPEC-ID-005 / task #6):
 *   extractJkFromUrl('/rc/clk?jk=abc123&from=serp') === 'abc123'
 */
export function extractJkFromUrl(href: string): string | null {
  if (!href || typeof href !== 'string') return null;
  const trimmed = href.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed, BASE_URL);
  } catch {
    return null;
  }
  // Only trust URLs that resolve inside Indeed's namespace.
  if (!url.hostname.endsWith('indeed.com')) {
    return null;
  }
  const jk = url.searchParams.get('jk');
  if (!jk) return null;
  const cleaned = jk.trim();
  return cleaned.length > 0 ? cleaned : null;
}