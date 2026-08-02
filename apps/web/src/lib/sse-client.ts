import { prependEvent, type ActivityEvent } from '../stores/activity.js';

export function connectToEventStream(): () => void {
  if (typeof EventSource === 'undefined') {
    console.warn('[sse] EventSource not available');
    return () => {};
  }

  const source = new EventSource('/api/eventos');

  source.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as ActivityEvent;
      prependEvent(event);
    } catch (err) {
      console.error('[sse] failed to parse event:', err);
    }
  };

  source.onerror = () => {
    console.warn('[sse] connection error, will retry');
    // EventSource auto-reconnects
  };

  return () => {
    source.close();
  };
}
