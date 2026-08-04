import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type BrowserEngine = 'chromium' | 'firefox' | 'webkit' | 'unknown';

export interface SkillCapabilities {
  canScan: boolean;
  canApply: boolean;
  canDetectLoggedOut: boolean;
}

export interface CatalogSkill {
  slug: string;
  version: string;
  displayName: string;
  capabilities: SkillCapabilities;
  source: 'production' | 'example';
}

export interface BrowserEngineInfo {
  engine: BrowserEngine;
  message: string;
}

export const productionSkillSlugs = [
  'laborum',
  'computrabajo',
  'indeed',
  'chiletrabajos',
  'empleosaqua',
  'trabajando',
] as const;

export type ProductionSkillSlug = (typeof productionSkillSlugs)[number];

const SCAN_ONLY: SkillCapabilities = { canScan: true, canApply: false, canDetectLoggedOut: false };

const PRODUCTION_METADATA: Record<ProductionSkillSlug, { version: string; displayName: string; capabilities: SkillCapabilities }> = {
  laborum: { version: '0.1.0', displayName: 'Laborum.cl', capabilities: SCAN_ONLY },
  computrabajo: { version: '0.1.0', displayName: 'Computrabajo.cl', capabilities: SCAN_ONLY },
  indeed: { version: '0.1.0', displayName: 'Indeed.cl', capabilities: SCAN_ONLY },
  chiletrabajos: { version: '0.1.0', displayName: 'Chiletrabajos.cl', capabilities: SCAN_ONLY },
  empleosaqua: { version: '0.1.0', displayName: 'Empleos Aqua', capabilities: SCAN_ONLY },
  trabajando: { version: '0.1.0', displayName: 'Trabajando.cl', capabilities: SCAN_ONLY },
};

export function getProductionSkills(): CatalogSkill[] {
  return productionSkillSlugs.map((slug) => {
    const meta = PRODUCTION_METADATA[slug];
    return { slug, ...meta, source: 'production' as const };
  });
}

function browserBaseCandidates(): string[] {
  const fromEnv = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const fromLocal = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null;
  const fromHome = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  return [fromEnv, fromLocal, fromHome].filter((p): p is string => Boolean(p));
}

export function detectInstalledBrowserEngine(): BrowserEngine {
  for (const base of browserBaseCandidates()) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(base); } catch { continue; }
    if (entries.some((e) => /^chromium(-headless-shell)?-\d+/.test(e))) return 'chromium';
    if (entries.some((e) => /^firefox-\d+/.test(e))) return 'firefox';
    if (entries.some((e) => /^webkit-\d+/.test(e))) return 'webkit';
  }
  return 'unknown';
}

export function getBrowserEngineInfo(): BrowserEngineInfo {
  const engine = detectInstalledBrowserEngine();
  const detected = engine === 'unknown' ? 'no browser detected' : engine;
  const message = `Detected: ${detected}. Chromium is the default; Firefox and WebKit are also accepted. Install the corresponding Playwright binary with \`npx playwright install <engine>\` (chromium, firefox, or webkit).`;
  return { engine, message };
}
