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

const LOGIN_MARKERS = [
  'iniciar sesi\u00f3n',
  'iniciar sesion',
  'continue with email',
  'continue with google',
  'forgot password',
  'ingresar',
  'ingresa',
  'sign in',
  'log in',
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
  for (const marker of LOGIN_MARKERS) {
    if (title.includes(marker) || text.includes(marker)) {
      return { kind: 'login-required', marker };
    }
  }
  return null;
}
