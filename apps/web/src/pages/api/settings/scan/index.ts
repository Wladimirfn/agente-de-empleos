import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';
import { scanSettings } from '@employment-agent/database/schema';
import { parseScanSettingsInput, toScanSettingsDto } from '../../../../lib/scan-settings.js';

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export const GET: APIRoute = async ({ url }) => {
  const unknownQueryField = Array.from(url.searchParams.keys())
    .find((key) => !['intervalMinutes', 'autoScanEnabled'].includes(key));
  if (unknownQueryField) return json({ error: `Unknown field: ${unknownQueryField}` }, 400);

  const rows = await db.select().from(scanSettings).limit(1);
  return json(toScanSettingsDto(rows[0] ?? null));
};

export const PUT: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = parseScanSettingsInput(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const updatedAt = new Date().toISOString();
  const autoScanEnabled = parsed.value.autoScanEnabled ? 1 : 0;
  await db.insert(scanSettings).values({
    id: 1,
    scanIntervalMinutes: parsed.value.intervalMinutes,
    autoScanEnabled,
    updatedAt,
  }).onConflictDoUpdate({
    target: scanSettings.id,
    set: { scanIntervalMinutes: parsed.value.intervalMinutes, autoScanEnabled, updatedAt },
  });

  return json(toScanSettingsDto({
    scanIntervalMinutes: parsed.value.intervalMinutes,
    autoScanEnabled,
    updatedAt,
  }));
};
