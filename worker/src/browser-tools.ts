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

export async function createBrowserTools(opts?: {
  headless?: boolean;
  storageState?: string;
}): Promise<BrowserAgentTools> {
  const headless = opts?.headless ?? false;
  const browser: Browser = await chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const contextOptions: Record<string, unknown> = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'es-CL',
    viewport: { width: 1280, height: 900 },
  };
  if (opts?.storageState) {
    contextOptions.storageState = opts.storageState;
  }

  const context: BrowserContext = await browser.newContext(contextOptions);
  const page: Page = await context.newPage();

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
    return { url, title, text, elements };
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
      try {
        await page.goto(url, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
        return `Navigated to ${page.url()} — "${await page.title()}"`;
      } catch (err) {
        return `Navigation failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },

    async click(index: number): Promise<string> {
      const el = currentElements[index];
      if (!el) return `No element at index ${index}. Call extract_page first.`;
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
        return `Clicked "${el.text}" — now on ${page.url()}`;
      } catch (err) {
        return `Click failed on "${el.text}": ${err instanceof Error ? err.message : String(err)}`;
      }
    },

    async typeText(index: number, text: string): Promise<string> {
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
        return `Typed "${text}" into ${el.placeholder ?? el.id ?? el.tag}`;
      } catch (err) {
        return `Type failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },

    async pressEnter(): Promise<string> {
      await page.keyboard.press('Enter');
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await page.waitForTimeout(1000);
      return `Pressed Enter — now on ${page.url()}`;
    },

    async scroll(direction: 'up' | 'down'): Promise<string> {
      const delta = direction === 'down' ? 800 : -800;
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(500);
      return `Scrolled ${direction}`;
    },

    async goBack(): Promise<string> {
      await page.goBack({ timeout: NAV_TIMEOUT }).catch(() => null);
      await page.waitForTimeout(500);
      return `Went back to ${page.url()}`;
    },

    extractPage,

    async waitForHuman(message: string): Promise<string> {
      // In headed mode, we pause and emit an event so the user knows
      // human intervention is needed (e.g. CAPTCHA).
      console.log(`[browser-agent] HUMAN NEEDED: ${message}`);
      console.log(`[browser-agent] Page URL: ${page.url()}`);
      // Wait up to 5 minutes for the URL to change (user solved the challenge)
      const startUrl = page.url();
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        if (page.url() !== startUrl) {
          return `Human resolved the challenge. Now on ${page.url()}`;
        }
        // Also check if Cloudflare challenge elements are gone
        const hasChallenge = await page.evaluate(() => {
          return !!document.querySelector('#challenge-form, .cf-challenge, #turnstile-wrapper');
        });
        if (!hasChallenge) {
          return `Challenge appears resolved. Continuing on ${page.url()}`;
        }
      }
      return `Timeout waiting for human intervention on ${page.url()}`;
    },

    async close(): Promise<void> {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}
