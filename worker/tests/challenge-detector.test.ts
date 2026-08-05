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
      title: 'Iniciar sesión - Example',
      text: 'Por favor ingresa tu email y contrasena para continuar.',
    });
    expect(result).toEqual({ kind: 'login-required', marker: 'iniciar sesión' });
  });

  it('flags login when the URL is a known login path', () => {
    const result = detectChallenge({
      url: 'https://example.com/login?redirect_uri=/dashboard',
      title: 'Dashboard',
      text: 'Loading your dashboard...',
    });
    expect(result?.kind).toBe('login-required');
  });

  it('does NOT flag a logged-in homepage that has "Iniciar sesión" only in the nav bar', () => {
    // Regression: previously the detector fired on body-text matches
    // and stopped the agent on every successful scan. Real login walls
    // appear in the page title or URL, not just in nav links.
    const result = detectChallenge({
      url: 'https://www.trabajando.cl/',
      title: 'Trabajos y empleos en Chile, bolsa de trabajo, portal de empleo | Trabajando.com',
      text: 'Iniciar sesión | Registrarse | Hola, María | Mis postulaciones | Salir | Ofertas de empleo ...',
    });
    expect(result).toBeNull();
  });

  it('does NOT flag job listing pages whose only "Sign in" mentions are nav links', () => {
    const result = detectChallenge({
      url: 'https://cl.indeed.com/jobs?q=desarrollador&l=Puerto+Montt',
      title: 'Desarrollador jobs in Puerto Montt - Indeed',
      text: 'Sign in | Postúlate en 1 click | 47 resultados | Senior Backend Developer ...',
    });
    expect(result).toBeNull();
  });

  it('does flag a page whose body has only "Sign in with Google" login options (not nav)', () => {
    const result = detectChallenge({
      url: 'https://example.com/auth',
      title: 'Welcome',
      text: 'Sign in with Google | Sign in with Apple | Sign in with email',
    });
    expect(result?.kind).toBe('login-required');
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
