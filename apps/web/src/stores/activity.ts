import { atom } from 'nanostores';

export interface ActivityEvent {
  id: number;
  kind: string;
  message: string;
  occurredAt: string;
}

export const recentEvents = atom<ActivityEvent[]>([]);

export function prependEvent(event: ActivityEvent): void {
  const current = recentEvents.get();
  const updated = [event, ...current].slice(0, 100);
  recentEvents.set(updated);
}
