import { beforeEach, describe, expect, it, vi } from 'vitest';

const cap = { canScan: true, canApply: false, canDetectLoggedOut: false };
const productionSlugs = ['laborum', 'computrabajo', 'indeed', 'chiletrabajos', 'empleosaqua', 'trabajando'] as const;
const fakeSkills = productionSlugs.map((slug, i) => ({
  slug,
  version: '0.1.0',
  displayName: slug.charAt(0).toUpperCase() + slug.slice(1),
  source: 'production',
  capabilities: cap,
}));

vi.mock('../../../lib/skills-catalog.js', () => ({
  getProductionSkills: () => fakeSkills,
  getBrowserEngineInfo: () => ({
    engine: 'chromium',
    message: 'Detected: chromium. Chromium is the default; Firefox and WebKit are also accepted. Install the corresponding Playwright binary with `npx playwright install <engine>` (chromium, firefox, or webkit).',
  }),
}));

const { GET } = await import('./index.js');

const callGet = () => GET({ request: new Request('http://localhost/api/skills'), url: new URL('http://localhost/api/skills') } as never);

describe('GET /api/skills', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with JSON headers and the production list', async () => {
    const response = await callGet();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const payload = await response.json() as { skills: Array<{ slug: string; source: string; capabilities: typeof cap }> };
    expect(payload.skills.map((s) => s.slug)).toEqual([...productionSlugs]);
    expect(payload.skills).toHaveLength(6);
    for (const skill of payload.skills) {
      expect(skill.source).toBe('production');
      expect(skill.capabilities).toEqual(cap);
    }
  });

  it('does NOT include the example-platform slug', async () => {
    const response = await callGet();
    const payload = await response.json() as { skills: Array<{ slug: string }> };
    expect(payload.skills.map((s) => s.slug)).not.toContain('example-platform');
  });

  it('returns the browser engine with a default-Chromium message and install hint', async () => {
    const response = await callGet();
    const payload = await response.json() as { browser: { engine: string; message: string } };
    expect(payload.browser.engine).toBe('chromium');
    expect(payload.browser.message.toLowerCase()).toContain('chromium is the default');
    expect(payload.browser.message).toContain('npx playwright install');
    expect(payload.browser.message).toContain('firefox');
    expect(payload.browser.message).toContain('webkit');
  });
});
