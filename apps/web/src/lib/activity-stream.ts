import type { ActivityEvent } from '../stores/activity.js';

export const HISTORY_LIMIT = 100;

export function readEventCursor(request: Request, url: URL): number | null {
  const raw = request.headers.get('Last-Event-ID') ?? url.searchParams.get('lastEventId');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

export function chronologicalSnapshot(rows: ActivityEvent[]): ActivityEvent[] {
  return rows.slice(0, HISTORY_LIMIT).reverse();
}

export function encodeSse(event: ActivityEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}
