import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { db } from '@employment-agent/database';
import { platforms, taskQueue } from '@employment-agent/database/schema';
import { sql } from 'drizzle-orm';
const BUILT_INS = [
  { aliases: ['chiletrabajos'], name: 'Chiletrabajos', url: 'https://www.chiletrabajos.cl' },
  { aliases: ['trabajando', 'trabajandocl'], name: 'Trabajando.cl', url: 'https://www.trabajando.cl' },
  { aliases: ['empleosaqua'], name: 'Empleos Aqua', url: 'https://www.empleosaqua.cl' },
] as const;
const BUILT_IN_HOSTS = new Set(BUILT_INS.flatMap(({ url }) => {
  const host = new URL(url).hostname;
  return [host, host.replace(/^www\./, '')];
}));
const blocked4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked4.addSubnet(address, prefix, 'ipv4');
const blocked6 = new BlockList();
const global6 = new BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['::', 96], ['::ffff:0:0', 96], ['::ffff:0:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 32], ['2001:2::', 48], ['2001:10::', 28], ['2001:20::', 28],
  ['2001:db8::', 32], ['2002::', 16], ['3ffe::', 16], ['3fff::', 20], ['5f00::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) {
  blocked6.addSubnet(address, prefix, 'ipv6');
}
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? !blocked4.check(address, 'ipv4') : version === 6 ? global6.check(address, 'ipv6') && !blocked6.check(address, 'ipv6') : false;
}
export interface OnboardingDeps {
  resolve(hostname: string): Promise<Array<{ address: string; family: number }>>;
  request(url: URL, address: { address: string; family: number }): Promise<{ status: number; location?: string }>;
  dnsTimeoutMs?: number;
}

const defaults: OnboardingDeps = {
  resolve: (hostname) => lookup(hostname, { all: true }),
  request: pinnedRequest,
};
export function pinnedRequest(url: URL, pinned: { address: string; family: number }) {
  return new Promise<{ status: number; location?: string }>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', headers: { Host: url.host }, servername: url.hostname.replace(/^\[|\]$/g, ''), timeout: 8_000,
      lookup: (_hostname, options, callback) => {
        const address = { address: pinned.address, family: pinned.family as 4 | 6 };
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      resolve({ status: response.statusCode ?? 0, location: response.headers.location });
      response.destroy();
    });
    request.once('timeout', () => request.destroy(new Error('Request timed out.')));
    request.once('error', reject);
    request.end();
  });
}
function resolveWithTimeout(host: string, deps: OnboardingDeps) {
  return new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new PlatformOnboardingError('unreachable', 'Platform DNS lookup timed out.'));
    }, deps.dnsTimeoutMs ?? 3_000);
    Promise.resolve().then(() => deps.resolve(host)).then((addresses) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(addresses); }
    }, () => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new PlatformOnboardingError('unreachable', 'Platform DNS lookup failed.')); }
    });
  });
}
export class PlatformOnboardingError extends Error {
  constructor(readonly code: 'unapproved' | 'unsafe' | 'unreachable', message: string) {
    super(message);
  }
}
export function approvedOriginsFromMessage(message: string): Set<string> {
  const origins = new Set<string>();
  for (const match of message.matchAll(/https?:\/\/[^\s<>'"]+/gi)) {
    try { origins.add(new URL(match[0].replace(/[\])},.!?]+$/, '')).origin); } catch { /* invalid user text */ }
  }
  return origins;
}

function builtInFor(value: string) {
  const key = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return BUILT_INS.find((item) => item.aliases.includes(key as never));
}

export async function validateAndProbePlatform(
  input: { name: string; url?: string },
  approvedOrigins: ReadonlySet<string>,
  deps: OnboardingDeps = defaults,
): Promise<{ name: string; url: string; origin: string; host: string }> {
  const builtIn = builtInFor(input.name) ?? (input.url ? BUILT_INS.find((item) => {
    try { return BUILT_IN_HOSTS.has(new URL(input.url!).hostname.toLowerCase()); } catch { return false; }
  }) : undefined);
  const rawUrl = input.url || builtIn?.url;
  let url: URL;
  try { url = new URL(rawUrl ?? ''); } catch { throw new PlatformOnboardingError('unsafe', 'Invalid platform URL.'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || host === 'localhost' || host.endsWith('.localhost')) {
    throw new PlatformOnboardingError('unsafe', 'Unsafe platform URL.');
  }
  if (!(BUILT_IN_HOSTS.has(host) && url.port === '') && !approvedOrigins.has(url.origin)) {
    throw new PlatformOnboardingError('unapproved', 'The origin was not approved by the current user message.');
  }
  let target = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const addresses = await resolveWithTimeout(target.hostname.replace(/^\[|\]$/g, ''), deps);
    if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new PlatformOnboardingError('unsafe', 'Platform resolves to an unsafe network address.');
    }
    let response: { status: number; location?: string };
    try { response = await deps.request(target, addresses[0]!); }
    catch { throw new PlatformOnboardingError('unreachable', 'Platform is unreachable.'); }
    if (response.status >= 200 && response.status < 300) break;
    if (response.status < 300 || response.status >= 400 || !response.location || redirects === 3) {
      throw new PlatformOnboardingError('unreachable', `Platform returned HTTP ${response.status}.`);
    }
    const redirected = new URL(response.location, target);
    if (redirected.origin !== url.origin) throw new PlatformOnboardingError('unsafe', 'Cross-origin redirects are not allowed.');
    if (redirected.username || redirected.password) throw new PlatformOnboardingError('unsafe', 'Redirect credentials are not allowed.');
    target = redirected;
  }
  return { name: input.name || builtIn!.name, url: url.origin, origin: url.origin, host };
}

export function derivePlatformSlug(url: string): string {
  const labels = new URL(url).hostname.replace(/^www\./, '').split('.');
  const brand = labels.length >= 3 && labels[0]!.length <= 2 ? labels[1]! : labels[0]!;
  return brand!.replace(/[^a-z0-9-]/gi, '').toLowerCase();
}

export function platformScanTaskType(hasSkill: boolean, forceAgent = false): 'SCAN_PLATFORM' | 'BROWSER_AGENT_SCAN' {
  return hasSkill && !forceAgent ? 'SCAN_PLATFORM' : 'BROWSER_AGENT_SCAN';
}

export type PlatformScanTaskType = 'SCAN_PLATFORM' | 'BROWSER_AGENT_SCAN';

export async function enqueuePlatformScan(platform: { slug: string; url?: string }, triggeredBy: string, type: PlatformScanTaskType = 'BROWSER_AGENT_SCAN', context: { deepSearchRunId?: string; executor?: Pick<typeof db, 'all'> } = {}): Promise<string | null> {
  const id = randomUUID();
  const payload = JSON.stringify({ skillSlug: platform.slug, ...(type === 'BROWSER_AGENT_SCAN' ? { platformUrl: new URL(platform.url!).origin } : {}), triggeredBy, ...(context.deepSearchRunId ? { deepSearchRunId: context.deepSearchRunId } : {}) });
  const inserted = await (context.executor ?? db).all<{ id: string }>(sql`
    INSERT INTO task_queue (id, type, payload_json, status, attempts, max_attempts, scheduled_at)
    SELECT ${id}, ${type}, ${payload}, 'pending', 0, ${type === 'BROWSER_AGENT_SCAN' ? 1 : 3}, ${new Date().toISOString()}
    WHERE NOT EXISTS (
      SELECT 1 FROM task_queue
      WHERE (${context.deepSearchRunId ?? null} IS NOT NULL OR type = ${type}) AND status IN ('pending', 'running', 'retrying')
        AND json_extract(payload_json, '$.skillSlug') = ${platform.slug}
    ) RETURNING id
  `);
  return inserted[0]?.id ?? null;
}

export async function onboardPlatform(input: { name: string; url?: string; slug?: string; scanExisting?: boolean }, approvedOrigins: ReadonlySet<string>, deps?: OnboardingDeps) {
  const checked = await validateAndProbePlatform(input, approvedOrigins, deps);
  const slug = derivePlatformSlug(checked.url);
  const existing = await db.select().from(platforms);
  const duplicate = existing.find((item) => item.slug === slug || (item.baseUrl && new URL(item.baseUrl).hostname.replace(/^www\./, '') === checked.host.replace(/^www\./, '')));
  if (duplicate) {
    const taskId = input.scanExisting && duplicate.baseUrl ? await enqueuePlatformScan({ slug: duplicate.slug, url: duplicate.baseUrl }, 'platform-onboarding-existing') : null;
    return { created: false, platform: duplicate, taskId };
  }
  const inserted = await db.insert(platforms).values({ slug, displayName: checked.name, baseUrl: checked.origin, status: 'active' }).onConflictDoNothing().returning();
  if (!inserted[0]) {
    const raced = (await db.select().from(platforms).where(sql`${platforms.slug} = ${slug}`).limit(1))[0]!;
    return { created: false, platform: raced, taskId: input.scanExisting && raced.baseUrl ? await enqueuePlatformScan({ slug, url: raced.baseUrl }, 'platform-onboarding-existing') : null };
  }
  const taskId = await enqueuePlatformScan({ slug, url: checked.url }, 'platform-onboarding');
  return { created: true, platform: inserted[0]!, taskId };
}
