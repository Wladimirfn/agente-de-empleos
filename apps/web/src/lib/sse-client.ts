import { prependEvent, setEventSnapshot, type ActivityEvent } from '../stores/activity.js';

const CURSOR_KEY = 'activity.lastEventId';

export function eventStreamUrl(storage?: Pick<Storage, 'getItem'>): string {
  const cursor = storage?.getItem(CURSOR_KEY);
  return cursor ? `/api/eventos?lastEventId=${encodeURIComponent(cursor)}` : '/api/eventos';
}

export function connectToEventStream(onConnectionChange?: (connected: boolean) => void): () => void {
  if (typeof EventSource === 'undefined') {
    console.warn('[sse] EventSource not available');
    return () => {};
  }

  const storage = typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  const source = new EventSource(eventStreamUrl(storage));

  const remember = (id: string) => {
    if (id) storage?.setItem(CURSOR_KEY, id);
  };

  source.onopen = () => onConnectionChange?.(true);

  source.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as ActivityEvent;
      prependEvent(event);
      remember(e.lastEventId || String(event.id));
    } catch (err) {
      console.error('[sse] failed to parse event:', err);
    }
  };

  source.addEventListener('snapshot', (e) => {
    const message = e as MessageEvent<string>;
    try {
      setEventSnapshot(JSON.parse(message.data) as ActivityEvent[]);
      remember(message.lastEventId);
    } catch (err) {
      console.error('[sse] failed to parse snapshot:', err);
    }
  });

  source.onerror = () => {
    onConnectionChange?.(false);
    console.warn('[sse] connection error, will retry');
    // EventSource auto-reconnects
  };

  return () => {
    source.close();
    onConnectionChange?.(false);
  };
}
