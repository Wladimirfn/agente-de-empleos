/**
 * Detects whether a browser page state is a verification challenge the
 * agent cannot solve from an automated environment (Cloudflare, CAPTCHA,
 * login wall). The browser-agent loop uses this to short-circuit before
 * burning more steps on `wait_human` calls.
 *
 * The detection is intentionally heuristic: the goal is to bail out
 * quickly on the obvious patterns, not to fingerprint every variant of
 * the underlying provider. False positives are acceptable here because
 * the worst case is "we asked the user to solve a CAPTCHA that wasn't
 * really there" — recoverable, just slower.
 *
 * IMPORTANT — login-required is no longer matched in body text. Most
 * job platforms put a "Iniciar sesión" / "Sign in" link in the page
 * navigation regardless of whether the user is logged in. Firing
 * login-required on every page where that nav string appears stopped
 * the agent on every successful scan. Real login walls are detected
 * via the page TITLE (e.g. "Iniciar sesión - Trabajando.com") or URL
 * (e.g. /login, redirect_uri=, /auth).
 */

export type ChallengeKind = 'cloudflare-verification' | 'captcha' | 'login-required';

export interface ChallengeDetection {
  kind: ChallengeKind;
  marker: string;
}

const CLOUDFLARE_MARKERS = [
  'attention required! | cloudflare',
  'additional verification required',
  'un momento…',
  'un momento...',
  'checking your browser',
  'verify that you are human',
  'verify you are human',
  'cf-challenge-running',
  'cf-mitigated',
  'cf-challenge',
  'challenge-form',
  'security check',
];

const CAPTCHA_MARKERS = [
  'recaptcha',
  'hcaptcha',
  'i\'m not a robot',
  'not a robot',
  'captcha',
];

// Login wall signals that are reliable regardless of where they appear
// on the page. Title-based matches are strong: when the page IS a login
// page, the title always carries it. URL-based matches catch the
// redirect-to-login pattern (Indeed, LinkedIn, etc). Body-text matches
// are deliberately excluded — see the IMPORTANT note above.
const LOGIN_TITLE_MARKERS = [
  'iniciar sesi\u00f3n',
  'iniciar sesion',
  'sign in',
  'log in',
  'ingresar',
];

const LOGIN_URL_MARKERS = [
  '/login',
  '/signin',
  '/sign-in',
  '/auth',
  'redirect_uri=',
  'login.microsoftonline',
  '/account/login',
];

// Body markers that ONLY appear on dedicated login pages, not in nav
// bars. These are safe to match against body text.
const LOGIN_BODY_MARKERS = [
  'continue with google',
  'continue with email',
  'forgot password',
  'sign in with',
  'iniciar sesi\u00f3n con google',
  'iniciar sesi\u00f3n con facebook',
];

export interface PageLikeState {
  url: string;
  title: string;
  text: string;
}

export function detectChallenge(state: PageLikeState): ChallengeDetection | null {
  const title = state.title.toLowerCase();
  const text = state.text.toLowerCase();
  const url = state.url.toLowerCase();

  for (const marker of CLOUDFLARE_MARKERS) {
    if (title.includes(marker) || text.includes(marker) || url.includes(marker)) {
      return { kind: 'cloudflare-verification', marker };
    }
  }
  for (const marker of CAPTCHA_MARKERS) {
    if (title.includes(marker) || text.includes(marker)) {
      return { kind: 'captcha', marker };
    }
  }
  // Login: title first (most reliable), then URL patterns, then
  // dedicated body markers that don't appear in nav bars.
  for (const marker of LOGIN_TITLE_MARKERS) {
    if (title.includes(marker)) {
      return { kind: 'login-required', marker };
    }
  }
  for (const marker of LOGIN_URL_MARKERS) {
    if (url.includes(marker)) {
      return { kind: 'login-required', marker };
    }
  }
  for (const marker of LOGIN_BODY_MARKERS) {
    if (text.includes(marker)) {
      return { kind: 'login-required', marker };
    }
  }
  return null;
}
