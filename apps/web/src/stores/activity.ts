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
  if (current.some((item) => item.id === event.id)) return;
  const updated = [event, ...current].sort((a, b) => b.id - a.id).slice(0, 100);
  recentEvents.set(updated);
}

export function setEventSnapshot(events: ActivityEvent[]): void {
  const unique = new Map(events.map((event) => [event.id, event]));
  recentEvents.set([...unique.values()].sort((a, b) => b.id - a.id).slice(0, 100));
}
