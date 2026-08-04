import { describe, expect, it } from 'vitest';
import { detectChallenge } from '../src/challenge-detector.js';

describe('detectChallenge', () => {
  it('returns null for a normal job listing page', () => {
    expect(detectChallenge({
      url: 'https://cl.indeed.com/jobs?q=developer',
      title: 'Developer Jobs - Indeed',
      text: 'Find thousands of developer jobs. Apply now with one click.',
    })).toBeNull();
  });

  it('flags Cloudflare "Additional Verification Required" page', () => {
    const result = detectChallenge({
      url: 'https://cl.indeed.com/',
      title: 'Security Check - Indeed.com',
      text: 'Additional Verification Required. Ray ID a25a1771da83cf87. Un momento...',
    });
    expect(result).toEqual({ kind: 'cloudflare-verification', marker: 'additional verification required' });
  });

  it('flags Cloudflare when only the URL contains the marker', () => {
    const result = detectChallenge({
      url: 'https://cl.indeed.com/cf-challenge-running',
      title: 'Loading',
      text: 'Please wait',
    });
    expect(result).toEqual({ kind: 'cloudflare-verification', marker: 'cf-challenge-running' });
  });

  it('flags reCAPTCHA challenges', () => {
    const result = detectChallenge({
      url: 'https://example.com/login',
      title: 'Sign in',
      text: 'Please complete the reCAPTCHA below to continue.',
    });
    expect(result).toEqual({ kind: 'captcha', marker: 'recaptcha' });
  });

  it('flags hCAPTCHA challenges', () => {
    const result = detectChallenge({
      url: 'https://example.com/login',
      title: 'Sign in',
      text: 'Privacy & Terms - hCaptcha protects this page from bots.',
    });
    expect(result).toEqual({ kind: 'captcha', marker: 'hcaptcha' });
  });

  it('flags Spanish login walls', () => {
    const result = detectChallenge({
      url: 'https://example.com/account',
      title: 'Mi cuenta',
      text: 'Por favor ingresa tu email y contrasena para continuar.',
    });
    expect(result).toEqual({ kind: 'login-required', marker: 'ingresa' });
  });

  it('returns the first marker that matches (cloudflare wins over login)', () => {
    const result = detectChallenge({
      url: 'https://example.com/',
      title: 'Sign in',
      text: 'cf-mitigated: please verify you are human, then sign in',
    });
    expect(result?.kind).toBe('cloudflare-verification');
  });
});
