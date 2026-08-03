import { beforeEach, describe, expect, it } from 'vitest';
import { chronologicalSnapshot, encodeSse, HISTORY_LIMIT, readEventCursor } from './activity-stream.js';
import { eventStreamUrl } from './sse-client.js';
import { prependEvent, recentEvents, setEventSnapshot, type ActivityEvent } from '../stores/activity.js';

const event = (id: number): ActivityEvent => ({ id, kind: 'test', message: `event ${id}`, occurredAt: `${id}` });

beforeEach(() => recentEvents.set([]));

describe('Activity event stream', () => {
  it('prefers Last-Event-ID and supports the query fallback', () => {
    const url = new URL('http://localhost/api/eventos?lastEventId=4');
    expect(readEventCursor(new Request(url, { headers: { 'Last-Event-ID': '7' } }), url)).toBe(7);
    expect(readEventCursor(new Request(url), url)).toBe(4);
    expect(eventStreamUrl({ getItem: () => '9' })).toBe('/api/eventos?lastEventId=9');
  });

  it('bounds and orders the initial snapshot chronologically', () => {
    const rows = Array.from({ length: HISTORY_LIMIT + 5 }, (_, index) => event(HISTORY_LIMIT + 5 - index));
    const snapshot = chronologicalSnapshot(rows);
    expect(snapshot).toHaveLength(HISTORY_LIMIT);
    expect(snapshot[0]!.id).toBe(6);
    expect(snapshot.at(-1)!.id).toBe(105);
  });

  it('encodes resumable SSE IDs', () => {
    expect(encodeSse(event(12))).toContain('id: 12\n');
  });

  it('deduplicates IDs and keeps newest events first', () => {
    setEventSnapshot([event(1), event(2), event(2)]);
    prependEvent(event(2));
    prependEvent(event(3));
    expect(recentEvents.get().map(({ id }) => id)).toEqual([3, 2, 1]);
  });
});
