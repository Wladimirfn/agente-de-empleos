import { describe, expect, it } from 'vitest';
import { getAllowedOAuthDomains, OAUTH_ALLOWED_ORIGINS, shouldAllowNavigation } from '../src/session-capture-policy.js';

const APPROVED = 'https://cl.indeed.com';

describe('shouldAllowNavigation', () => {
  it('lets through requests on the approved origin', () => {
    expect(shouldAllowNavigation('https://cl.indeed.com/login', APPROVED)).toBe(true);
    expect(shouldAllowNavigation('https://cl.indeed.com/callback?code=abc', APPROVED)).toBe(true);
  });

  it('lets through requests to Google OAuth', () => {
    expect(shouldAllowNavigation('https://accounts.google.com/o/oauth2/auth?client_id=indeed', APPROVED)).toBe(true);
    expect(shouldAllowNavigation('https://accounts.google.com/signin/v2/identifier', APPROVED)).toBe(true);
  });

  it('lets through requests to Apple, Facebook, Microsoft, GitHub OAuth', () => {
    expect(shouldAllowNavigation('https://appleid.apple.com/auth/authorize', APPROVED)).toBe(true);
    expect(shouldAllowNavigation('https://facebook.com/login.php', APPROVED)).toBe(true);
    expect(shouldAllowNavigation('https://www.facebook.com/v18.0/dialog/oauth', APPROVED)).toBe(true);
    expect(shouldAllowNavigation('https://login.microsoftonline.com/common/oauth2/authorize', APPROVED)).toBe(true);
    expect(shouldAllowNavigation('https://github.com/login/oauth/authorize', APPROVED)).toBe(true);
  });

  it('blocks arbitrary external origins (no phishing allowed)', () => {
    expect(shouldAllowNavigation('https://evil.example.com/login', APPROVED)).toBe(false);
    expect(shouldAllowNavigation('https://google-login.evil.com', APPROVED)).toBe(false);
    expect(shouldAllowNavigation('https://accounts.google.com.evil.com/oauth', APPROVED)).toBe(false);
  });

  it('blocks URLs that fail to parse', () => {
    expect(shouldAllowNavigation('not a url', APPROVED)).toBe(false);
    expect(shouldAllowNavigation('', APPROVED)).toBe(false);
  });

  it('does NOT allow subdomain spoofing of OAuth providers', () => {
    // OAuth whitelist is exact hostname, not suffix.
    expect(shouldAllowNavigation('https://malicious.accounts.google.com.attacker.com', APPROVED)).toBe(false);
  });
});

describe('OAUTH_ALLOWED_ORIGINS', () => {
  it('contains the five well-known providers', () => {
    expect(OAUTH_ALLOWED_ORIGINS).toContain('accounts.google.com');
    expect(OAUTH_ALLOWED_ORIGINS).toContain('appleid.apple.com');
    expect(OAUTH_ALLOWED_ORIGINS).toContain('facebook.com');
    expect(OAUTH_ALLOWED_ORIGINS).toContain('www.facebook.com');
    expect(OAUTH_ALLOWED_ORIGINS).toContain('login.microsoftonline.com');
    expect(OAUTH_ALLOWED_ORIGINS).toContain('github.com');
  });

  it('does NOT contain CDN or analytics domains', () => {
    expect(OAUTH_ALLOWED_ORIGINS).not.toContain('cdn.google.com');
    expect(OAUTH_ALLOWED_ORIGINS).not.toContain('fonts.googleapis.com');
    expect(OAUTH_ALLOWED_ORIGINS).not.toContain('googletagmanager.com');
  });

  it('is exported for the UI to display', () => {
    const domains = getAllowedOAuthDomains();
    expect(domains).toContain('accounts.google.com');
    expect(domains).toHaveLength(OAUTH_ALLOWED_ORIGINS.length);
  });
});
