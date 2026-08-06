import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { NAVIGATION_POLICY_ERROR, createBrowserTools, isApprovedOrigin, sanitizePageState, sanitizeUrl, sanitizeUrlsInText } from '../src/browser-tools.js';
import { buildAgentPrompt, safeActionName, sanitizeBrowserJobs } from '../src/browser-agent.js';
async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); return `http://127.0.0.1:${typeof address === 'object' ? address!.port : 0}`;
}
describe('browser origin pinning', () => {
  it('allows paths on the approved origin only', () => {
    expect(isApprovedOrigin('https://jobs.example.com/search?q=tech', 'https://jobs.example.com')).toBe(true);
    expect(isApprovedOrigin('https://evil.example/search', 'https://jobs.example.com')).toBe(false);
    expect(isApprovedOrigin('https://user:pass@jobs.example.com/search', 'https://jobs.example.com')).toBe(false);
    expect([safeActionName('click'), safeActionName('evil?q=secret')]).toEqual(['click', 'unknown']);
  });
  it('strips credentials, queries, and fragments from outward URLs', () => {
    expect(sanitizeUrl('https://jobs.example.com/search?q=secret#person')).toBe('https://jobs.example.com/search');
    expect(sanitizeUrl('https://user:pass@jobs.example.com/private?q=secret')).toBe('[blocked URL]');
    expect(sanitizeUrlsInText('Now on https://jobs.example.com/search?q=secret#person')).toBe('Now on https://jobs.example.com/search');
    expect(sanitizeUrl(`https://jobs.example.com/${'x'.repeat(1000)}`)).toHaveLength(500);
    const rawState = {
      url: 'https://jobs.example.com/search?q=secret#person',
      title: 'Results https://jobs.example.com/search?q=secret',
      text: 'Apply at https://jobs.example.com/job/1?token=secret#person',
      elements: [{ index: 0, tag: 'a', text: 'Job https://jobs.example.com?q=secret', href: 'https://jobs.example.com/job/1?token=secret#person', placeholder: 'See https://jobs.example.com?q=secret' },
        { index: 1, tag: 'a', text: 'Bad', href: 'https://user:pass@jobs.example.com/private' }],
    };
    const state = sanitizePageState(rawState);
    expect(rawState.elements[0]!.href).toContain('?token=secret#person');
    expect(state).toMatchObject({ url: 'https://jobs.example.com/search', elements: [{ href: 'https://jobs.example.com/job/1' }, { href: '[blocked URL]' }] });
    expect(JSON.stringify(state)).not.toMatch(/secret|person|user:pass/);
    const jobs = sanitizeBrowserJobs([{ externalId: 'id', title: 'Role https://jobs.example.com?q=secret', company: 'Co https://user:pass@jobs.example.com', nested: { 'https://jobs.example.com/key?token=secret': 'first', 'https://jobs.example.com/key#fragment': 'second' } }]);
    expect(JSON.stringify(jobs)).not.toMatch(/secret|user:pass/);
    expect((jobs[0] as unknown as { nested: object }).nested).toEqual({ 'https://jobs.example.com/key': 'second' });
    const prompt = buildAgentPrompt('Portal https://user:pass@jobs.example.com', { location: 'City https://jobs.example.com?token=secret', email: 'private@example.com', phone: '555', summary: 'Roles objetivo activos: Role https://jobs.example.com?q=secret', skills: [{ name: 'Skill https://jobs.example.com#fragment' }] } as never, ['Query https://jobs.example.com?secret=yes']);
    expect(prompt).toContain('City'); expect(prompt).not.toMatch(/secret|fragment|user:pass|private@example|555/);
  });
  it('blocks redirect, JS, form, popup, and direct-link navigation before external requests', async () => {
    let externalHits = 0;
    const external = createServer((_req, res) => { externalHits++; res.end('external'); });
    const externalOrigin = await listen(external);
    let approvedOrigin = '';
    const approved = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html'); if (req.url === '/redirect') { res.writeHead(302, { Location: externalOrigin }); res.end(); return; }
      if (req.url === '/same') { res.end('<h1>same</h1>'); return; }
      res.end(`<img src="${externalOrigin}/pixel"><a href="/same">Same</a><a href="${externalOrigin}">Direct</a><a href="/redirect">Redirect</a><form action="${externalOrigin}"><input id="q"><button>Submit</button></form><button onclick="location.href='${externalOrigin}'">Dynamic</button><button onclick="window.open('${externalOrigin}')">Popup</button>`);
    });
    approvedOrigin = await listen(approved);
    const tools = await createBrowserTools({ headless: true, approvedOrigin });
    try {
      expect(await tools.navigate(`${approvedOrigin}/`)).toContain(approvedOrigin);
      const index = async (text: string) => (await tools.extractPage()).elements.find((item) => item.text === text)!.index;
      expect(await tools.goBack()).toContain('disabled');
      expect(await tools.navigate(`${approvedOrigin}/same`)).toContain('/same');
      await tools.navigate(`${approvedOrigin}/`);
      for (const action of ['Dynamic', 'Popup', 'Direct']) expect(await tools.click(await index(action))).toBe(NAVIGATION_POLICY_ERROR);
      await tools.typeText(await index(''), 'query');
      expect(await tools.pressEnter()).toBe(NAVIGATION_POLICY_ERROR);
      expect(await tools.navigate(`${approvedOrigin}/redirect`)).toBe(NAVIGATION_POLICY_ERROR);
      expect((await tools.extractPage()).url).toBe(`${approvedOrigin}/`);
      expect(externalHits).toBe(0);
    } finally {
      await tools.close(); approved.close(); external.close();
    }
  }, 30_000);

  it('lets sub-resources (CSS/JS) load from the approved origin so pages render with styles', async () => {
    let cssHits = 0;
    const approved = createServer((req, res) => {
      if (req.url === '/style.css') {
        cssHits++;
        res.setHeader('Content-Type', 'text/css');
        res.end('h1 { color: rgb(255, 0, 0); }');
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end('<link rel="stylesheet" href="/style.css"><h1>styled</h1>');
    });
    const approvedOrigin = await listen(approved);
    const tools = await createBrowserTools({ headless: true, approvedOrigin });
    try {
      expect(await tools.navigate(`${approvedOrigin}/`)).toContain(approvedOrigin);
      // Wait for the stylesheet to load — domcontentloaded doesn't include
      // external stylesheets in Playwright's wait semantics.
      const state = await tools.extractPage();
      expect(state.url).toContain(approvedOrigin.replace('http://', ''));
      // The stylesheet must have been fetched. If the route guard had been
      // left intercepting sub-resources, cssHits would stay at 0 and the
      // page would render as a wall of unstyled text.
      expect(cssHits).toBeGreaterThan(0);
      expect(state.text).toContain('styled');
    } finally {
      await tools.close(); approved.close();
    }
  }, 30_000);

  it('trims postedAt to a short date string and strips oversize values', () => {
    const jobs = sanitizeBrowserJobs([
      { externalId: 'a', title: 'A', postedAt: '  hace 2 días  ' },
      { externalId: 'b', title: 'B', postedAt: '' },
      { externalId: 'c', title: 'C', postedAt: undefined },
      { externalId: 'd', title: 'D', postedAt: '2026-08-04' },
      // 200-char dump from a runaway model — should be stripped, not stored.
      { externalId: 'e', title: 'E', postedAt: 'x'.repeat(200) },
    ]);
    const lookup = Object.fromEntries(jobs.map((j) => [j.externalId, j.postedAt]));
    expect(lookup.a).toBe('hace 2 días');
    expect('b' in lookup).toBe(true); // b still passes the filter
    expect(lookup.b).toBeUndefined();
    expect(lookup.c).toBeUndefined();
    expect(lookup.d).toBe('2026-08-04');
    expect(lookup.e).toBeUndefined();
  });

  it('does NOT close user-owned pages in the shared context when route guard blocks a navigation', async () => {
    // Regression: in attached mode the route guard runs on the shared
    // context. The agent's `owner.close()` in block() used to close ANY
    // page that navigated to a non-approved origin — including the
    // user's own tabs (the "me botan de localhost" symptom). After the
    // fix, only pages the agent opened (ownedPages) can be closed.
    const { chromium } = await import('playwright');
    const external = createServer((_req, res) => { res.end('external'); });
    const externalOrigin = await listen(external);
    const approvedOrigin = 'http://127.0.0.1:1'; // unused, will be passed
    let approved = createServer((_req, res) => { res.end('<h1>home</h1>'); });
    const approvedAddr = await listen(approved);
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext();
      // The "user's tab" — NOT one of the agent's owned pages.
      const userPage = await ctx.newPage();
      await userPage.goto(approvedAddr);
      // Now create the agent's tools on the SAME context (the attached path).
      const tools = await createBrowserTools({
        headless: true,
        approvedOrigin: approvedAddr,
        existingBrowser: browser,
      });
      try {
        // Sanity: the user page is alive.
        expect(userPage.isClosed()).toBe(false);
        // User navigates their own tab to a NON-approved origin. The
        // route should ABORT the navigation but NOT close the tab.
        await userPage.goto(externalOrigin).catch(() => undefined);
        // Give Playwright a tick to settle the abort handler.
        await userPage.waitForTimeout(100);
        expect(userPage.isClosed()).toBe(false);
      } finally {
        await tools.close();
        await userPage.close().catch(() => undefined);
        await ctx.close();
      }
    } finally {
      await browser.close();
      external.close();
      approved.close();
    }
  }, 30_000);
});
