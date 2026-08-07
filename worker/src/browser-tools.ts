/**
 * Playwright browser tools that the LLM agent can invoke.
 * Each tool maps to a single browser action. The agent loop
 * calls these based on the LLM's JSON action responses.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface InteractiveElement {
  index: number;
  tag: string;
  text: string;
  href?: string;
  type?: string;
  placeholder?: string;
  id?: string;
  ariaLabel?: string;
}

export interface PageState {
  url: string;
  title: string;
  text: string;
  elements: InteractiveElement[];
}

export interface BrowserAgentTools {
  navigate(url: string): Promise<string>;
  click(index: number): Promise<string>;
  typeText(index: number, text: string): Promise<string>;
  pressEnter(): Promise<string>;
  scroll(direction: 'up' | 'down'): Promise<string>;
  goBack(): Promise<string>;
  extractPage(): Promise<PageState>;
  waitForHuman(message: string): Promise<string>;
  close(): Promise<void>;
}

const MAX_TEXT_LENGTH = 3000;
const MAX_ELEMENTS = 50;
const NAV_TIMEOUT = 20_000;
const MAX_SAFE_URL_LENGTH = 500;
export const BACK_NAVIGATION_DISABLED = 'Back navigation is disabled by approved-origin policy.';
export const NAVIGATION_POLICY_ERROR = 'Navigation blocked by approved-origin policy.';

export function rejectBackNavigation(): string {
  return BACK_NAVIGATION_DISABLED;
}

export function isApprovedOrigin(url: string, approvedOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    return !parsed.username && !parsed.password && parsed.origin === approvedOrigin;
  } catch { return false; }
}

export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '[blocked URL]';
    return `${parsed.origin}${parsed.pathname}`.slice(0, MAX_SAFE_URL_LENGTH);
  } catch { return '[invalid URL]'; }
}

export function hasUrlCredentials(url: string): boolean {
  try { const parsed = new URL(url); return Boolean(parsed.username || parsed.password); }
  catch { return false; }
}

export function sanitizeOutbound<T>(value: T, depth = 0): T {
  if (depth > 8) return '[redacted]' as T;
  if (typeof value === 'string') return sanitizeOutboundString(value).slice(0, MAX_TEXT_LENGTH) as T;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeOutbound(item, depth + 1)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(new Map(
    Object.entries(value).slice(0, 100).map(([key, item]) => [sanitizeUrlsInText(key), sanitizeOutbound(item, depth + 1)]),
  )) as T;
  return value;
}

function sanitizeOutboundString(text: string): string {
  let out = text;
  // 1. Labeled form: capture the label (case-insensitive), then the exact
  //    16-hex body, then the optional region suffix (`-XX` or `XXX`).
  //    The label is preserved in the output; the body and region are redacted.
  out = out.replace(
    /(cf-ray[:=]\s+|cf-mitigated[:=]?\s+|cloudflare(?:\s+ray)?\s*id[:=]?\s+|ray\s*id[:=]?\s+)([0-9a-f]{16})(?:[-]?[A-Z]{2,3})?/gi,
    (_match, label: string) => label + '<cf-ray>',
  );
  // 2. Bare Ray IDs without a label. Allow both upper and lower case hex.
  out = out.replace(/(?<![0-9a-fA-F])([0-9a-fA-F]{16,24})(?![0-9a-fA-F])/g, '<cf-ray>');
  if (/^(?:[a-z][a-z\d+.-]*:\/\/|about:|data:|javascript:)\S*$/i.test(out)) return sanitizeUrl(out);
  return out.replace(/https?:\/\/[^\s<>"']+/gi, (url) => sanitizeUrl(url));
}

export function sanitizeUrlsInText(text: string): string { return sanitizeOutbound(text); }
export function sanitizePageState(state: PageState): PageState {
  return sanitizeOutbound(state);
}

/**
 * Pick the context that already has cookies for the approved origin.
 * When the user runs the agent on multiple platforms from one browser,
 * they may have multiple contexts (one per window profile / incognito
 * / etc). contexts[0] is not guaranteed to be the one with the user's
 * session. Falling back to the first context when no match is found
 * keeps us connected to whatever Brave has.
 *
 * "Has cookies for the approved origin" = at least one cookie whose
 * domain matches or is parent of the approved origin (e.g. cookie on
 * `.trabajando.cl` matches origin `https://www.trabajando.cl`). This
 * mirrors how Chrome scopes session cookies.
 */
export async function pickContextForOrigin(
  browser: import('playwright').Browser,
  contexts: BrowserContext[],
  approvedOrigin: string | undefined,
): Promise<BrowserContext> {
  if (!approvedOrigin || contexts.length === 1) return contexts[0]!;
  let originHost = '';
  try {
    originHost = new URL(approvedOrigin).hostname;
  } catch {
    return contexts[0]!;
  }
  for (const ctx of contexts) {
    try {
      const cookies = await ctx.cookies();
      const hasMatch = cookies.some((c) => {
        const domain = c.domain.replace(/^\./, '');
        return domain === originHost || originHost.endsWith(`.${domain}`) || domain.endsWith(`.${originHost}`);
      });
      if (hasMatch) return ctx;
    } catch {
      // Some contexts may not expose cookies() over CDP — skip them.
    }
  }
  return contexts[0]!;
}

export async function createBrowserTools(opts?: {
  headless?: boolean;
  storageState?: string;
  approvedOrigin?: string;
  /**
   * Use a pre-launched browser (e.g. real Chrome/Brave attached via
   * CDP) instead of launching Playwright's bundled Chromium. When set,
   * we reuse the browser's default context — that's where the cookies
   * from the user-data-dir live.
   */
  existingBrowser?: Browser;
}): Promise<BrowserAgentTools> {
  const headless = opts?.headless ?? false;
  const isAttached = Boolean(opts?.existingBrowser);
  const browser: Browser = opts?.existingBrowser ?? await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  // For attached browsers, reuse the default context (one per profile).
  // The cookies/IndexedDB from the user-data-dir are already there.
  let context: BrowserContext;
  let page: Page;
  // Track every page WE opened so close() can shut down only what we
  // created. Without this, context.close() would kill the user's localhost
  // tab too, and browser.close() would kill their entire Brave.
  const ownedPages: Page[] = [];
  if (isAttached) {
    const existing = browser.contexts();
    if (existing.length === 0) {
      // No contexts at all — shouldn't happen for a real browser, but
      // bail out so we don't create a phantom context the user can't
      // see.
      throw new Error('Connected browser has no contexts');
    }
    // When the user has multiple windows/profiles open (e.g. one for
    // localhost, another for an unrelated work session), contexts[0]
    // may not be the one with cookies for the platform we're about to
    // scan. The agent then lands on the anonymous homepage even though
    // the user is logged in. Pick the context whose cookies cover the
    // approved origin; fall back to contexts[0] when none does.
    context = await pickContextForOrigin(browser, existing, opts?.approvedOrigin);
    page = await context.newPage();
    ownedPages.push(page);
    // Track popups the AGENT triggers (`target=_blank`, OAuth
    // callbacks, window.open() from the agent's page) so the route
    // guard's `owner.close()` and our own `close()` only touch pages
    // we opened. Without this, the route's
    // "if (owner !== page) await owner.close()" closes the USER's
    // own tabs (including their localhost tab) when they navigate to
    // a non-approved origin in another tab. That was the cause of the
    // "cierran su pestaña y me botan del localhost" symptom.
    //
    // Filter by `opener() === page`: only register popups that the
    // agent's page opened. The user's own popups (Cmd+T, window.open
    // from a user tab, target=_blank from a user page) are NOT agent
    // popups and must remain off-limits. Subscribing to all pages
    // would re-introduce a smaller variant of the original bug.
    context.on('page', async (p) => {
      try {
        const opener = await p.opener();
        if (opener === page) ownedPages.push(p);
      } catch { /* detached before opener resolves — skip */ }
    });
  } else {
    const contextOptions: Record<string, unknown> = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      locale: 'es-CL',
      viewport: { width: 1280, height: 900 },
    };
    if (opts?.storageState) {
      contextOptions.storageState = opts.storageState;
    }
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
    ownedPages.push(page);
  }
  let policyBlocked = false;
  let lastApprovedUrl = opts?.approvedOrigin ?? '';
  if (opts?.approvedOrigin) {
    await context.route('**/*', async (route) => {
      const request = route.request();
      // Only enforce the approved-origin policy on top-level navigation
      // (HTML document requests). Sub-resources (CSS / JS / fonts / images /
      // XHR) MUST load so the page renders correctly — without CSS Indeed
      // (and most platforms) render as a wall of left-aligned text.
      //
      // The `route.fetch + route.fulfill` dance below also breaks sub-
      // resource bodies in some Playwright builds (the fetch stream is
      // consumed before fulfill), so we just pass sub-resources through
      // unmodified with `route.continue()`.
      if (!request.isNavigationRequest()) return route.continue();
      const block = async () => {
        policyBlocked = true;
        await route.abort('blockedbyclient');
        try {
          const owner = request.frame().page();
          // Only close the owner if it's a page WE created. In the
          // attached-to-existing-browser path, the route runs on a
          // context that also contains the user's tabs (their
          // localhost tab, their work tabs, etc.) — closing any of
          // those was the cause of the "me botan del localhost" bug.
          // User-owned tabs are off-limits: the agent only navigates
          // its own pages and is the only one responsible for closing
          // popups it opened.
          if (owner && ownedPages.includes(owner) && owner !== page) {
            await owner.close();
          }
        } catch { /* detached popup/frame */ }
      };
      if (!isApprovedOrigin(request.url(), opts.approvedOrigin!)) return block();
      try {
        const response = await route.fetch({ maxRedirects: 0 });
        const location = response.headers().location;
        if (response.status() >= 300 && response.status() < 400 && location
          && !isApprovedOrigin(new URL(location, request.url()).href, opts.approvedOrigin!)) return block();
        await route.fulfill({ response });
      } catch {
        await route.abort('failed');
      }
    });
  }
  const policyResult = async () => {
    if (!policyBlocked) return null;
    await page.waitForTimeout(50);
    if (lastApprovedUrl && page.url() !== lastApprovedUrl) {
      await page.goto(lastApprovedUrl, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
    }
    return NAVIGATION_POLICY_ERROR;
  };

  // Track interactive elements found in the last extractPage call
  // so click/type can reference them by index.
  let currentElements: InteractiveElement[] = [];

  async function extractPage(): Promise<PageState> {
    // Wait for page to settle
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    await page.waitForTimeout(1000);

    const url = page.url();
    const title = await page.title();

    // Extract visible text (trimmed)
    const rawText = await page.evaluate(() => {
      const body = document.body;
      if (!body) return '';
      // Remove script/style content
      const clone = body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, noscript, svg').forEach((el) => el.remove());
      return (clone.innerText ?? '').replace(/\s+/g, ' ').trim();
    });
    const text = rawText.slice(0, MAX_TEXT_LENGTH);

    // Extract interactive elements: links, buttons, inputs, selects
    const elements: InteractiveElement[] = await page.evaluate((max) => {
      const results: Array<{
        index: number; tag: string; text: string;
        href?: string; type?: string; placeholder?: string;
        id?: string; ariaLabel?: string;
      }> = [];
      let idx = 0;

      // Links
      document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((el) => {
        if (idx >= max) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const text = (el.innerText ?? el.textContent ?? '').trim().slice(0, 100);
        if (!text) return;
        results.push({
          index: idx++, tag: 'a', text,
          href: el.href ?? undefined,
          id: el.id || undefined,
          ariaLabel: el.getAttribute('aria-label') ?? undefined,
        });
      });

      // Buttons
      document.querySelectorAll<HTMLButtonElement>('button, [role="button"]').forEach((el) => {
        if (idx >= max) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const text = (el.innerText ?? el.textContent ?? '').trim().slice(0, 100);
        if (!text) return;
        results.push({
          index: idx++, tag: 'button', text,
          type: (el as HTMLButtonElement).type ?? undefined,
          id: el.id || undefined,
          ariaLabel: el.getAttribute('aria-label') ?? undefined,
        });
      });

      // Inputs
      document.querySelectorAll<HTMLInputElement>('input, textarea, select').forEach((el) => {
        if (idx >= max) return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const input = el as HTMLInputElement;
        if (input.type === 'hidden') return;
        results.push({
          index: idx++, tag: input.tagName.toLowerCase(), text: '',
          type: input.type ?? undefined,
          placeholder: input.placeholder ?? undefined,
          id: input.id || undefined,
          ariaLabel: input.getAttribute('aria-label') ?? undefined,
        });
      });

      return results;
    }, MAX_ELEMENTS);

    currentElements = elements;
    return sanitizePageState({ url, title, text, elements });
  }

  function findSelector(index: number): string | null {
    const el = currentElements[index];
    if (!el) return null;
    // Build a selector we can use with Playwright
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.href) return `a[href="${el.href}"]`;
    if (el.ariaLabel) return `[aria-label="${el.ariaLabel}"]`;
    // Fall back to nth-of-type based on tag + text
    return null;
  }

  return {
    async navigate(url: string): Promise<string> {
      policyBlocked = false;
      if (opts?.approvedOrigin && !isApprovedOrigin(url, opts.approvedOrigin)) return NAVIGATION_POLICY_ERROR;
      try {
        await page.goto(url, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
        const blocked = await policyResult(); if (blocked) return blocked;
        lastApprovedUrl = page.url();
        return `Navigated to ${sanitizeUrl(page.url())} — "${sanitizeUrlsInText(await page.title())}"`;
      } catch {
        return await policyResult() ?? 'Navigation failed.';
      }
    },

    async click(index: number): Promise<string> {
      policyBlocked = false;
      const el = currentElements[index];
      if (!el) return `No element at index ${index}. Call extract_page first.`;
      if (el.href && opts?.approvedOrigin && !isApprovedOrigin(el.href, opts.approvedOrigin)) return NAVIGATION_POLICY_ERROR;
      try {
        // Try multiple selector strategies
        const selector = findSelector(index);
        if (selector) {
          await page.click(selector, { timeout: 5000 });
        } else {
          // Fall back: find by tag + text content
          const tag = el.tag === 'a' ? 'a' : el.tag === 'button' ? 'button, [role="button"]' : el.tag;
          const locator = page.locator(tag).filter({ hasText: el.text }).first();
          await locator.click({ timeout: 5000 });
        }
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        await page.waitForTimeout(500);
        const blocked = await policyResult(); if (blocked) return blocked;
        lastApprovedUrl = page.url();
        return `Clicked "${sanitizeUrlsInText(el.text)}" — now on ${sanitizeUrl(page.url())}`;
      } catch {
        return await policyResult() ?? 'Click failed.';
      }
    },

    async typeText(index: number, text: string): Promise<string> {
      policyBlocked = false;
      const el = currentElements[index];
      if (!el) return `No element at index ${index}. Call extract_page first.`;
      try {
        const selector = findSelector(index);
        if (selector) {
          await page.fill(selector, text, { timeout: 5000 });
        } else {
          const locator = page.locator(`${el.tag}[placeholder]`).first();
          await locator.fill(text, { timeout: 5000 });
        }
        const blocked = await policyResult(); if (blocked) return blocked;
        if (isApprovedOrigin(page.url(), opts?.approvedOrigin ?? new URL(page.url()).origin)) lastApprovedUrl = page.url();
        return `Entered text into ${sanitizeUrlsInText(el.placeholder ?? el.id ?? el.tag)}`;
      } catch {
        return 'Type failed.';
      }
    },

    async pressEnter(): Promise<string> {
      policyBlocked = false;
      await page.keyboard.press('Enter');
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await page.waitForTimeout(1000);
      const blocked = await policyResult(); if (blocked) return blocked;
      lastApprovedUrl = page.url();
      return `Pressed Enter — now on ${sanitizeUrl(page.url())}`;
    },

    async scroll(direction: 'up' | 'down'): Promise<string> {
      const delta = direction === 'down' ? 800 : -800;
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(500);
      return `Scrolled ${direction}`;
    },

    async goBack(): Promise<string> {
      return rejectBackNavigation();
    },

    extractPage,

    async waitForHuman(message: string): Promise<string> {
      // In headed mode, we pause and emit an event so the user knows
      // human intervention is needed (e.g. CAPTCHA).
      const safeMessage = sanitizeUrlsInText(message);
      console.log(`[browser-agent] HUMAN NEEDED: ${safeMessage}`);
      console.log(`[browser-agent] Page URL: ${sanitizeUrl(page.url())}`);
      // Wait up to 5 minutes for the URL to change (user solved the challenge)
      const startUrl = page.url();
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        if (page.url() !== startUrl) {
          return `Human resolved the challenge. Now on ${sanitizeUrl(page.url())}`;
        }
        // Also check if Cloudflare challenge elements are gone
        const hasChallenge = await page.evaluate(() => {
          return !!document.querySelector('#challenge-form, .cf-challenge, #turnstile-wrapper');
        });
        if (!hasChallenge) {
          return `Challenge appears resolved. Continuing on ${sanitizeUrl(page.url())}`;
        }
      }
      return `Timeout waiting for human intervention on ${sanitizeUrl(page.url())}`;
    },

    async close(): Promise<void> {
      // Only shut down what WE opened. If the agent attached to the
      // user's existing Brave via CDP (existingBrowser), the context and
      // browser belong to the user — closing them would kill the user's
      // localhost tab and the whole browser. Closing our owned pages
      // leaves the user with one less tab and otherwise everything intact.
      for (const p of ownedPages) {
        await p.close().catch(() => undefined);
      }
      if (!isAttached) {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    },
  };
}