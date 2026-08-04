import { isApprovedOrigin } from './browser-tools.js';

/**
 * OAuth providers that platforms commonly redirect through. The user
 * has to log in inside the headed browser during session capture, so we
 * must allow these domains. The list is intentionally narrow: only the
 * well-known OAuth login frontends. Anything else is rejected by the
 * approved-origin policy.
 *
 * If you add a new platform that uses a different OAuth provider, add it
 * here. Do NOT add generic redirects (e.g. don't put `cdn.*` here).
 */
export const OAUTH_ALLOWED_ORIGINS = [
  'accounts.google.com',
  'appleid.apple.com',
  'facebook.com',
  'www.facebook.com',
  'login.microsoftonline.com',
  'github.com',
] as const;

/**
 * True iff the request URL is either on the platform's approved origin
 * OR on a known OAuth provider's origin. Anything else is blocked.
 */
export function shouldAllowNavigation(url: string, approvedOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    if (OAUTH_ALLOWED_ORIGINS.includes(parsed.hostname as typeof OAUTH_ALLOWED_ORIGINS[number])) {
      return true;
    }
    return isApprovedOrigin(url, approvedOrigin);
  } catch {
    return false;
  }
}

/**
 * List of allowed OAuth provider hostnames (for the UI to show "we
 * allow redirects to Google / Apple / Facebook / Microsoft / GitHub").
 */
export function getAllowedOAuthDomains(): string[] {
  return [...OAUTH_ALLOWED_ORIGINS];
}
